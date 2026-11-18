// TIMEOUT INVARIANT (correctness, not tuning):
//   OpenAI deadline 8s  <  lock_timeout 10s  <  tx timeout 20s
// A request waiting on the lock must outlast the holder's OpenAI call, or it
// times out just before a fresh row lands. Do not reorder. See docs/CONCURRENCY.md.

import type { Fact, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import { systemClock, type Clock } from "./clock";
import { generateFact, looksLikeRefusal, OPENAI_DEADLINE_MS, OPENAI_MODEL } from "./openai";
import { chooseFactMode, pickAngle } from "./fact-prompt";
import { env } from "./env";
import { withAdvisoryLock, LOCK_TIMEOUT_MS } from "./lock";
import { factRateLimiter, type RateLimiter } from "./rate-limit";
import { getMovieDetails, type MovieDetails, type MovieDetailsLoader } from "./tmdb";
import { AppErrorException, LockTimeoutError } from "./errors";
import { logger } from "./logger";

export const CACHE_WINDOW_MS = 60_000;
export const TX_TIMEOUT_MS = 20_000;
export const TX_MAX_WAIT_MS = 5_000;
export const AVOID_COUNT = 10;
// Rows read when looking for the latest usable facts. Older builds could store a
// refusal ("I'm sorry, …"); those rows are skipped, never served or used as avoid text.
const RECENT_SCAN = 20;

if (!(OPENAI_DEADLINE_MS < LOCK_TIMEOUT_MS && LOCK_TIMEOUT_MS < TX_TIMEOUT_MS)) {
  throw new Error("Timeout invariant broken: OpenAI deadline < lock_timeout < tx timeout");
}

export type FactResult = { fact: Fact; stale: boolean };

export type FactServiceDeps = {
  clock?: Clock;
  openai?: typeof generateFact;
  prisma?: PrismaClient;
  rateLimiter?: RateLimiter;
  movieDetails?: MovieDetailsLoader;
  /** YYYY-MM-DD; defaults to MODEL_KNOWLEDGE_CUTOFF. */
  knowledgeCutoff?: string;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Current fun fact for the user's favorite movie. Every query is scoped by `userId`,
 * which must come from the session. Throws AppErrorException
 * (RATE_LIMITED | NO_MOVIE | UPSTREAM_FAILED).
 */
export async function getFactForUser(userId: string, deps: FactServiceDeps = {}): Promise<FactResult> {
  const clock = deps.clock ?? systemClock;
  const openai = deps.openai ?? generateFact;
  const db = deps.prisma ?? defaultPrisma;
  const rateLimiter = deps.rateLimiter ?? factRateLimiter;
  const loadDetails = deps.movieDetails ?? getMovieDetails;
  const knowledgeCutoff = deps.knowledgeCutoff ?? env.MODEL_KNOWLEDGE_CUTOFF;
  const started = clock.now();

  const limit = rateLimiter.consume(userId, started);
  if (!limit.ok) {
    logger.info({ event: "fact.rate_limited", userId, retryAfterMs: limit.retryAfterMs, durationMs: 0 });
    throw new AppErrorException({
      code: "RATE_LIMITED",
      message: "Too many requests",
      retryAfterMs: limit.retryAfterMs,
    });
  }

  const movie = await db.movie.findUnique({
    where: { userId },
    select: { title: true, year: true, tmdbId: true },
  });
  if (!movie) throw new AppErrorException({ code: "NO_MOVIE", message: "Pick a favorite movie first" });

  const movieTitle = movie.title;
  const log = logger.child({ userId, movieTitle });
  const elapsed = () => clock.now() - started;
  const isFresh = (fact: Fact | null): fact is Fact =>
    fact !== null && clock.now() - fact.createdAt.getTime() < CACHE_WINDOW_MS;

  // Hot path: no lock, no transaction.
  const cached = await latestFact(db, userId, movieTitle);
  if (isFresh(cached)) {
    log.info({ event: "fact.cache_hit", phase: "pre_lock", durationMs: elapsed() });
    return { fact: cached, stale: false };
  }

  log.info({ event: "fact.cache_miss", durationMs: elapsed() });

  // TMDB grounding data, fetched BEFORE the lock so the lock is never held during
  // this call (≤3s, cached 24h per tmdbId, shared across concurrent callers).
  // Any failure just means the model writes without it.
  let details: MovieDetails | null = null;
  if (movie.tmdbId !== null) {
    const detailsStart = clock.now();
    details = await loadDetails(movie.tmdbId).catch(() => null);
    log.info({ event: "fact.tmdb_context", ok: details !== null, durationMs: clock.now() - detailsStart });
  }

  log.info({ event: "fact.lock_wait_start", durationMs: elapsed() });
  const lockWaitStart = clock.now();

  try {
    return await db.$transaction(
      (tx) =>
        withAdvisoryLock(tx, `fact:${userId}`, async () => {
          log.info({ event: "fact.lock_acquired", durationMs: clock.now() - lockWaitStart });

          // Re-check: the request we waited on has probably just written a fresh row.
          const recent = await recentUsableFacts(tx, userId, movieTitle);
          const latest = recent[0] ?? null;
          if (isFresh(latest)) {
            log.info({ event: "fact.cache_hit", phase: "post_lock", durationMs: elapsed() });
            return { fact: latest, stale: false };
          }

          // Strategy and topic are decided here, in code — not by the model.
          const today = new Date(clock.now()).toISOString().slice(0, 10);
          const mode = chooseFactMode(details, knowledgeCutoff, today);
          const angle = pickAngle(await tx.fact.count({ where: { userId, movieTitle } }));
          const call = { model: OPENAI_MODEL, mode, angle };

          const callStart = clock.now();
          let content: string;
          try {
            const generated = await openai(
              { title: movieTitle, year: movie.year, details, today, mode, angle },
              recent.slice(0, AVOID_COUNT).map((f) => f.content),
              AbortSignal.timeout(OPENAI_DEADLINE_MS),
            );
            content = generated.content;
            log.info({
              event: "fact.openai_call",
              ok: true,
              ...call,
              usedMode: generated.mode,
              durationMs: clock.now() - callStart,
            });
          } catch (err) {
            log.warn({ event: "fact.openai_fallback", ...call, err, durationMs: clock.now() - callStart });
            return serveStale(latest, log, elapsed());
          }

          const fact = await tx.fact.create({
            data: { userId, movieTitle, content, createdAt: new Date(clock.now()) },
          });
          return { fact, stale: false };
        }),
      { timeout: TX_TIMEOUT_MS, maxWait: TX_MAX_WAIT_MS },
    );
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    // Transaction rolled back and the lock is released; read outside any transaction.
    log.warn({ event: "fact.lock_wait_timeout", durationMs: clock.now() - lockWaitStart });
    return serveStale(await latestFact(db, userId, movieTitle), log, elapsed());
  }
}

/** Newest first, scoped to this user + title, with any stored refusals skipped. */
async function recentUsableFacts(db: Db, userId: string, movieTitle: string): Promise<Fact[]> {
  const rows = await db.fact.findMany({
    where: { userId, movieTitle },
    orderBy: { createdAt: "desc" },
    take: RECENT_SCAN,
  });
  return rows.filter((f) => !looksLikeRefusal(f.content));
}

async function latestFact(db: Db, userId: string, movieTitle: string): Promise<Fact | null> {
  return (await recentUsableFacts(db, userId, movieTitle))[0] ?? null;
}

function serveStale(prior: Fact | null, log: typeof logger, durationMs: number): FactResult {
  if (!prior) {
    throw new AppErrorException({ code: "UPSTREAM_FAILED", message: "Couldn't fetch a fact right now" });
  }
  log.info({ event: "fact.stale_served", factId: prior.id, durationMs });
  return { fact: prior, stale: true };
}

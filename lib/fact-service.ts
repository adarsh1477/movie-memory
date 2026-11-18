// TIMEOUT INVARIANT (correctness, not tuning):
//   OpenAI deadline 8s  <  lock_timeout 10s  <  tx timeout 20s
// A request waiting on the lock must outlast the holder's OpenAI call, or it
// times out just before a fresh row lands. Do not reorder. See docs/CONCURRENCY.md.

import type { Fact, Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import { systemClock, type Clock } from "./clock";
import { generateFact, OPENAI_DEADLINE_MS } from "./openai";
import { withAdvisoryLock, LOCK_TIMEOUT_MS } from "./lock";
import { factRateLimiter, type RateLimiter } from "./rate-limit";
import { AppErrorException, LockTimeoutError } from "./errors";
import { logger } from "./logger";

export const CACHE_WINDOW_MS = 60_000;
export const TX_TIMEOUT_MS = 20_000;
export const TX_MAX_WAIT_MS = 5_000;
export const AVOID_COUNT = 3;

if (!(OPENAI_DEADLINE_MS < LOCK_TIMEOUT_MS && LOCK_TIMEOUT_MS < TX_TIMEOUT_MS)) {
  throw new Error("Timeout invariant broken: OpenAI deadline < lock_timeout < tx timeout");
}

export type FactResult = { fact: Fact; stale: boolean };

export type FactServiceDeps = {
  clock?: Clock;
  openai?: typeof generateFact;
  prisma?: PrismaClient;
  rateLimiter?: RateLimiter;
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

  const movie = await db.movie.findUnique({ where: { userId }, select: { title: true } });
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
  log.info({ event: "fact.lock_wait_start", durationMs: elapsed() });
  const lockWaitStart = clock.now();

  try {
    return await db.$transaction(
      (tx) =>
        withAdvisoryLock(tx, `fact:${userId}`, async () => {
          log.info({ event: "fact.lock_acquired", durationMs: clock.now() - lockWaitStart });

          // Re-check: the request we waited on has probably just written a fresh row.
          const recent = await tx.fact.findMany({
            where: { userId, movieTitle },
            orderBy: { createdAt: "desc" },
            take: AVOID_COUNT,
          });
          const latest = recent[0] ?? null;
          if (isFresh(latest)) {
            log.info({ event: "fact.cache_hit", phase: "post_lock", durationMs: elapsed() });
            return { fact: latest, stale: false };
          }

          const callStart = clock.now();
          let content: string;
          try {
            content = await openai(
              movieTitle,
              recent.map((f) => f.content),
              AbortSignal.timeout(OPENAI_DEADLINE_MS),
            );
            log.info({ event: "fact.openai_call", ok: true, durationMs: clock.now() - callStart });
          } catch (err) {
            log.warn({ event: "fact.openai_fallback", err, durationMs: clock.now() - callStart });
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

function latestFact(db: Db, userId: string, movieTitle: string): Promise<Fact | null> {
  return db.fact.findFirst({ where: { userId, movieTitle }, orderBy: { createdAt: "desc" } });
}

function serveStale(prior: Fact | null, log: typeof logger, durationMs: number): FactResult {
  if (!prior) {
    throw new AppErrorException({ code: "UPSTREAM_FAILED", message: "Couldn't fetch a fact right now" });
  }
  log.info({ event: "fact.stale_served", factId: prior.id, durationMs });
  return { fact: prior, stale: true };
}

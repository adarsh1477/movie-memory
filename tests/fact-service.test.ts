// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Fact, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getFactForUser, AVOID_COUNT, type FactServiceDeps } from "@/lib/fact-service";
import { FACT_ANGLES } from "@/lib/fact-prompt";
import { createRateLimiter } from "@/lib/rate-limit";
import { AppErrorException, OpenAiError } from "@/lib/errors";
import type { MovieDetails } from "@/lib/tmdb";

// ── In-memory stand-in for the Prisma calls the service makes ─────────────────

type FakeDb = {
  facts: Fact[];
  movies: Map<string, string>;
  years?: Map<string, number>;
  tmdbIds?: Map<string, number>;
  onLock?: () => void;
  lockError?: unknown;
  /** Ordered log of interesting calls, to check what happens before the lock. */
  events: string[];
};

function fakePrisma(db: FakeDb) {
  let seq = 0;
  const byUserAndTitle = (where: { userId: string; movieTitle: string }) =>
    db.facts
      .filter((f) => f.userId === where.userId && f.movieTitle === where.movieTitle)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const client = {
    movie: {
      findUnique: async ({ where }: { where: { userId: string } }) => {
        const title = db.movies.get(where.userId);
        return title
          ? { title, year: db.years?.get(where.userId) ?? null, tmdbId: db.tmdbIds?.get(where.userId) ?? null }
          : null;
      },
    },
    fact: {
      findFirst: async ({ where }: { where: { userId: string; movieTitle: string } }) =>
        byUserAndTitle(where)[0] ?? null,
      findMany: async ({ where, take }: { where: { userId: string; movieTitle: string }; take: number }) =>
        byUserAndTitle(where).slice(0, take),
      count: async ({ where }: { where: { userId: string; movieTitle: string } }) => byUserAndTitle(where).length,
      create: async ({ data }: { data: Omit<Fact, "id"> }) => {
        const fact = { id: `f${++seq}`, ...data };
        db.facts.push(fact);
        return fact;
      },
    },
    $executeRawUnsafe: async () => 0,
    $executeRaw: async () => {
      db.events.push("lock");
      if (db.lockError) throw db.lockError;
      db.onLock?.();
      return 1;
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return client as unknown as PrismaClient;
}

function seedFact(db: FakeDb, userId: string, movieTitle: string, content: string, at: number): Fact {
  const fact = { id: `seed-${db.facts.length}`, userId, movieTitle, content, createdAt: new Date(at) };
  db.facts.push(fact);
  return fact;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
let now: number;
let db: FakeDb;
let openai: ReturnType<typeof vi.fn>;
let movieDetails: ReturnType<typeof vi.fn>;
let wikipedia: ReturnType<typeof vi.fn>;
let deps: FactServiceDeps;

const HEAT_DETAILS: MovieDetails = {
  title: "Heat",
  tagline: "A Los Angeles crime saga",
  overview: "Obsessive master thief Neil McCauley leads a top-notch crew…",
  releaseDate: "1995-12-15",
  status: "Released",
  runtimeMinutes: 170,
  genres: ["Action", "Crime", "Drama"],
  directors: ["Michael Mann"],
  cast: [
    { name: "Al Pacino", character: "Lt. Vincent Hanna" },
    { name: "Robert De Niro", character: "Neil McCauley" },
  ],
  productionCompanies: ["Regency Enterprises"],
  keywords: ["heist", "los angeles"],
};
const TODAY = "2026-11-18";

beforeEach(() => {
  now = T0;
  db = {
    facts: [],
    movies: new Map([["userA", "Heat"], ["userB", "Heat"]]),
    years: new Map([["userA", 1995]]),
    tmdbIds: new Map([["userA", 949]]),
    events: [],
  };
  let n = 0;
  openai = vi.fn(async () => {
    db.events.push("openai");
    return { content: `fact #${++n}`, mode: "knowledge" };
  });
  movieDetails = vi.fn(async () => {
    db.events.push("tmdb");
    return HEAT_DETAILS;
  });
  wikipedia = vi.fn(async () => {
    db.events.push("wikipedia");
    return { ok: true, notes: null };
  });
  deps = {
    clock: { now: () => now },
    openai: openai as unknown as FactServiceDeps["openai"],
    prisma: fakePrisma(db),
    rateLimiter: createRateLimiter({ limit: 1_000, windowMs: 60_000 }),
    movieDetails: movieDetails as unknown as FactServiceDeps["movieDetails"],
    wikipedia: wikipedia as unknown as FactServiceDeps["wikipedia"],
  };
});

async function expectAppError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(AppErrorException);
  expect((err as AppErrorException).error.code).toBe(code);
  return err as AppErrorException;
}

// ── Cache window ──────────────────────────────────────────────────────────────

describe("60s cache window", () => {
  it("serves the same fact at t=59s without calling OpenAI", async () => {
    const first = await getFactForUser("userA", deps);
    now = T0 + 59_000;
    const second = await getFactForUser("userA", deps);

    expect(second.fact.id).toBe(first.fact.id);
    expect(second.stale).toBe(false);
    expect(openai).toHaveBeenCalledTimes(1);
  });

  it("writes a new fact at t=61s", async () => {
    const first = await getFactForUser("userA", deps);
    now = T0 + 61_000;
    const second = await getFactForUser("userA", deps);

    expect(second.fact.id).not.toBe(first.fact.id);
    expect(second.fact.content).toBe("fact #2");
    expect(openai).toHaveBeenCalledTimes(2);
    expect(db.facts).toHaveLength(2);
  });

  it("re-checks inside the lock and serves a row written while it waited", async () => {
    seedFact(db, "userA", "Heat", "old", T0 - 120_000);
    db.onLock = () => seedFact(db, "userA", "Heat", "written by the other request", T0);

    const result = await getFactForUser("userA", deps);

    expect(result.fact.content).toBe("written by the other request");
    expect(openai).not.toHaveBeenCalled();
  });
});

// ── Avoid list ────────────────────────────────────────────────────────────────

describe("avoid list", () => {
  it("is the last 10 facts for this user and this exact title only", async () => {
    for (let i = 1; i <= 12; i++) seedFact(db, "userA", "Heat", `A heat ${i}`, T0 - 600_000 + i * 1_000);
    seedFact(db, "userA", "heat", "A lowercase title", T0 - 100_000);
    seedFact(db, "userA", "Alien", "A other movie", T0 - 100_000);
    seedFact(db, "userB", "Heat", "B same movie", T0 - 100_000);

    await getFactForUser("userA", deps);

    expect(AVOID_COUNT).toBe(10);
    expect(openai.mock.calls[0][1]).toEqual(
      Array.from({ length: 10 }, (_, i) => `A heat ${12 - i}`), // newest first: 12 … 3
    );
  });
});

describe("movie year", () => {
  it("passes the stored year to OpenAI", async () => {
    await getFactForUser("userA", deps);
    expect(openai.mock.calls[0][0]).toMatchObject({ title: "Heat", year: 1995 });
  });

  it("passes year: null for a free-text movie", async () => {
    await getFactForUser("userB", deps);
    expect(openai.mock.calls[0][0]).toEqual({
      title: "Heat",
      year: null,
      details: null,
      today: TODAY,
      mode: "knowledge",
      angle: FACT_ANGLES.knowledge[0],
      wikipedia: null,
    });
  });
});

// ── Strategy and angle (chosen in code) ───────────────────────────────────────

describe("fact mode", () => {
  it("uses knowledge mode for a released film from before the cutoff", async () => {
    await getFactForUser("userA", deps); // Heat, 1995-12-15, default cutoff 2024-01-01
    expect(openai.mock.calls[0][0].mode).toBe("knowledge");
  });

  it("uses knowledge mode for a free-text title (no TMDB details)", async () => {
    await getFactForUser("userB", deps);
    expect(openai.mock.calls[0][0].mode).toBe("knowledge");
  });

  it("uses grounded mode for an unreleased film", async () => {
    movieDetails.mockResolvedValueOnce({ ...HEAT_DETAILS, status: "Post Production", releaseDate: "2026-12-18" });
    await getFactForUser("userA", deps);
    expect(openai.mock.calls[0][0].mode).toBe("grounded");
  });

  it("uses grounded mode for Dune: Part Two (released 2024-03-01) under the default cutoff", async () => {
    movieDetails.mockResolvedValueOnce({ ...HEAT_DETAILS, title: "Dune: Part Two", releaseDate: "2024-03-01" });
    await getFactForUser("userA", deps); // no knowledgeCutoff override: the env default applies
    expect(openai.mock.calls[0][0].mode).toBe("grounded");
  });

  it("uses knowledge mode for a film released 2023-12-31 under the default cutoff", async () => {
    movieDetails.mockResolvedValueOnce({ ...HEAT_DETAILS, releaseDate: "2023-12-31" });
    await getFactForUser("userA", deps);
    expect(openai.mock.calls[0][0].mode).toBe("knowledge");
  });

  it("uses grounded mode for a film released after the configured cutoff", async () => {
    await getFactForUser("userA", { ...deps, knowledgeCutoff: "1990-01-01" });
    expect(openai.mock.calls[0][0].mode).toBe("grounded");
  });

  it("uses knowledge mode when TMDB is unavailable", async () => {
    movieDetails.mockResolvedValueOnce(null);
    await getFactForUser("userA", deps);
    expect(openai.mock.calls[0][0]).toMatchObject({ details: null, mode: "knowledge" });
  });
});

describe("angle hint", () => {
  it.each([0, 1, 6, 7, 15])(
    "rotates by how many facts the user already has for this movie (%i existing)",
    async (existing) => {
      for (let i = 0; i < existing; i++) seedFact(db, "userA", "Heat", `old ${i}`, T0 - 600_000 + i);
      await getFactForUser("userA", deps);
      expect(openai.mock.calls[0][0].angle).toBe(FACT_ANGLES.knowledge[existing % FACT_ANGLES.knowledge.length]);
    },
  );

  it("uses the mode's angle list: no casting in knowledge mode, casting available in grounded mode", async () => {
    seedFact(db, "userA", "Heat", "one", T0 - 600_000); // 1 existing fact → second angle

    await getFactForUser("userA", deps); // knowledge (released 1995)
    expect(openai.mock.calls[0][0]).toMatchObject({ mode: "knowledge", angle: "filming techniques and sets" });

    now = T0 + 120_000;
    movieDetails.mockResolvedValueOnce({ ...HEAT_DETAILS, status: "In Production", releaseDate: "2027-05-01" });
    seedFact(db, "userB", "Heat", "b", T0); // unrelated user, doesn't count
    db.facts = db.facts.filter((f) => f.userId !== "userA" || f.content === "one"); // back to 1 fact for A
    await getFactForUser("userA", deps); // grounded
    expect(openai.mock.calls[1][0]).toMatchObject({ mode: "grounded", angle: "casting" });
  });

  it("counts only this user's facts for this exact title", async () => {
    seedFact(db, "userB", "Heat", "B's", T0 - 600_000);
    seedFact(db, "userA", "Alien", "other title", T0 - 600_000);
    await getFactForUser("userA", deps);
    expect(openai.mock.calls[0][0].angle).toBe(FACT_ANGLES.knowledge[0]);
  });
});

// ── TMDB grounding ────────────────────────────────────────────────────────────

describe("TMDB context", () => {
  it("fetches details by tmdbId and passes them to OpenAI", async () => {
    await getFactForUser("userA", deps);

    expect(movieDetails).toHaveBeenCalledWith(949);
    expect(openai.mock.calls[0][0].details).toEqual(HEAT_DETAILS);
  });

  it("fetches details before taking the advisory lock", async () => {
    await getFactForUser("userA", deps);
    expect(db.events).toEqual(["tmdb", "lock", "openai"]);
  });

  it("skips the TMDB call for a free-text movie", async () => {
    await getFactForUser("userB", deps);
    expect(movieDetails).not.toHaveBeenCalled();
    expect(db.events).toEqual(["lock", "openai"]);
  });

  it("skips the TMDB call on a cache hit", async () => {
    seedFact(db, "userA", "Heat", "fresh", T0 - 10_000);
    await getFactForUser("userA", deps);
    expect(movieDetails).not.toHaveBeenCalled();
  });

  it.each([
    ["returns null", () => Promise.resolve(null)],
    ["throws", () => Promise.reject(new Error("boom"))],
  ])("still generates when TMDB %s", async (_label, impl) => {
    movieDetails.mockImplementationOnce(impl);

    const result = await getFactForUser("userA", deps);

    expect(result.stale).toBe(false);
    expect(openai.mock.calls[0][0]).toMatchObject({ title: "Heat", year: 1995, details: null });
  });
});

// ── Wikipedia production notes (grounded mode only) ───────────────────────────

describe("Wikipedia notes", () => {
  const DUNE: MovieDetails = {
    ...HEAT_DETAILS,
    title: "Dune: Part Two",
    releaseDate: "2024-03-01",
    directors: ["Denis Villeneuve"],
  };
  const NOTES = "Production: Filming took place in Budapest and in the Wadi Rum desert of Jordan.";

  it("grounded mode: looks up the film by TMDB title, release year and director, and passes the notes on", async () => {
    movieDetails.mockResolvedValueOnce(DUNE);
    wikipedia.mockResolvedValueOnce({ ok: true, notes: { pageTitle: "Dune: Part Two", text: NOTES } });

    await getFactForUser("userA", deps);

    expect(wikipedia).toHaveBeenCalledWith({ title: "Dune: Part Two", year: 2024, director: "Denis Villeneuve" });
    expect(openai.mock.calls[0][0]).toMatchObject({ mode: "grounded", wikipedia: NOTES });
  });

  it("fetches before the advisory lock, after TMDB", async () => {
    movieDetails.mockImplementationOnce(async () => {
      db.events.push("tmdb");
      return DUNE;
    });
    await getFactForUser("userA", deps);
    expect(db.events).toEqual(["tmdb", "wikipedia", "lock", "openai"]);
  });

  it("knowledge mode: no Wikipedia lookup at all", async () => {
    await getFactForUser("userA", deps); // Heat, 1995 → knowledge
    expect(wikipedia).not.toHaveBeenCalled();
    expect(openai.mock.calls[0][0]).toMatchObject({ mode: "knowledge", wikipedia: null });
  });

  it("free-text title (no TMDB details): no Wikipedia lookup", async () => {
    await getFactForUser("userB", deps);
    expect(wikipedia).not.toHaveBeenCalled();
  });

  it("no match: grounded on TMDB only, exactly as without Wikipedia", async () => {
    movieDetails.mockResolvedValueOnce(DUNE);
    wikipedia.mockResolvedValueOnce({ ok: true, notes: null });
    const result = await getFactForUser("userA", deps);
    expect(result.stale).toBe(false);
    expect(openai.mock.calls[0][0]).toMatchObject({ mode: "grounded", details: DUNE, wikipedia: null });
  });

  it.each([
    ["reports a transient failure", () => Promise.resolve({ ok: false, notes: null })],
    ["throws", () => Promise.reject(new Error("boom"))],
  ])("a Wikipedia lookup that %s never breaks fact generation", async (_label, impl) => {
    movieDetails.mockResolvedValueOnce(DUNE);
    wikipedia.mockImplementationOnce(impl);

    const result = await getFactForUser("userA", deps);

    expect(result.stale).toBe(false);
    expect(result.fact.content).toBe("fact #1");
    expect(openai.mock.calls[0][0]).toMatchObject({ mode: "grounded", wikipedia: null });
  });

  it("falls back to the stored movie year when TMDB has no release date", async () => {
    movieDetails.mockResolvedValueOnce({ ...DUNE, releaseDate: null, status: "In Production" });
    await getFactForUser("userA", deps); // userA's stored year is 1995
    expect(wikipedia.mock.calls[0][0]).toMatchObject({ year: 1995 });
  });
});

// ── Stored refusals (written before the safety net existed) ───────────────────

describe("stored refusals", () => {
  const REFUSAL = "I'm sorry, but I don't have information about that film beyond my training data.";

  it("are not served from the 60s cache", async () => {
    seedFact(db, "userA", "Heat", REFUSAL, T0 - 5_000);

    const result = await getFactForUser("userA", deps);

    expect(result.fact.content).toBe("fact #1");
    expect(openai).toHaveBeenCalledTimes(1);
  });

  it("are not used in the avoid list", async () => {
    seedFact(db, "userA", "Heat", "real one", T0 - 300_000);
    seedFact(db, "userA", "Heat", REFUSAL, T0 - 200_000);

    await getFactForUser("userA", deps);

    expect(openai.mock.calls[0][1]).toEqual(["real one"]);
  });

  it("are skipped by the stale fallback", async () => {
    const real = seedFact(db, "userA", "Heat", "real one", T0 - 600_000);
    seedFact(db, "userA", "Heat", REFUSAL, T0 - 300_000);
    openai.mockRejectedValueOnce(new OpenAiError("refused twice"));

    expect(await getFactForUser("userA", deps)).toEqual({ fact: real, stale: true });
  });

  it("never become the fallback: UPSTREAM_FAILED when only refusals exist", async () => {
    seedFact(db, "userA", "Heat", REFUSAL, T0 - 300_000);
    openai.mockRejectedValueOnce(new OpenAiError("refused twice"));

    await expectAppError(getFactForUser("userA", deps), "UPSTREAM_FAILED");
  });
});

// ── Failure handling ──────────────────────────────────────────────────────────

describe("OpenAI failure", () => {
  it("returns the prior fact with stale: true", async () => {
    const prior = seedFact(db, "userA", "Heat", "older fact", T0 - 300_000);
    openai.mockRejectedValueOnce(new OpenAiError("boom"));

    const result = await getFactForUser("userA", deps);

    expect(result).toEqual({ fact: prior, stale: true });
    expect(db.facts).toHaveLength(1);
  });

  it("throws UPSTREAM_FAILED when there is no prior fact", async () => {
    openai.mockRejectedValueOnce(new OpenAiError("boom"));
    await expectAppError(getFactForUser("userA", deps), "UPSTREAM_FAILED");
    expect(db.facts).toHaveLength(0);
  });
});

describe("lock wait timeout (55P03)", () => {
  const lockTimeout = () =>
    new Prisma.PrismaClientKnownRequestError("canceling statement due to lock timeout", {
      code: "P2010",
      clientVersion: "test",
      meta: { code: "55P03" },
    });

  it("serves the latest stored fact with stale: true", async () => {
    const prior = seedFact(db, "userA", "Heat", "older fact", T0 - 300_000);
    db.lockError = lockTimeout();

    const result = await getFactForUser("userA", deps);

    expect(result).toEqual({ fact: prior, stale: true });
    expect(openai).not.toHaveBeenCalled();
  });

  it("throws UPSTREAM_FAILED when there is no prior fact", async () => {
    db.lockError = lockTimeout();
    await expectAppError(getFactForUser("userA", deps), "UPSTREAM_FAILED");
  });

  it("rethrows other database errors", async () => {
    db.lockError = new Error("connection reset");
    await expect(getFactForUser("userA", deps)).rejects.toThrow("connection reset");
  });
});

// ── Guards ────────────────────────────────────────────────────────────────────

describe("guards", () => {
  it("throws NO_MOVIE when the user has no movie", async () => {
    await expectAppError(getFactForUser("nobody", deps), "NO_MOVIE");
    expect(openai).not.toHaveBeenCalled();
  });

  it("throws RATE_LIMITED with retryAfterMs past the limit", async () => {
    deps.rateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
    for (let i = 0; i < 30; i++) await getFactForUser("userA", deps);

    const err = await expectAppError(getFactForUser("userA", deps), "RATE_LIMITED");
    expect(err.status).toBe(429);
    expect(err.error).toMatchObject({ retryAfterMs: 60_000 });
    expect(openai).toHaveBeenCalledTimes(1);
  });
});

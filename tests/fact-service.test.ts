// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Fact, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getFactForUser, type FactServiceDeps } from "@/lib/fact-service";
import { createRateLimiter } from "@/lib/rate-limit";
import { AppErrorException, OpenAiError } from "@/lib/errors";

// ── In-memory stand-in for the Prisma calls the service makes ─────────────────

type FakeDb = {
  facts: Fact[];
  movies: Map<string, string>;
  onLock?: () => void;
  lockError?: unknown;
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
        return title ? { title } : null;
      },
    },
    fact: {
      findFirst: async ({ where }: { where: { userId: string; movieTitle: string } }) =>
        byUserAndTitle(where)[0] ?? null,
      findMany: async ({ where, take }: { where: { userId: string; movieTitle: string }; take: number }) =>
        byUserAndTitle(where).slice(0, take),
      create: async ({ data }: { data: Omit<Fact, "id"> }) => {
        const fact = { id: `f${++seq}`, ...data };
        db.facts.push(fact);
        return fact;
      },
    },
    $executeRawUnsafe: async () => 0,
    $executeRaw: async () => {
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
let deps: FactServiceDeps;

beforeEach(() => {
  now = T0;
  db = { facts: [], movies: new Map([["userA", "Heat"], ["userB", "Heat"]]) };
  let n = 0;
  openai = vi.fn(async () => `fact #${++n}`);
  deps = {
    clock: { now: () => now },
    openai: openai as unknown as FactServiceDeps["openai"],
    prisma: fakePrisma(db),
    rateLimiter: createRateLimiter({ limit: 1_000, windowMs: 60_000 }),
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
  it("is the last 3 facts for this user and this exact title only", async () => {
    for (let i = 1; i <= 5; i++) seedFact(db, "userA", "Heat", `A heat ${i}`, T0 - 600_000 + i * 1_000);
    seedFact(db, "userA", "heat", "A lowercase title", T0 - 100_000);
    seedFact(db, "userA", "Alien", "A other movie", T0 - 100_000);
    seedFact(db, "userB", "Heat", "B same movie", T0 - 100_000);

    await getFactForUser("userA", deps);

    expect(openai).toHaveBeenCalledWith("Heat", ["A heat 5", "A heat 4", "A heat 3"], expect.any(AbortSignal));
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

// @vitest-environment node
// GET /api/facts/history against real Postgres: authorization, keyset ordering and
// pagination, validation, refusal skipping, rate limit. Skip with SKIP_PG_TESTS=1.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { User } from "@prisma/client";
import { NextRequest } from "next/server";
import { cleanupUsers, createUser, skipPg } from "./helpers/pg";

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", async () => {
  const { createTestPrisma } = await import("./helpers/pg");
  return { prisma: createTestPrisma() };
});

const { prisma } = await import("@/lib/prisma");
const { GET } = await import("@/app/api/facts/history/route");
const { factHistoryRateLimiter, FACT_HISTORY_RATE_LIMIT } = await import("@/lib/rate-limit");

const REFUSAL = "I'm sorry, but I don't have information about that film beyond my training data.";
const T0 = Date.parse("2026-11-18T12:00:00.000Z");

describe.skipIf(skipPg)("GET /api/facts/history (real Postgres)", () => {
  let userA: User;
  let userB: User;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    factHistoryRateLimiter.reset();
    userA = await createUser(prisma, "Heat");
    userB = await createUser(prisma, "Heat");
    createdIds.push(userA.id, userB.id);
    authMock.mockResolvedValue({ user: { id: userA.id } });
  });

  afterAll(async () => {
    await cleanupUsers(prisma, createdIds);
    await prisma.$disconnect();
  });

  /** Seeds facts for a user; `at` is ms after T0. Returns them in expected history order. */
  async function seed(user: User, rows: Array<{ content: string; at: number; movieTitle?: string }>) {
    const created = [];
    for (const r of rows) {
      created.push(
        await prisma.fact.create({
          data: { userId: user.id, movieTitle: r.movieTitle ?? "Heat", content: r.content, createdAt: new Date(T0 + r.at) },
        }),
      );
    }
    return created.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  }

  async function get(query = "") {
    const res = await GET(new NextRequest(new URL(`http://localhost/api/facts/history${query}`)));
    return { status: res.status, headers: res.headers, body: await res.json() };
  }

  /** Follows nextCursor until null; returns every item seen. */
  async function walk(limit: number) {
    const seen: Array<{ id: string; content: string }> = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i++) {
      const { body } = await get(`?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
      expect(body.ok).toBe(true);
      seen.push(...body.data.items);
      cursor = body.data.nextCursor;
      if (!cursor) return seen;
    }
    throw new Error("pagination did not terminate");
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  it("401 without a session, with no-store", async () => {
    authMock.mockResolvedValue(null);
    const { status, headers, body } = await get();
    expect(status).toBe(401);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  // ── Pagination and ordering ───────────────────────────────────────────────

  it("first page: default limit 10, newest first, nextCursor = last item's id, no-store", async () => {
    const expected = await seed(
      userA,
      Array.from({ length: 25 }, (_, i) => ({ content: `A fact ${i}`, at: i * 1_000 })),
    );

    const { status, headers, body } = await get();

    expect(status).toBe(200);
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(body.data.items.map((f: { id: string }) => f.id)).toEqual(expected.slice(0, 10).map((f) => f.id));
    expect(body.data.nextCursor).toBe(expected[9].id);
    expect(body.data.items[0]).toEqual({
      id: expected[0].id,
      movieTitle: "Heat",
      content: "A fact 24",
      createdAt: expected[0].createdAt.toISOString(),
    });
  });

  it("next page and last page: continues after the cursor, nextCursor null at the end", async () => {
    const expected = await seed(userA, Array.from({ length: 25 }, (_, i) => ({ content: `A ${i}`, at: i * 1_000 })));

    const page2 = await get(`?cursor=${expected[9].id}`);
    expect(page2.body.data.items.map((f: { id: string }) => f.id)).toEqual(expected.slice(10, 20).map((f) => f.id));
    expect(page2.body.data.nextCursor).toBe(expected[19].id);

    const page3 = await get(`?cursor=${expected[19].id}`);
    expect(page3.body.data.items.map((f: { id: string }) => f.id)).toEqual(expected.slice(20).map((f) => f.id));
    expect(page3.body.data.nextCursor).toBeNull();
  });

  it("an exactly full last page still ends with nextCursor null", async () => {
    await seed(userA, Array.from({ length: 10 }, (_, i) => ({ content: `A ${i}`, at: i })));
    const { body } = await get();
    expect(body.data.items).toHaveLength(10);
    expect(body.data.nextCursor).toBeNull();
  });

  it("no facts: empty list, nextCursor null", async () => {
    const { body } = await get();
    expect(body.data).toEqual({ items: [], nextCursor: null });
  });

  it("orders ties on createdAt by id, and paging through them never skips or repeats a fact", async () => {
    const expected = await seed(userA, [
      ...Array.from({ length: 4 }, (_, i) => ({ content: `same time ${i}`, at: 5_000 })),
      ...Array.from({ length: 4 }, (_, i) => ({ content: `earlier ${i}`, at: i })),
      ...Array.from({ length: 3 }, (_, i) => ({ content: `later ${i}`, at: 9_000 + i })),
    ]);

    const seen = await walk(3);
    expect(seen.map((f) => f.id)).toEqual(expected.map((f) => f.id));
    expect(new Set(seen.map((f) => f.id)).size).toBe(expected.length);
  });

  it("includes facts for every movie the user has had, with the title on each", async () => {
    await seed(userA, [
      { content: "about Heat", at: 0, movieTitle: "Heat" },
      { content: "about Alien", at: 1_000, movieTitle: "Alien" },
    ]);
    const { body } = await get();
    expect(body.data.items.map((f: { movieTitle: string }) => f.movieTitle)).toEqual(["Alien", "Heat"]);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it.each(["0", "51", "-1", "abc", "1.5", "1e3"])("400 VALIDATION for limit=%s", async (limit) => {
    const { status, body } = await get(`?limit=${limit}`);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fieldErrors).toHaveProperty("limit");
  });

  it("accepts limit=1 and limit=50", async () => {
    await seed(userA, Array.from({ length: 60 }, (_, i) => ({ content: `A ${i}`, at: i })));
    expect((await get("?limit=1")).body.data.items).toHaveLength(1);
    expect((await get("?limit=50")).body.data.items).toHaveLength(50);
  });

  it.each([
    ["an id that doesn't exist", "clnotarealid000000000000"],
    ["a malformed value", "..%2F..%2Fetc"],
    ["a too-long value", "a".repeat(65)],
  ])("400 'Invalid cursor' for %s", async (_label, cursor) => {
    const { status, body } = await get(`?cursor=${cursor}`);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.fieldErrors).toHaveProperty("cursor");
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  it("returns only the signed-in user's facts", async () => {
    await seed(userA, [{ content: "A's own", at: 0 }]);
    await seed(userB, [{ content: "B's secret", at: 1_000 }]);

    const { body } = await get();
    expect(body.data.items.map((f: { content: string }) => f.content)).toEqual(["A's own"]);
  });

  it("ignores a forged ?userId= (the user always comes from the session)", async () => {
    await seed(userA, [{ content: "A's own", at: 0 }]);
    await seed(userB, [{ content: "B's secret", at: 1_000 }]);

    const { status, body } = await get(`?userId=${userB.id}&user=${userB.id}`);
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("B's secret");
  });

  it("treats a cursor pointing at another user's fact as invalid and leaks nothing", async () => {
    await seed(userA, Array.from({ length: 3 }, (_, i) => ({ content: `A ${i}`, at: i * 1_000 })));
    const [bNewest] = await seed(userB, [
      { content: "B's secret 1", at: 10_000 },
      { content: "B's secret 2", at: 500 },
    ]);

    const { status, body } = await get(`?cursor=${bNewest.id}`);

    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: "VALIDATION", message: "Invalid cursor" });
    expect(JSON.stringify(body)).not.toMatch(/B's secret|A \d/);
  });

  // ── Refusal rows ──────────────────────────────────────────────────────────

  it("skips refusal rows, and pages stay full", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({
      content: i % 3 === 0 ? REFUSAL : `good ${i}`,
      at: i * 1_000,
    }));
    const expectedGood = (await seed(userA, rows)).filter((f) => f.content !== REFUSAL);

    const first = await get("?limit=5");
    expect(first.body.data.items).toHaveLength(5);
    expect(first.body.data.items.every((f: { content: string }) => f.content !== REFUSAL)).toBe(true);

    const all = await walk(5);
    expect(all.map((f) => f.id)).toEqual(expectedGood.map((f) => f.id));
  });

  it("a long run of refusal rows (past the per-request scan cap) still reaches the real facts", async () => {
    const [good] = await seed(userA, [{ content: "the only real fact", at: 0 }]);
    await seed(userA, Array.from({ length: 15 }, (_, i) => ({ content: REFUSAL, at: 1_000 + i })));

    const all = await walk(1); // batches of 2 rows, at most 5 per request → needs several requests
    expect(all.map((f) => f.id)).toEqual([good.id]);
  });

  // ── Rate limit ────────────────────────────────────────────────────────────

  it("429 RATE_LIMITED with Retry-After past 30 requests a minute, per user", async () => {
    expect(FACT_HISTORY_RATE_LIMIT).toEqual({ limit: 30, windowMs: 60_000 });
    for (let i = 0; i < 30; i++) expect((await get()).status).toBe(200);

    const { status, headers, body } = await get();
    expect(status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(Number(headers.get("Retry-After"))).toBeGreaterThan(0);

    authMock.mockResolvedValue({ user: { id: userB.id } });
    expect((await get()).status).toBe(200);
  });
});

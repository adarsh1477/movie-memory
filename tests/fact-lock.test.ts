// @vitest-environment node
// Real Postgres (docker compose up -d). Skip with SKIP_PG_TESTS=1.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getFactForUser, type FactServiceDeps } from "@/lib/fact-service";
import { createRateLimiter } from "@/lib/rate-limit";
import { cleanupUsers, createTestPrisma, createUser, skipPg, sleep } from "./helpers/pg";

describe.skipIf(skipPg)("fact lock (real Postgres)", () => {
  let prisma: PrismaClient;
  const userIds: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanupUsers(prisma, userIds);
    await prisma.$disconnect();
  });

  async function newUser() {
    const user = await createUser(prisma, "Heat");
    userIds.push(user.id);
    return user;
  }

  function depsWith(openai: FactServiceDeps["openai"]): FactServiceDeps {
    return { prisma, openai, rateLimiter: createRateLimiter({ limit: 1_000, windowMs: 60_000 }) };
  }

  it("10 concurrent requests → exactly one OpenAI call, same fact for all", async () => {
    const user = await newUser();
    const openai = vi.fn(async () => {
      await sleep(200);
      return "one and only fact";
    });
    const deps = depsWith(openai);

    const results = await Promise.all(Array.from({ length: 10 }, () => getFactForUser(user.id, deps)));

    expect(openai).toHaveBeenCalledTimes(1);
    const ids = new Set(results.map((r) => r.fact.id));
    expect(ids.size).toBe(1);
    expect(results.every((r) => !r.stale)).toBe(true);
    expect(await prisma.fact.count({ where: { userId: user.id } })).toBe(1);
  });

  it("holder takes 7s (< lock_timeout) → waiter gets the just-written row, not an error", async () => {
    const user = await newUser();
    const openai = vi.fn(async () => {
      await sleep(7_000);
      return "slow fact";
    });
    const deps = depsWith(openai);

    const holder = getFactForUser(user.id, deps);
    await sleep(300);
    const waiter = getFactForUser(user.id, deps);

    const [a, b] = await Promise.all([holder, waiter]);
    expect(openai).toHaveBeenCalledTimes(1);
    expect(b.fact.id).toBe(a.fact.id);
    expect(b.stale).toBe(false);
  }, 20_000);

  it("holder stuck past lock_timeout → waiter gets the prior fact with stale: true", async () => {
    const user = await newUser();
    const prior = await prisma.fact.create({
      data: { userId: user.id, movieTitle: "Heat", content: "prior fact", createdAt: new Date(Date.now() - 300_000) },
    });
    // Ignores its deadline on purpose to hold the lock for 11s (> 10s lock_timeout).
    const openai = vi.fn(async () => {
      await sleep(11_000);
      return "very slow fact";
    });
    const deps = depsWith(openai);

    const holder = getFactForUser(user.id, deps);
    await sleep(300);
    const waiter = await getFactForUser(user.id, deps);

    expect(waiter).toMatchObject({ stale: true, fact: { id: prior.id } });
    await holder;
    expect(openai).toHaveBeenCalledTimes(1);
  }, 25_000);
});

// @vitest-environment node
// Service-level authorization against real Postgres. Route-level version comes in Stage 7.
// Skip with SKIP_PG_TESTS=1.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { PrismaClient, User } from "@prisma/client";
import { getFactForUser, type FactServiceDeps } from "@/lib/fact-service";
import { createRateLimiter } from "@/lib/rate-limit";
import { OpenAiError } from "@/lib/errors";
import { cleanupUsers, createTestPrisma, createUser, skipPg } from "./helpers/pg";

describe.skipIf(skipPg)("fact authorization (real Postgres)", () => {
  let prisma: PrismaClient;
  let userA: User;
  let userB: User;
  let openai: ReturnType<typeof vi.fn>;
  let deps: FactServiceDeps;
  const createdIds: string[] = [];

  beforeAll(async () => {
    prisma = createTestPrisma();
    await prisma.$connect();
  });

  beforeEach(async () => {
    // Same movie title for both users, so only userId separates their facts.
    userA = await createUser(prisma, "Heat");
    userB = await createUser(prisma, "Heat");
    createdIds.push(userA.id, userB.id);
    openai = vi.fn(async () => ({ content: "fresh fact for A", mode: "knowledge" }));
    deps = {
      prisma,
      openai: openai as unknown as FactServiceDeps["openai"],
      rateLimiter: createRateLimiter({ limit: 1_000, windowMs: 60_000 }),
    };
  });

  afterAll(async () => {
    await cleanupUsers(prisma, createdIds);
    await prisma.$disconnect();
  });

  async function seed(user: User, content: string, ageMs: number) {
    return prisma.fact.create({
      data: { userId: user.id, movieTitle: "Heat", content, createdAt: new Date(Date.now() - ageMs) },
    });
  }

  it("does not serve B's fresh fact to A from the cache", async () => {
    await seed(userB, "B fresh", 5_000);

    const result = await getFactForUser(userA.id, deps);

    expect(result.fact.userId).toBe(userA.id);
    expect(result.fact.content).toBe("fresh fact for A");
    expect(openai).toHaveBeenCalledTimes(1);
  });

  it("does not put B's facts in A's avoid list", async () => {
    await seed(userB, "B one", 120_000);
    await seed(userB, "B two", 110_000);
    await seed(userA, "A one", 300_000);

    await getFactForUser(userA.id, deps);

    expect(openai).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Heat", year: null, details: null }),
      ["A one"],
      expect.any(AbortSignal),
    );
  });

  it("falls back to A's own older fact, never B's newer one", async () => {
    const aOld = await seed(userA, "A old", 600_000);
    await seed(userB, "B newer", 120_000);
    openai.mockRejectedValueOnce(new OpenAiError("down"));

    const result = await getFactForUser(userA.id, deps);

    expect(result).toMatchObject({ stale: true, fact: { id: aOld.id, userId: userA.id } });
  });

  it("errors instead of falling back to B's fact when A has none", async () => {
    await seed(userB, "B only", 120_000);
    openai.mockRejectedValueOnce(new OpenAiError("down"));

    await expect(getFactForUser(userA.id, deps)).rejects.toMatchObject({ error: { code: "UPSTREAM_FAILED" } });
  });

  it("stores new facts under the requesting user only", async () => {
    await getFactForUser(userA.id, deps);

    expect(await prisma.fact.count({ where: { userId: userA.id } })).toBe(1);
    expect(await prisma.fact.count({ where: { userId: userB.id } })).toBe(0);
  });
});

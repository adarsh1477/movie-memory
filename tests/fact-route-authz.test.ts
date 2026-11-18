// @vitest-environment node
// Route-level authorization for GET /api/fact against real Postgres.
// The service-level version is tests/fact-authz.test.ts. Skip with SKIP_PG_TESTS=1.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { User } from "@prisma/client";
import { cleanupUsers, createUser, skipPg } from "./helpers/pg";

const authMock = vi.fn();
const generateFactMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", async () => {
  const { createTestPrisma } = await import("./helpers/pg");
  return { prisma: createTestPrisma() };
});
vi.mock("@/lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/openai")>()),
  generateFact: (...args: unknown[]) => generateFactMock(...args),
}));

const { prisma } = await import("@/lib/prisma");
const { GET } = await import("@/app/api/fact/route");
const { factRateLimiter } = await import("@/lib/rate-limit");

describe.skipIf(skipPg)("GET /api/fact authorization (real Postgres)", () => {
  let userA: User;
  let userB: User;
  const createdIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    factRateLimiter.reset();
    userA = await createUser(prisma, "Heat");
    userB = await createUser(prisma, "Heat");
    createdIds.push(userA.id, userB.id);
    generateFactMock.mockReset().mockResolvedValue({ content: "fresh fact for the caller", mode: "knowledge" });
  });

  afterAll(async () => {
    await cleanupUsers(prisma, createdIds);
    await prisma.$disconnect();
  });

  const as = (user: User | null) => authMock.mockResolvedValue(user ? { user: { id: user.id } } : null);

  it("user B never receives user A's fresh fact for the same title", async () => {
    await prisma.fact.create({
      data: { userId: userA.id, movieTitle: "Heat", content: "A's secret fact", createdAt: new Date() },
    });
    as(userB);

    const body = await (await GET()).json();

    expect(body.ok).toBe(true);
    expect(body.data.content).toBe("fresh fact for the caller");
    expect(await prisma.fact.count({ where: { userId: userB.id } })).toBe(1);
    expect(await prisma.fact.count({ where: { userId: userA.id } })).toBe(1);
  });

  it("each user's response comes only from their own rows", async () => {
    await prisma.fact.create({
      data: { userId: userA.id, movieTitle: "Heat", content: "A's fact", createdAt: new Date() },
    });
    await prisma.fact.create({
      data: { userId: userB.id, movieTitle: "Heat", content: "B's fact", createdAt: new Date() },
    });

    as(userA);
    expect((await (await GET()).json()).data.content).toBe("A's fact");
    as(userB);
    expect((await (await GET()).json()).data.content).toBe("B's fact");
    expect(generateFactMock).not.toHaveBeenCalled();
  });

  it("401 without a session, and no fact is generated", async () => {
    as(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(generateFactMock).not.toHaveBeenCalled();
  });
});

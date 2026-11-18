import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Local docker-compose Postgres by default (credentials are in docker-compose.yml).
// CI or a separate test DB can override with PG_TEST_URL.
const url =
  process.env.PG_TEST_URL ??
  "postgresql://movie:movie@localhost:5433/movie_memory?connection_limit=20";

export const skipPg = process.env.SKIP_PG_TESTS === "1";

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: url });
}

/** Creates a throwaway user with a favorite movie. Delete with `cleanupUsers`. */
export async function createUser(prisma: PrismaClient, movieTitle: string) {
  const tag = randomUUID();
  return prisma.user.create({
    data: {
      email: `pg-test-${tag}@test.invalid`,
      name: "PG Test",
      movie: { create: { title: movieTitle } },
    },
  });
}

/** Facts, movies and sessions cascade from User. */
export async function cleanupUsers(prisma: PrismaClient, ids: string[]) {
  if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import type { MeResponse } from "./validation";

/** The signed-in user's profile + movie, shaped for the API. Null if the user row is gone. */
export async function loadMe(userId: string, db: PrismaClient = defaultPrisma): Promise<MeResponse | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      movie: { select: { title: true, tmdbId: true, year: true, posterPath: true, updatedAt: true } },
    },
  });
  if (!user) return null;

  return {
    user: { id: user.id, name: user.name, email: user.email, image: user.image },
    movie: user.movie ? { ...user.movie, updatedAt: user.movie.updatedAt.toISOString() } : null,
  };
}

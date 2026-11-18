import type { Movie, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import { searchMovies as defaultSearch } from "./tmdb";
import { AppErrorException } from "./errors";
import { SEARCH_MIN_CHARS, type MovieSaveInput } from "./validation";

export type MovieServiceDeps = {
  prisma?: PrismaClient;
  search?: typeof defaultSearch;
};

export const PICK_FROM_SUGGESTIONS = "Pick your movie from the suggestions so we get the right film.";

/**
 * Saves the user's favorite movie (onboarding and inline edit share this).
 * `input` must already be Zod-validated. `userId` must come from the session.
 *
 * - A selected TMDB result stores tmdbId, year and posterPath with the title.
 * - Free text is accepted only when TMDB search is degraded or has no match,
 *   and it clears any previous TMDB fields.
 *
 * Throws AppErrorException(VALIDATION) when free text should have been a pick.
 */
export async function saveMovieForUser(
  userId: string,
  input: MovieSaveInput,
  deps: MovieServiceDeps = {},
): Promise<Movie> {
  const db = deps.prisma ?? defaultPrisma;
  const search = deps.search ?? defaultSearch;
  const { title, tmdbId, year, posterPath } = input;

  if (tmdbId === undefined && title.length >= SEARCH_MIN_CHARS) {
    const result = await search(title);
    if (!result.degraded && result.results.length > 0) {
      throw new AppErrorException({
        code: "VALIDATION",
        message: PICK_FROM_SUGGESTIONS,
        fieldErrors: { title: PICK_FROM_SUGGESTIONS },
      });
    }
  }

  const movie = {
    title,
    tmdbId: tmdbId ?? null,
    year: tmdbId === undefined ? null : (year ?? null),
    posterPath: tmdbId === undefined ? null : (posterPath ?? null),
  };

  return db.movie.upsert({
    where: { userId },
    create: { userId, ...movie },
    update: movie,
  });
}

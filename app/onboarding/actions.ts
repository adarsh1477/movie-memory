"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { searchMovies } from "@/lib/tmdb";
import { SEARCH_MIN_CHARS, parseMovieForm } from "@/lib/validation";

export type SaveMovieState = { error?: string };

export async function saveMovie(
  _prevState: SaveMovieState,
  formData: FormData
): Promise<SaveMovieState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  const userId = session.user.id;

  const parsed = parseMovieForm(formData);
  if (!parsed.success) {
    const issue = parsed.error.errors[0];
    return { error: issue.path[0] === "title" ? issue.message : "That selection looks invalid. Please pick the movie again." };
  }
  const { title, tmdbId, year, posterPath } = parsed.data;

  // Free text is only for when search can't help: TMDB is down, or it has no match.
  if (tmdbId === undefined && title.length >= SEARCH_MIN_CHARS) {
    const search = await searchMovies(title);
    if (!search.degraded && search.results.length > 0) {
      return { error: "Pick your movie from the suggestions so we get the right film." };
    }
  }

  const movie = {
    title,
    tmdbId: tmdbId ?? null,
    year: tmdbId === undefined ? null : (year ?? null),
    posterPath: tmdbId === undefined ? null : (posterPath ?? null),
  };

  try {
    await prisma.movie.upsert({
      where: { userId },
      create: { userId, ...movie },
      update: movie,
    });
  } catch {
    return { error: "Could not save your movie. Please try again." };
  }

  redirect("/dashboard");
}

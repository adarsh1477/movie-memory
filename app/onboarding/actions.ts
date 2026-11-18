"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppErrorException } from "@/lib/errors";
import { saveMovieForUser } from "@/lib/movie-service";
import { parseMovieForm } from "@/lib/validation";

export type SaveMovieState = { error?: string };

export async function saveMovie(
  _prevState: SaveMovieState,
  formData: FormData
): Promise<SaveMovieState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const parsed = parseMovieForm(formData);
  if (!parsed.success) {
    const issue = parsed.error.errors[0];
    return { error: issue.path[0] === "title" ? issue.message : "That selection looks invalid. Please pick the movie again." };
  }

  try {
    await saveMovieForUser(session.user.id, parsed.data);
  } catch (err) {
    if (err instanceof AppErrorException) return { error: err.error.message };
    return { error: "Could not save your movie. Please try again." };
  }

  redirect("/dashboard");
}

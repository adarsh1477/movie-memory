"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { movieTitleSchema } from "@/lib/validation";

export type SaveMovieState = { error?: string };

export async function saveMovie(
  _prevState: SaveMovieState,
  formData: FormData
): Promise<SaveMovieState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const raw = formData.get("title");
  const result = movieTitleSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.errors[0].message };
  }

  try {
    await prisma.movie.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, title: result.data },
      update: { title: result.data },
    });
  } catch {
    return { error: "Could not save your movie. Please try again." };
  }

  redirect("/dashboard");
}

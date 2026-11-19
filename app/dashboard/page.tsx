import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardNav from "@/components/DashboardNav";
import MovieHeroCard from "@/components/MovieHeroCard";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { movie: true },
  });

  if (!user?.movie) redirect("/onboarding");

  const { movie } = user;

  return (
    <>
      <DashboardNav user={{ name: user.name, email: user.email, image: user.image }} />

      <main className="flex-1">
        {/* Client component: inline edit updates title, year, poster and backdrop optimistically. */}
        <MovieHeroCard
          userId={user.id}
          movie={{ title: movie.title, tmdbId: movie.tmdbId, year: movie.year, posterPath: movie.posterPath }}
        />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
          <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-xs text-text-muted opacity-40">Built as a take-home project</p>
            <p className="text-xs text-text-muted">
              Movie data provided by{" "}
              <a
                href="https://www.themoviedb.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors duration-150 hover:text-text"
              >
                TMDB
              </a>
              {" · "}
              {/* Wikipedia text is CC BY-SA 4.0: facts for newer films may draw on it. */}
              Production notes from{" "}
              <a
                href="https://en.wikipedia.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors duration-150 hover:text-text"
              >
                Wikipedia
              </a>{" "}
              (
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors duration-150 hover:text-text"
              >
                CC BY-SA
              </a>
              )
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardNav from "@/components/DashboardNav";
import FactCard from "@/components/FactCard";

// ─── Utility ─────────────────────────────────────────────────────────────────

const MINOR = new Set([
  "a","an","the","and","but","or","nor","for","yet","so",
  "at","by","in","of","on","to","up","as",
]);

function toTitleCase(str: string): string {
  const words = str.toLowerCase().split(" ");
  return words
    .map((word, i) =>
      i === 0 || i === words.length - 1 || !MINOR.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word,
    )
    .join(" ");
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconEdit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M14.5 2.5a2.121 2.121 0 0 1 3 3L6 17H3v-3L14.5 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="7" x2="19" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Film-frame fallback (no poster) ─────────────────────────────────────────

function FilmFallback({ title }: { title: string }) {
  return (
    <div
      className="flex h-full w-full flex-col bg-gradient-to-br from-surface-raised via-[#1a1510] to-border"
      aria-label={`No poster available for ${title}`}
    >
      <div className="flex h-7 items-center justify-around bg-black/30 px-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 w-2.5 rounded-sm bg-background/55" />
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center">
        <IconFilm className="h-12 w-12 text-text-muted opacity-20" />
      </div>
      <div className="flex h-7 items-center justify-around bg-black/30 px-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-4 w-2.5 rounded-sm bg-background/55" />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { movie: true },
  });

  if (!user?.movie) redirect("/onboarding");

  const { movie } = user;
  // TMDB titles are canonical ("WALL·E", "M3GAN"); only tidy up free-text ones.
  const displayTitle = movie.tmdbId ? movie.title : toTitleCase(movie.title);

  const userProps = {
    name: user.name,
    email: user.email!,
    image: user.image,
  };

  return (
    <>
      <DashboardNav user={userProps} />

      <main className="flex-1">
        {/* ── Cinematic hero ───────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          {/* ── Backdrop ── */}
          <div className="absolute inset-0" aria-hidden="true">
            {movie.posterPath ? (
              <>
                {/* Blurred + scaled poster */}
                <div className="absolute inset-0 overflow-hidden">
                  <Image
                    src={`https://image.tmdb.org/t/p/w780${movie.posterPath}`}
                    fill
                    alt=""
                    priority
                    className="scale-125 object-cover"
                    style={{ filter: "blur(72px)", opacity: 0.5 }}
                    sizes="100vw"
                  />
                </div>
                {/* Dark base */}
                <div className="absolute inset-0 bg-background/55" />
              </>
            ) : (
              /* Warm cinematic gradient fallback — glows follow content area (top ~35 %) */
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(ellipse 70% 55% at 18% 35%, rgba(90,52,0,0.5) 0%, transparent 55%), " +
                    "radial-gradient(ellipse 55% 45% at 75% 25%, rgba(50,28,0,0.4) 0%, transparent 55%), " +
                    "radial-gradient(ellipse 90% 60% at 50% 85%, rgba(15,8,0,0.55) 0%, transparent 65%)",
                }}
              />
            )}

            {/* Top vignette — blends backdrop into the nav */}
            <div
              className="absolute inset-x-0 top-0 h-48"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(11,11,15,0.65) 0%, transparent 100%)",
              }}
            />

            {/* Bottom vignette — fades into page background */}
            <div
              className="absolute inset-x-0 bottom-0 h-72"
              style={{
                background:
                  "linear-gradient(to bottom, transparent 0%, rgba(11,11,15,0.88) 55%, #0B0B0F 100%)",
              }}
            />
          </div>

          {/* ── Content ── */}
          <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
            <div className="flex flex-col gap-10 pb-24 pt-12 md:pt-16 lg:flex-row lg:items-start lg:gap-16 lg:pt-20 xl:pt-20">

              {/* Poster card */}
              <div
                className="motion-safe:animate-fade-up flex-shrink-0 self-center lg:self-start"
                style={{ animationDelay: "0ms" }}
              >
                <div
                  className="relative overflow-hidden rounded-2xl"
                  style={{
                    width: "clamp(160px, 18vw, 280px)",
                    aspectRatio: "2/3",
                    boxShadow: movie.posterPath
                      ? "0 32px 80px rgba(0,0,0,0.85), 0 0 56px rgba(245,184,65,0.18)"
                      : "0 32px 80px rgba(0,0,0,0.85)",
                  }}
                >
                  {movie.posterPath ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w500${movie.posterPath}`}
                      alt={displayTitle}
                      fill
                      priority
                      className="object-cover"
                      sizes="(max-width: 640px) 160px, (max-width: 1024px) 220px, 280px"
                    />
                  ) : (
                    <FilmFallback title={displayTitle} />
                  )}
                  {/* Inner border ring on rounded corners */}
                  <div
                    className="absolute inset-0 rounded-2xl"
                    style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" }}
                  />
                </div>
              </div>

              {/* Info + fact panel */}
              <div className="flex min-w-0 flex-1 flex-col gap-5">

                {/* Movie title row */}
                <div
                  className="motion-safe:animate-fade-up"
                  style={{ animationDelay: "80ms" }}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                    Your favorite movie
                  </p>
                  <div className="mt-2 flex items-start gap-3">
                    <h1 className="flex-1 text-3xl font-semibold leading-tight text-text sm:text-4xl lg:text-[2.75rem] lg:leading-[1.12]">
                      {displayTitle}
                      {movie.year && (
                        <span className="ml-3 align-middle text-lg font-normal tabular-nums text-text-muted sm:text-xl">
                          {movie.year}
                        </span>
                      )}
                    </h1>
                    {/* Edit button — wired in Stage 8 */}
                    <button
                      type="button"
                      aria-label="Edit favorite movie"
                      disabled
                      className="mt-1.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-text-muted backdrop-blur-sm transition-colors duration-150 hover:border-white/20 hover:text-text disabled:opacity-30"
                    >
                      <IconEdit className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Glass fact panel */}
                <div
                  className="motion-safe:animate-fade-up"
                  style={{ animationDelay: "160ms" }}
                >
                  <FactCard movieTitle={displayTitle} />
                </div>

              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
          <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-xs text-text-muted opacity-40">
              Built as a take-home project
            </p>
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-muted transition-colors duration-150 hover:text-text"
            >
              Movie data provided by TMDB
            </a>
          </div>
        </div>
      </footer>
    </>
  );
}

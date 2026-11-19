import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignInButton from "@/components/SignInButton";
import MockCardPreview from "@/components/MockCardPreview";
import PosterBackground from "@/components/PosterBackground";
import FactCarousel from "@/components/FactCarousel";
import ScrollFade from "@/components/ScrollFade";
import Logo from "@/components/Logo";
import { getPosterWall } from "@/lib/poster-wall";

// ─── Icons ───────────────────────────────────────────────────────────────────

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="3" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="7" x2="19" y2="7" stroke="currentColor" strokeWidth="1.5" />
      <line x1="1" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="8.75" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="13.5" y="3" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="4" y="13" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="8.75" y="13" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <rect x="13.5" y="13" width="1.5" height="4" rx="0.5" fill="currentColor" />
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconSparkle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M10 2v3M10 15v3M2 10h3M15 10h3M4.4 4.4l2.1 2.1M13.5 13.5l2.1 2.1M4.4 15.6l2.1-2.1M13.5 6.5l2.1-2.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconRefresh({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M14.5 5.5A7 7 0 1 0 17 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M17 6.5V10h-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconClock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 6v4l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShuffle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M2 7h10M2 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M12 5l3 2-3 2M12 11l3 2-3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M10 2L3 5v5c0 4 2.9 6.9 7 8 4.1-1.1 7-4 7-8V5l-7-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10l2 2 3-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDevices({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="2" y="4" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 17h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="14" y="8" width="4" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// ─── Section eyebrow ──────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-accent">
      {children}
    </p>
  );
}

// ─── How it works — step ──────────────────────────────────────────────────────

function HowStep({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group flex flex-col gap-3 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent transition-colors duration-200 group-hover:bg-accent/20">
        {icon}
      </div>
      <div>
        <p className="font-semibold text-text">{title}</p>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p>
      </div>
    </div>
  );
}

// ─── Built with care — card ───────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
        {icon}
      </div>
      <p className="font-semibold text-text">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function Home() {
  const session = await auth();

  if (session?.user?.id) {
    const movie = await prisma.movie.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    redirect(movie ? "/dashboard" : "/onboarding");
  }

  const posters = await getPosterWall();

  return (
    <>
      <PosterBackground posters={posters} />

      {/* ── Sticky nav ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
          <Logo />
          <SignInButton variant="nav" />
        </div>
      </header>

      <main className="flex-1">
        {/* Ambient amber gradients */}
        <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden="true">
          <div
            className="absolute inset-x-0 top-0 h-[480px] 2xl:h-[800px]"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(245,184,65,0.055) 0%, transparent 70%)",
            }}
          />
          <div
            className="absolute right-0 top-1/4 h-[500px] w-1/2 2xl:h-[900px] 2xl:w-2/3"
            style={{
              background:
                "radial-gradient(ellipse 70% 60% at 80% 50%, rgba(245,184,65,0.065) 0%, transparent 65%)",
            }}
          />
        </div>

        {/* ── 1. Hero ── */}
        <section className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28 2xl:flex 2xl:max-w-[1600px] 2xl:min-h-[calc(100vh-4rem)] 2xl:flex-col 2xl:justify-center 2xl:px-10 2xl:py-0">
          <div className="grid w-full items-center gap-12 lg:grid-cols-2 lg:gap-16 2xl:gap-24">

            {/* Copy */}
            <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
              <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent motion-safe:animate-fade-up">
                AI-powered facts
              </span>

              <h1
                className="text-4xl font-semibold tracking-tight text-text sm:text-5xl lg:text-[3.25rem] lg:leading-[1.12] motion-safe:animate-fade-up 2xl:text-[4rem] 2xl:leading-[1.1]"
                style={{ animationDelay: "80ms" }}
              >
                Your favorite film.
                <br />
                <span className="text-accent">A new fact</span> every time.
              </h1>

              <p
                className="max-w-md text-lg text-text-muted motion-safe:animate-fade-up 2xl:max-w-xl 2xl:text-xl"
                style={{ animationDelay: "160ms" }}
              >
                Pick the movie you love and get a fresh AI-generated fact every
                minute. No feed, no noise — just your film.
              </p>

              <div
                className="flex flex-col items-center gap-3 motion-safe:animate-fade-up lg:items-start"
                style={{ animationDelay: "240ms" }}
              >
                <SignInButton />
                <p className="text-xs text-text-muted">Free. Takes 10 seconds.</p>
              </div>
            </div>

            {/* Interactive mock card */}
            <div
              className="flex items-center justify-center py-8 motion-safe:animate-fade-up lg:py-0"
              style={{ animationDelay: "320ms" }}
            >
              <MockCardPreview />
            </div>
          </div>
        </section>

        {/* ── 2. How it works ── */}
        <section className="relative border-t border-border">
          <ScrollFade>
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 2xl:max-w-[1600px] 2xl:px-10 2xl:py-20">
              <Eyebrow>How it works</Eyebrow>
              <h2 className="mb-10 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
                Three steps, then you&apos;re done.
              </h2>
              <div className="grid gap-10 sm:grid-cols-3">
                <HowStep
                  icon={<IconFilm className="h-5 w-5" />}
                  title="Pick your movie"
                  description="Tell us the film you can't stop thinking about. Just the title — we handle the rest."
                />
                <HowStep
                  icon={<IconSparkle className="h-5 w-5" />}
                  title="Get a fresh fact"
                  description="Every 60 seconds our AI surfaces something you didn't know. Fresh facts, not the same one twice in a row."
                />
                <HowStep
                  icon={<IconRefresh className="h-5 w-5" />}
                  title="Come back for more"
                  description="Facts keep refreshing automatically. The more you visit, the more you discover."
                />
              </div>
            </div>
          </ScrollFade>
        </section>

        {/* ── 3. See it in action ── */}
        <section className="relative border-t border-border bg-surface/30">
          <ScrollFade>
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 2xl:max-w-[1600px] 2xl:px-10 2xl:py-20">
              <div className="mb-10 text-center">
                <Eyebrow>See it in action</Eyebrow>
                <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
                  A fresh take on a film you love.
                </h2>
                <p className="mx-auto mt-3 max-w-sm text-sm text-text-muted">
                  Here&apos;s what your dashboard shows — a new fact each minute, served from a movie you chose.
                </p>
              </div>
              <div className="relative mx-auto max-w-sm">
                {/* Subtle glow behind the fact card */}
                <div
                  className="pointer-events-none absolute -inset-4 rounded-3xl"
                  aria-hidden="true"
                  style={{ background: "radial-gradient(ellipse 90% 80% at 50% 50%, rgba(245,184,65,0.12) 0%, transparent 70%)" }}
                />
                <FactCarousel />
              </div>
            </div>
          </ScrollFade>
        </section>

        {/* ── 4. Built with care ── */}
        <section className="relative border-t border-border">
          <ScrollFade>
            <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 2xl:max-w-[1600px] 2xl:px-10 2xl:py-20">
              <Eyebrow>Built with care</Eyebrow>
              <h2 className="mb-10 text-2xl font-semibold tracking-tight text-text sm:text-3xl">
                Only what matters.
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FeatureCard
                  icon={<IconClock className="h-5 w-5" />}
                  title="Cached for 60 seconds"
                  description="Facts stay fresh without spamming the AI. One call per user per minute, at most."
                />
                <FeatureCard
                  icon={<IconShuffle className="h-5 w-5" />}
                  title="Never the same twice"
                  description="Each generation avoids the last few facts, so every visit surfaces something new."
                />
                <FeatureCard
                  icon={<IconShield className="h-5 w-5" />}
                  title="Secure Google sign-in"
                  description="One click with your Google account — no passwords, no email forms."
                />
                <FeatureCard
                  icon={<IconDevices className="h-5 w-5" />}
                  title="Works on any screen"
                  description="Fully responsive from phone to ultrawide. Looks right wherever you open it."
                />
              </div>
            </div>
          </ScrollFade>
        </section>

        {/* ── 5. Final CTA ── */}
        <section className="relative border-t border-border">
          {/* Accent glow behind the CTA */}
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(ellipse 60% 60% at 50% 100%, rgba(245,184,65,0.07) 0%, transparent 70%)",
            }}
          />
          <ScrollFade>
            <div className="mx-auto max-w-6xl px-4 py-24 text-center sm:px-6 2xl:max-w-[1600px] 2xl:px-10 2xl:py-32">
              <h2 className="text-3xl font-semibold tracking-tight text-text sm:text-4xl lg:text-[2.75rem] lg:leading-[1.12]">
                Ready to rediscover your
                <br />
                <span className="text-accent">favorite film?</span>
              </h2>
              <p className="mx-auto mt-4 max-w-sm text-text-muted">
                Sign in with Google in seconds. No password needed.
              </p>
              <div className="mt-8 flex justify-center">
                <SignInButton />
              </div>
            </div>
          </ScrollFade>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 2xl:max-w-[1600px] 2xl:px-10">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
            <Logo />
            <div className="flex flex-col items-center gap-1.5 sm:items-end">
              {posters.length > 0 && (
                <a
                  href="https://www.themoviedb.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-text-muted transition-colors duration-150 hover:text-text"
                >
                  Movie data provided by TMDB
                </a>
              )}
              <p className="text-xs text-text-muted opacity-50">
                Built as a take-home project
              </p>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}

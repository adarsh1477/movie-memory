import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import SignInButton from "@/components/SignInButton";
import MockCardPreview from "@/components/MockCardPreview";

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

// ─── Logo ─────────────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div className="flex items-center gap-2.5" aria-label="Movie Memory home">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <IconFilm className="h-5 w-5" />
      </span>
      <span className="text-base font-semibold text-text">Movie Memory</span>
    </div>
  );
}

// ─── Feature step ─────────────────────────────────────────────────────────────

function FeatureStep({
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
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          {description}
        </p>
      </div>
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

  return (
    <>
      {/* ── Sticky nav ── */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl 2xl:max-w-[1600px] items-center justify-between px-4 sm:px-6 2xl:px-10">
          <Logo />
          <SignInButton variant="nav" />
        </div>
      </header>

      {/* ── Page body ── */}
      <main className="flex-1">
        {/* Ambient background gradients */}
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

        {/* ── Hero ── */}
        <section className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28 2xl:max-w-[1600px] 2xl:px-10 2xl:flex 2xl:min-h-[calc(100vh-4rem)] 2xl:flex-col 2xl:justify-center 2xl:py-0">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16 w-full 2xl:gap-24">

            {/* Left: copy */}
            <div className="flex flex-col items-center gap-6 text-center lg:items-start lg:text-left">
              <span
                className="inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-accent motion-safe:animate-fade-up"
              >
                AI-powered facts
              </span>

              <h1
                className="text-4xl font-semibold tracking-tight text-text sm:text-5xl lg:text-[3.25rem] lg:leading-[1.12] 2xl:text-[4rem] 2xl:leading-[1.1] motion-safe:animate-fade-up"
                style={{ animationDelay: "80ms" }}
              >
                Your favorite film.
                <br />
                <span className="text-accent">A new fact</span> every time.
              </h1>

              <p
                className="max-w-md text-lg text-text-muted 2xl:text-xl 2xl:max-w-xl motion-safe:animate-fade-up"
                style={{ animationDelay: "160ms" }}
              >
                Pick the movie you love and get a fresh AI-generated fact
                every minute. No feed, no noise — just your film.
              </p>

              <div
                className="flex flex-col items-center gap-3 lg:items-start motion-safe:animate-fade-up"
                style={{ animationDelay: "240ms" }}
              >
                <SignInButton />
                <p className="text-xs text-text-muted">Free. Takes 10 seconds.</p>
              </div>
            </div>

            {/* Right: interactive mock dashboard card */}
            <div
              className="flex items-center justify-center py-8 lg:py-0 motion-safe:animate-fade-up"
              style={{ animationDelay: "320ms" }}
            >
              <MockCardPreview />
            </div>
          </div>
        </section>

        {/* ── Three-step features ── */}
        <section className="relative border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 2xl:max-w-[1600px] 2xl:px-10 2xl:py-20">
            <div className="grid gap-10 sm:grid-cols-3">
              <FeatureStep
                icon={<IconFilm className="h-5 w-5" />}
                title="Pick your movie"
                description="Tell us the film you can't stop thinking about. Just the title — we handle the rest."
              />
              <FeatureStep
                icon={<IconSparkle className="h-5 w-5" />}
                title="Get a fresh fact"
                description="Every 60 seconds our AI surfaces something you didn't know. Fresh facts, not the same one twice in a row."
              />
              <FeatureStep
                icon={<IconRefresh className="h-5 w-5" />}
                title="Come back for more"
                description="Facts keep refreshing automatically. The more you visit, the more you discover."
              />
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

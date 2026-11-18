import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTrendingPosters } from "@/lib/tmdb";
import DashboardNav from "@/components/DashboardNav";
import OnboardingForm from "@/components/OnboardingForm";
import PosterBackground from "@/components/PosterBackground";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, image: true, movie: { select: { id: true } } },
  });
  if (!user) redirect("/");
  if (user.movie) redirect("/dashboard");

  const posters = await getTrendingPosters();
  const hasPosterWall = posters.length >= 4; // PosterBackground renders nothing below 4
  const firstName = user.name?.trim().split(/\s+/)[0];

  return (
    <>
      <PosterBackground posters={posters} variant="focus" />
      {!hasPosterWall && <AmberGlow />}

      <DashboardNav user={{ name: user.name, email: user.email, image: user.image }} />

      {/* Fixed top padding below the nav (no vh centering): stable on short and tall screens. */}
      <main className="flex-1 px-4 pb-20 pt-10 sm:px-6 sm:pt-16 lg:pt-24 2xl:pt-32">
        <div className="mx-auto w-full max-w-lg 2xl:max-w-xl">
          {/* z-20: the animation makes this its own stacking context; it must sit above
              the footnote below so the open dropdown isn't painted under it. */}
          <div className="relative z-20 motion-safe:animate-fade-up">
            {/* Soft amber glow behind the card */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-6 -z-10 rounded-[2.5rem] opacity-80 blur-2xl"
              style={{
                background:
                  "radial-gradient(ellipse 60% 55% at 50% 30%, rgba(245,184,65,0.16) 0%, rgba(245,184,65,0.04) 45%, transparent 75%)",
              }}
            />

            {/* Glass card. No overflow-hidden: the search dropdown must overlay below it. */}
            <section
              aria-labelledby="onboarding-heading"
              className="relative z-10 rounded-2xl border border-white/10 bg-surface/70 p-6 shadow-[0_32px_80px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl sm:p-8"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">
                {firstName ? `Welcome, ${firstName}` : "Step 1 of 1"}
              </p>
              <h1
                id="onboarding-heading"
                className="mt-3 text-2xl font-semibold leading-tight text-text sm:text-[1.75rem]"
              >
                What&apos;s your favorite movie?
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                Pick it once and we&apos;ll surface a fresh fun fact about it every minute.
              </p>

              <div className="mt-8">
                <OnboardingForm />
              </div>
            </section>
          </div>

          <p
            className="relative z-0 mt-6 text-center text-xs text-text-muted/60 motion-safe:animate-fade-up"
            style={{ animationDelay: "120ms" }}
          >
            Movie data and posters from{" "}
            <a
              href="https://www.themoviedb.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 transition-colors duration-150 hover:text-text hover:underline"
            >
              TMDB
            </a>
          </p>
        </div>
      </main>
    </>
  );
}

function AmberGlow() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-20" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(245,184,65,0.08) 0%, transparent 70%), " +
            "radial-gradient(ellipse 50% 45% at 50% 40%, rgba(245,184,65,0.06) 0%, transparent 70%), " +
            "radial-gradient(ellipse 90% 60% at 50% 100%, rgba(15,8,0,0.55) 0%, transparent 65%)",
        }}
      />
    </div>
  );
}

import PosterImage from "./PosterImage";

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
      <circle cx="10" cy="10" r="2.25" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function MovieHeroCard({
  title,
  posterPath,
}: {
  title: string;
  posterPath: string | null;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface">
      {/* Ambient amber glow behind poster area */}
      <div
        className="pointer-events-none absolute inset-0 -z-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse 50% 70% at 15% 50%, rgba(245,184,65,0.07) 0%, transparent 65%)",
        }}
      />

      {/* Edit button — wired in Stage 8 */}
      <button
        type="button"
        aria-label="Edit favorite movie"
        disabled
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-text-muted transition-colors duration-150 hover:border-text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:opacity-40"
      >
        <IconEdit className="h-4 w-4" />
      </button>

      <div className="relative z-10 flex gap-5 p-6 sm:gap-7 sm:p-7">
        {/* Poster */}
        <PosterImage posterPath={posterPath} title={title} />

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Your favorite movie
            </p>
            <h2 className="mt-2 text-xl font-semibold leading-snug text-text sm:text-2xl">
              {title}
            </h2>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
              <IconFilm className="h-3.5 w-3.5" />
              Saved film
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

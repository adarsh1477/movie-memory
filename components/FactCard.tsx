import Skeleton from "./Skeleton";

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

export default function FactCard({ movieTitle }: { movieTitle: string }) {
  return (
    <div
      className="rounded-2xl border border-white/10 backdrop-blur-sm"
      style={{ background: "rgba(11,11,15,0.65)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-4 sm:px-6">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <IconSparkle className="h-3.5 w-3.5" />
        </span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">
            Did you know?
          </p>
          <p className="mt-0.5 text-sm text-text-muted">
            Fact about{" "}
            <span className="font-medium text-text">{movieTitle}</span>
          </p>
        </div>
      </div>

      {/* Body — skeleton while fact is loading */}
      <div className="px-5 py-5 sm:px-6">
        {/* Large decorative quote */}
        <span
          className="float-left mr-2 mt-0.5 font-serif text-4xl leading-none text-accent/25 select-none"
          aria-hidden="true"
        >
          &ldquo;
        </span>
        <div
          className="space-y-2.5"
          role="status"
          aria-label="Loading fact…"
        >
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[88%]" />
          <Skeleton className="h-4 w-[70%]" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-white/10 px-5 py-4 sm:px-6">
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-9 w-24" />
      </div>
    </div>
  );
}

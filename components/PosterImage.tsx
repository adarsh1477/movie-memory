import Image from "next/image";

function FilmIcon({ className }: { className?: string }) {
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
    </svg>
  );
}

export default function PosterImage({
  posterPath,
  title,
  className,
}: {
  posterPath: string | null;
  title: string;
  className?: string;
}) {
  if (posterPath) {
    return (
      <Image
        src={`https://image.tmdb.org/t/p/w500${posterPath}`}
        alt={title}
        width={160}
        height={240}
        className={`flex-shrink-0 rounded-xl border border-border object-cover ${className ?? ""}`}
      />
    );
  }

  return (
    <div
      className={`relative flex h-[240px] w-[160px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-gradient-to-br from-surface-raised to-border ${className ?? ""}`}
      aria-label={`No poster for ${title}`}
    >
      {/* Top film-strip perforations */}
      <div className="flex h-6 items-center justify-around bg-black/25 px-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-3 w-[7px] rounded-sm bg-background/60" />
        ))}
      </div>

      {/* Center icon */}
      <div className="flex flex-1 items-center justify-center">
        <FilmIcon className="h-10 w-10 text-text-muted opacity-30" />
      </div>

      {/* Bottom film-strip perforations */}
      <div className="flex h-6 items-center justify-around bg-black/25 px-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-3 w-[7px] rounded-sm bg-background/60" />
        ))}
      </div>
    </div>
  );
}

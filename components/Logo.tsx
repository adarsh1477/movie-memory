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

export default function Logo() {
  return (
    <div className="flex items-center gap-2.5" aria-label="Movie Memory">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
        <IconFilm className="h-5 w-5" />
      </span>
      <span className="text-base font-semibold text-text">Movie Memory</span>
    </div>
  );
}

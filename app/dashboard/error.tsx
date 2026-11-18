"use client";

function IconAlert({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path
        d="M10 2.5L18.5 17H1.5L10 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10 8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border border-border bg-surface p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-danger/10 text-danger">
          <IconAlert className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-text">Something went wrong</h2>
          <p className="mt-1.5 text-sm text-text-muted">
            {error.message || "An unexpected error occurred."}
          </p>
        </div>
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

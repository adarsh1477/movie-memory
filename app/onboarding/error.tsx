"use client";

export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm text-text-muted">{error.message}</p>
        <button
          onClick={reset}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background text-text">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-text-muted">{error.message}</p>
          <button
            onClick={reset}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-background transition-colors duration-150 hover:bg-accent-hover"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

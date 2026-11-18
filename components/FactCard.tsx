"use client";

import { useRouter } from "next/navigation";
import Skeleton from "./Skeleton";
import { useFact } from "@/lib/use-fact";
import type { AppError } from "@/lib/errors";

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

function IconClock({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75V8l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconRetry({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path
        d="M13.25 8a5.25 5.25 0 1 1-1.54-3.71M13.25 2.75v2.5h-2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function errorCopy(error: AppError): { title: string; detail: string } {
  switch (error.code) {
    case "RATE_LIMITED":
      return {
        title: "Slow down a little",
        detail: `Try again in ${Math.max(1, Math.ceil(error.retryAfterMs / 1000))}s.`,
      };
    case "UPSTREAM_FAILED":
      return { title: "Couldn't reach the fact service", detail: "Our fact generator is having a moment. Please try again." };
    case "NO_MOVIE":
      return { title: "No movie picked yet", detail: "Choose your favorite movie to get facts." };
    default:
      return { title: "Couldn't load a fact", detail: error.message };
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function FactCard({ movieTitle }: { movieTitle: string }) {
  const router = useRouter();
  const { status, fact, error, retry } = useFact({ onUnauthorized: () => router.replace("/") });

  const loading = status === "loading";
  const copy = status === "error" && error ? errorCopy(error) : null;

  return (
    <div
      className="rounded-2xl border border-white/10 backdrop-blur-sm"
      style={{ background: "rgba(11,11,15,0.65)" }}
      aria-busy={loading}
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

      {/* Body */}
      <div className="px-5 py-5 sm:px-6">
        {fact ? (
          <div key={fact.generatedAt} className="motion-safe:animate-fade-in" aria-live="polite">
            <span
              className="float-left mr-2 mt-0.5 select-none font-serif text-4xl leading-none text-accent/25"
              aria-hidden="true"
            >
              &ldquo;
            </span>
            <p className="text-base leading-relaxed text-text sm:text-[1.0625rem]">{fact.content}</p>

            {fact.stale && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                <IconClock className="h-3.5 w-3.5 flex-shrink-0" />
                Showing the last available fact
              </p>
            )}
            {copy && (
              <p role="alert" className="mt-3 text-xs text-text-muted">
                <span className="text-text">{copy.title}.</span> {copy.detail}
              </p>
            )}
          </div>
        ) : copy ? (
          <div role="alert" className="flex flex-col items-start gap-1 motion-safe:animate-fade-in">
            <p className="text-sm font-medium text-text">{copy.title}</p>
            <p className="text-sm text-text-muted">{copy.detail}</p>
          </div>
        ) : (
          <div className="space-y-2.5" role="status" aria-label="Loading fact…">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[70%]" />
          </div>
        )}
      </div>

      {/* Footer — "New fact" + countdown arrive in Stage 8 */}
      <div className="flex min-h-[4.25rem] items-center justify-between gap-3 border-t border-white/10 px-5 py-4 sm:px-6">
        {fact ? (
          <p className="text-xs text-text-muted">
            Generated at <time dateTime={fact.generatedAt}>{formatTime(fact.generatedAt)}</time>
          </p>
        ) : loading ? (
          <Skeleton className="h-7 w-32 rounded-full" />
        ) : (
          <span />
        )}

        {status === "error" && error?.code !== "NO_MOVIE" ? (
          <button
            type="button"
            onClick={retry}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-background transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <IconRetry className="h-4 w-4" />
            Try again
          </button>
        ) : loading && (fact || error) ? (
          <span className="flex items-center gap-2 text-xs text-text-muted" role="status">
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent"
              aria-hidden="true"
            />
            Retrying…
          </span>
        ) : loading ? (
          <Skeleton className="h-9 w-24" />
        ) : null}
      </div>
    </div>
  );
}

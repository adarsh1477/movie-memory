"use client";

import { useRouter } from "next/navigation";
import Skeleton from "./Skeleton";
import { factCache } from "@/lib/client-cache";
import { useFact } from "@/lib/use-fact";
import { useNow, usePageVisible } from "@/lib/use-page-visible";
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

function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden="true"
    />
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

/** Show the "New fact" button this long after 0:00 if the new fact still hasn't arrived. */
export const OVERDUE_GRACE_MS = 2_000;

/** 47_000 → "0:47"; never negative. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type FactCardProps = {
  userId: string;
  /** Exact stored title: the cache key. */
  movieTitle: string;
  /** What to show in the header (defaults to movieTitle). */
  displayTitle?: string;
  /** A movie edit is being saved: show the skeleton, hold all requests. */
  pending?: boolean;
};

export default function FactCard({ userId, movieTitle, displayTitle, pending = false }: FactCardProps) {
  const router = useRouter();
  const { status, fact, error, refreshing, manual, nextAt, sameFactWaitMs, newFact, retry } = useFact({
    userId,
    movieTitle,
    onUnauthorized: () => {
      factCache.clear("session expired"); // the session is gone: drop its facts from this tab
      router.replace("/");
    },
    paused: pending,
  });
  const visible = usePageVisible();
  const now = useNow(visible && fact !== null && !pending, 1_000, nextAt);

  const loading = status === "loading";
  const showFact = fact !== null && !pending;
  const showingLast = showFact && (fact.stale || error !== null);
  const blockingError = status === "error" && error && !pending ? errorCopy(error) : null;
  const busy = loading || refreshing || pending;

  // The action button is NOT part of the normal state: facts refresh on their own at
  // the end of the server's 60s window, and the server can't be asked for a fresh fact
  // sooner, so an always-visible button would promise something it can't deliver.
  // It appears only when the user can actually help:
  //   (a) the last load failed            → "Try again"
  //   (b) the fact shown is a stale fallback → "New fact"
  //   (c) the countdown passed 0:00 and the new fact hasn't arrived → "New fact"
  const overdue = showFact && nextAt !== null && now >= nextAt + OVERDUE_GRACE_MS;
  const action: "retry" | "new" | null =
    pending || error?.code === "NO_MOVIE"
      ? null
      : error !== null && (blockingError !== null || showFact)
        ? "retry"
        : showFact && (fact.stale || overdue)
          ? "new"
          : null;

  return (
    <div
      className="rounded-2xl border border-white/10 backdrop-blur-sm"
      style={{ background: "rgba(11,11,15,0.65)" }}
      aria-busy={busy}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-4 sm:px-6">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <IconSparkle className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-accent">Did you know?</p>
          <p className="mt-0.5 truncate text-sm text-text-muted">
            Fact about <span className="font-medium text-text">{displayTitle ?? movieTitle}</span>
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-5 sm:px-6">
        {showFact ? (
          // Keyed by generatedAt: a new fact remounts and fades in (no motion if reduced).
          <div key={fact.generatedAt} className="motion-safe:animate-fade-in" aria-live="polite">
            <span
              className="float-left mr-2 mt-0.5 select-none font-serif text-4xl leading-none text-accent/25"
              aria-hidden="true"
            >
              &ldquo;
            </span>
            <p className="text-base leading-relaxed text-text sm:text-[1.0625rem]">{fact.content}</p>

            {showingLast && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                <IconClock className="h-3.5 w-3.5 flex-shrink-0" />
                Showing the last available fact
              </p>
            )}
          </div>
        ) : blockingError ? (
          <div role="alert" className="flex flex-col items-start gap-1 motion-safe:animate-fade-in">
            <p className="text-sm font-medium text-text">{blockingError.title}</p>
            <p className="text-sm text-text-muted">{blockingError.detail}</p>
          </div>
        ) : (
          <div className="space-y-2.5" role="status" aria-label={pending ? "Saving your movie…" : "Loading fact…"}>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[70%]" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex min-h-[4.25rem] flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          {showFact && refreshing ? (
            <p className="flex items-center gap-2 text-xs text-text-muted" role="status">
              <Spinner />
              Getting a fresh fact…
            </p>
          ) : showFact && nextAt !== null ? (
            // Visual only: a ticking number would be noise for screen readers.
            <p className="flex items-center gap-1.5 text-xs tabular-nums text-text-muted" aria-hidden="true" data-testid="countdown">
              <IconClock className="h-3.5 w-3.5 flex-shrink-0" />
              {showingLast ? "Next try in" : "Next fact in"} {formatCountdown(nextAt - now)}
            </p>
          ) : loading || pending ? (
            <Skeleton className="h-7 w-32 rounded-full" />
          ) : null}

          {sameFactWaitMs !== null && showFact && !refreshing && (
            <p role="status" className="mt-1 text-xs text-text-muted motion-safe:animate-fade-in">
              Same fact for now. Next fresh fact in {Math.max(1, Math.ceil(sameFactWaitMs / 1000))}s.
            </p>
          )}
        </div>

        {action === "retry" ? (
          <button
            type="button"
            onClick={retry}
            disabled={manual}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-background transition-colors duration-150 hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {manual ? <Spinner className="h-4 w-4" /> : <IconRetry className="h-4 w-4" />}
            Try again
          </button>
        ) : action === "new" ? (
          <button
            type="button"
            onClick={newFact}
            disabled={manual}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-text transition-colors duration-150 hover:border-accent/40 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-white/10 disabled:hover:text-text motion-safe:animate-fade-in"
          >
            {manual ? <Spinner /> : <IconSparkle className="h-4 w-4" />}
            New fact
          </button>
        ) : null}
      </div>
    </div>
  );
}

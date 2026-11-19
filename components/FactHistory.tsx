"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Skeleton from "./Skeleton";
import { getFactHistory } from "@/lib/api";
import { factCache } from "@/lib/client-cache";
import { AppErrorException, type AppError } from "@/lib/errors";
import { useNow, usePageVisible } from "@/lib/use-page-visible";
import { HISTORY_PAGE_SIZE, type FactHistoryItem, type FactHistoryResponse } from "@/lib/validation";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** "just now", "5 min ago", "3 h ago", "yesterday", then a short date. */
export function formatRelative(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (diff < 45_000) return "just now";
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "yesterday";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const toAppError = (err: unknown): AppError =>
  err instanceof AppErrorException ? err.error : { code: "INTERNAL", message: "Something went wrong. Please try again." };

/**
 * Put a refreshed first page in front of what's already loaded, without duplicates.
 * If the new page doesn't overlap the old list (more new facts than one page), there's a
 * gap we can't see, so start over from the new page and its cursor.
 */
function mergeFirstPage(
  existing: FactHistoryItem[],
  existingCursor: string | null,
  page: FactHistoryResponse,
): { items: FactHistoryItem[]; nextCursor: string | null } {
  if (existing.length === 0) return { items: page.items, nextCursor: page.nextCursor };
  const pageIds = new Set(page.items.map((i) => i.id));
  const overlaps = existing.some((i) => pageIds.has(i.id));
  if (!overlaps && page.nextCursor) return { items: page.items, nextCursor: page.nextCursor };
  return { items: [...page.items, ...existing.filter((i) => !pageIds.has(i.id))], nextCursor: existingCursor };
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconHistory({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3.5v2.9h2.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 6.75V10l2.25 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconFilm({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M1.5 5.5h13M1.5 10.5h13M5 2.5v3M11 2.5v3M5 10.5v3M11 10.5v3" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

type State = {
  status: "loading" | "ready" | "error";
  items: FactHistoryItem[];
  nextCursor: string | null;
  error: AppError | null;
  loadingMore: boolean;
  moreError: AppError | null;
  /** Polite announcement for screen readers ("Loaded 10 more facts."). */
  announcement: string;
};

const INITIAL: State = {
  status: "loading",
  items: [],
  nextCursor: null,
  error: null,
  loadingMore: false,
  moreError: null,
  announcement: "",
};

export type FactHistoryProps = {
  /** generatedAt of the fact currently on screen; a new value triggers a refresh. */
  latestFactAt: string | null;
  pageSize?: number;
};

/**
 * Dashboard-only fact history: a timeline of the user's past facts, newest first.
 * First page on mount, "Load more" appends the next page, and a new fact on screen
 * refreshes the first page. It never touches the fact cache or the fact timer, and keeps
 * no state outside the component (nothing survives sign-out or a user switch).
 */
export default function FactHistory({ latestFactAt, pageSize = HISTORY_PAGE_SIZE }: FactHistoryProps) {
  const router = useRouter();
  const [state, setState] = useState<State>(INITIAL);
  const stateRef = useRef(state);
  const firstPage = useRef<AbortController | null>(null);
  const morePage = useRef<AbortController | null>(null);
  useEffect(() => {
    stateRef.current = state;
  });

  const visible = usePageVisible();
  const now = useNow(visible && state.items.length > 0, 30_000);

  // Read the router through a ref: a new router/callback identity must never trigger a
  // refetch (the mount effect depends on loadFirstPage, which must stay stable).
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  const onUnauthorized = useCallback(() => {
    factCache.clear("session expired");
    routerRef.current.replace("/");
  }, []);

  /** Loads (or reloads) page 1. `refresh` keeps the current list on screen and merges. */
  const loadFirstPage = useCallback(
    (refresh: boolean) => {
      firstPage.current?.abort();
      const controller = new AbortController();
      firstPage.current = controller;

      getFactHistory({ limit: pageSize }, controller.signal)
        .then((page) => {
          if (controller.signal.aborted) return;
          setState((prev) => {
            const merged = refresh ? mergeFirstPage(prev.items, prev.nextCursor, page) : page;
            return { ...prev, status: "ready", error: null, items: merged.items, nextCursor: merged.nextCursor };
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const error = toAppError(err);
          if (error.code === "UNAUTHORIZED") return onUnauthorized();
          // A failed background refresh keeps the list as it is; only a failed first load shows an error.
          if (!refresh) setState((prev) => ({ ...prev, status: "error", error }));
        });
    },
    [onUnauthorized, pageSize],
  );

  // First page on mount.
  useEffect(() => {
    loadFirstPage(false);
    return () => {
      firstPage.current?.abort();
      morePage.current?.abort();
    };
  }, [loadFirstPage]);

  // A new fact on screen → refresh page 1. Skipped while the first load is still in
  // flight (it will include the fact) and when the fact is already the newest item, so
  // the initial render never fetches twice and nothing can loop.
  useEffect(() => {
    if (!latestFactAt) return;
    const { status, items } = stateRef.current;
    if (status !== "ready") return;
    if (items.some((i) => i.createdAt === latestFactAt)) return;
    loadFirstPage(true);
  }, [latestFactAt, loadFirstPage]);

  function retry() {
    setState({ ...INITIAL });
    loadFirstPage(false);
  }

  function loadMore() {
    const { nextCursor, loadingMore } = stateRef.current;
    if (!nextCursor || loadingMore) return;
    const controller = new AbortController();
    morePage.current = controller;
    setState((prev) => ({ ...prev, loadingMore: true, moreError: null, announcement: "" }));

    getFactHistory({ limit: pageSize, cursor: nextCursor }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((prev) => {
          const known = new Set(prev.items.map((i) => i.id));
          const added = page.items.filter((i) => !known.has(i.id));
          return {
            ...prev,
            items: [...prev.items, ...added],
            nextCursor: page.nextCursor,
            loadingMore: false,
            announcement: added.length ? `Loaded ${added.length} more fact${added.length === 1 ? "" : "s"}.` : "",
          };
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = toAppError(err);
        if (error.code === "UNAUTHORIZED") return onUnauthorized();
        setState((prev) => ({ ...prev, loadingMore: false, moreError: error }));
      });
  }

  const { status, items, nextCursor, error, loadingMore, moreError, announcement } = state;

  return (
    <section aria-labelledby="fact-history-heading" aria-busy={status === "loading" || loadingMore} className="mt-2">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted">
          <IconHistory className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id="fact-history-heading" className="text-sm font-semibold text-text">
            Fact history
          </h2>
          <p className="text-xs text-text-muted">Every fact you&apos;ve seen, newest first.</p>
        </div>
      </div>

      {/* Body */}
      {status === "loading" ? (
        <ol className="relative mt-5 space-y-3 pl-7" role="status" aria-label="Loading fact history…">
          <span aria-hidden="true" className="absolute bottom-3 left-[7px] top-3 w-px bg-white/[0.08]" />
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="relative">
              <span aria-hidden="true" className="absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full bg-white/10 ring-4 ring-background" />
              <div className="space-y-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
                <Skeleton className="h-3 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-[75%]" />
              </div>
            </li>
          ))}
        </ol>
      ) : status === "error" ? (
        <div role="alert" className="mt-5 flex flex-col items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">Couldn&apos;t load your fact history</p>
            <p className="text-xs text-text-muted">{error?.code === "RATE_LIMITED" ? "Too many requests. Please wait a moment." : "Please try again."}</p>
          </div>
          <button
            type="button"
            onClick={retry}
            className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm font-medium text-text transition-colors duration-150 hover:border-accent/40 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-4 py-5">
          <IconHistory className="h-5 w-5 flex-shrink-0 text-text-muted opacity-60" />
          <div>
            <p className="text-sm font-medium text-text">No facts yet</p>
            <p className="text-xs text-text-muted">Facts you see on the dashboard will collect here.</p>
          </div>
        </div>
      ) : (
        <>
          <ol className="relative mt-5 space-y-3 pl-7">
            {/* Timeline line */}
            <span
              aria-hidden="true"
              className="absolute bottom-4 left-[7px] top-4 w-px bg-gradient-to-b from-accent/40 via-white/[0.08] to-transparent"
            />
            {items.map((item) => {
              const current = item.createdAt === latestFactAt;
              return (
                <li key={item.id} className="relative motion-safe:animate-fade-in">
                  <span
                    aria-hidden="true"
                    className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background ${
                      current ? "bg-accent shadow-[0_0_10px_rgba(245,184,65,0.55)]" : "bg-white/25"
                    }`}
                  />
                  <article className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3.5 backdrop-blur-sm transition-colors duration-150 hover:border-white/[0.1] hover:bg-white/[0.04]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-text-muted">
                          <IconFilm className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{item.movieTitle}</span>
                        </span>
                        {current && (
                          <span className="flex-shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                            Now showing
                          </span>
                        )}
                      </div>
                      <time dateTime={item.createdAt} className="flex-shrink-0 text-xs tabular-nums text-text-muted" title={new Date(item.createdAt).toLocaleString()}>
                        {formatRelative(item.createdAt, now)}
                      </time>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-text/85">{item.content}</p>
                  </article>
                </li>
              );
            })}
          </ol>

          {(nextCursor || moreError) && (
            <div className="mt-4 flex flex-col items-center gap-2 pl-7">
              {moreError && (
                <p role="alert" className="text-xs text-text-muted">
                  Couldn&apos;t load more. {moreError.code === "RATE_LIMITED" ? "Too many requests — wait a moment." : "Please try again."}
                </p>
              )}
              {nextCursor && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-text transition-colors duration-150 hover:border-accent/40 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 disabled:hover:border-white/10 disabled:hover:text-text"
                >
                  {loadingMore && <Spinner />}
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}

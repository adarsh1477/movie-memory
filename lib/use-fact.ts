"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getFact } from "./api";
import {
  FACT_WINDOW_MS,
  factCache as defaultCache,
  windowEndsAt,
  type CachedFact,
  type FactCache,
} from "./client-cache";
import { AppErrorException, type AppError } from "./errors";
import { usePageVisible } from "./use-page-visible";
import type { FactResponse } from "./validation";

/** Must match the server's CACHE_WINDOW_MS: a fresh fact is possible at generatedAt + 60s. */
export const SERVER_WINDOW_MS = FACT_WINDOW_MS;
/** Wait after a failed or stale load before trying again automatically. */
export const RETRY_AFTER_FAILURE_MS = 30_000;
/** Minimum wait when an automatic load returned the same fact (clock skew guard). */
export const SAME_FACT_BACKOFF_MS = 5_000;
/** Small grace after the window ends so the server's clock has definitely passed it. */
const WINDOW_GRACE_MS = 250;
/**
 * An automatic load that starts this much after it was due ran late (the tab was hidden).
 * Its expired fact is hidden behind the skeleton instead of being shown while loading.
 */
export const LATE_LOAD_MS = 1_000;

type LoadKind = "initial" | "auto" | "manual";

export type FactState = {
  /** loading: no fact yet. ready: a fact is shown. error: no fact and the last load failed. */
  status: "loading" | "ready" | "error";
  /** Last fact received; kept on screen while refreshing and after a failed refresh. */
  fact: FactResponse | null;
  /** Last load's error, if it failed. With a fact present it means "showing the last fact". */
  error: AppError | null;
  /** A load is in flight while a fact is shown (auto-swap or "New fact"). */
  refreshing: boolean;
  /** The load in flight was started by the user ("New fact" / "Try again"), not the timer. */
  manual: boolean;
  /** Browser time of the next automatic load (null = none scheduled). */
  nextAt: number | null;
  /** Set when "New fact" came back with the same fact: ms until a fresh one is possible. */
  sameFactWaitMs: number | null;
  /** serverNow − browser time at receipt; add to Date.now() for an estimate of server time. */
  clockOffsetMs: number;
  /**
   * An expired fact taken off screen for a late load. Shown again (with the stale hint)
   * only if that load fails — never as if it were current.
   */
  fallback: FactResponse | null;
};

export type UseFactOptions = {
  userId: string;
  /** The movie title exactly as stored: the cache key and the server's fact key. */
  movieTitle: string;
  onUnauthorized: () => void;
  /** Hold automatic and "New fact" loads (e.g. while a movie edit is saving). */
  paused?: boolean;
  cache?: FactCache;
  now?: () => number;
};

const freshAtOf = windowEndsAt;

/** When to load next, in browser time, for a fact just received or read from cache. */
function scheduleFor(fact: FactResponse, clockOffsetMs: number, now: number): number {
  if (fact.stale) return now + RETRY_AFTER_FAILURE_MS;
  const freshAt = freshAtOf(fact, clockOffsetMs);
  return freshAt > now ? freshAt + WINDOW_GRACE_MS : now + SAME_FACT_BACKOFF_MS;
}

function fromCache(hit: CachedFact | null, now: number): FactState {
  if (!hit) {
    return {
      status: "loading",
      fact: null,
      error: null,
      refreshing: false,
      manual: false,
      nextAt: null,
      sameFactWaitMs: null,
      clockOffsetMs: 0,
      fallback: null,
    };
  }
  return {
    status: "ready",
    fact: hit.fact,
    error: null,
    refreshing: false,
    manual: false,
    nextAt: scheduleFor(hit.fact, hit.clockOffsetMs, now),
    sameFactWaitMs: null,
    clockOffsetMs: hit.clockOffsetMs,
    fallback: null,
  };
}

/**
 * The current fact for (userId, movieTitle), with:
 * - a 30s client cache (a hit renders instantly, no request),
 * - an automatic load when the server's 60s window ends (only while the tab is visible),
 * - `newFact()`, which skips only the client cache — the server still decides freshness.
 * Remount (key by movie title) to switch movies.
 */
export function useFact(options: UseFactOptions) {
  const { userId, movieTitle, paused = false } = options;
  const cache = options.cache ?? defaultCache;
  const now = options.now ?? Date.now;

  // Always start from "loading": the server render has no cache, so reading it here
  // would make the first client render differ from the server HTML (hydration error).
  const [state, setState] = useState<FactState>(() => fromCache(null, now()));
  const visible = usePageVisible();

  const stateRef = useRef(state);
  const inFlight = useRef<AbortController | null>(null);
  const onUnauthorized = useRef(options.onUnauthorized);
  useEffect(() => {
    onUnauthorized.current = options.onUnauthorized;
    stateRef.current = state;
  });

  const run = useCallback(
    (kind: LoadKind) => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;
      const previous = stateRef.current.fact;

      getFact(controller.signal)
        .then((fact) => {
          if (controller.signal.aborted) return;
          const receivedAt = now();
          const clockOffsetMs = Date.parse(fact.serverNow) - receivedAt;
          cache.set(userId, movieTitle, { fact, fetchedAt: receivedAt, clockOffsetMs });

          const same = previous?.generatedAt === fact.generatedAt;
          let nextAt = scheduleFor(fact, clockOffsetMs, receivedAt);
          if (same && kind === "auto") nextAt = Math.max(nextAt, receivedAt + SAME_FACT_BACKOFF_MS);
          const freshInMs = freshAtOf(fact, clockOffsetMs) - receivedAt;

          setState({
            status: "ready",
            fact,
            error: null,
            refreshing: false,
            manual: false,
            nextAt,
            sameFactWaitMs: kind === "manual" && same && !fact.stale && freshInMs > 0 ? freshInMs : null,
            clockOffsetMs,
            fallback: null,
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const error: AppError =
            err instanceof AppErrorException
              ? err.error
              : { code: "INTERNAL", message: "Something went wrong. Please try again." };
          if (error.code === "UNAUTHORIZED") onUnauthorized.current();

          setState((prev) => {
            const shown = prev.fact ?? prev.fallback;
            if (!shown) {
              return { ...prev, status: "error", error, refreshing: false, manual: false, nextAt: null, sameFactWaitMs: null };
            }
            // Show the last fact — labelled, since `error` is set — and try again later.
            const wait = error.code === "RATE_LIMITED" ? error.retryAfterMs : RETRY_AFTER_FAILURE_MS;
            return {
              ...prev,
              status: "ready",
              fact: shown,
              fallback: null,
              error,
              refreshing: false,
              manual: false,
              nextAt: now() + wait,
              sameFactWaitMs: null,
            };
          });
        });
    },
    [cache, movieTitle, now, userId],
  );

  // First load. A layout effect runs after hydration but before the browser paints, so
  // a cache hit (memory or sessionStorage, e.g. after a reload) replaces the skeleton
  // without a visible flash and without a hydration mismatch. Otherwise: fetch.
  useLayoutEffect(() => {
    const hit = cache.get(userId, movieTitle, now());
    // Syncing from an external store (memory / sessionStorage) once, after hydration.
    // Reading it during render would break hydration; a plain effect would paint the
    // skeleton first. One extra render on mount is the intended cost.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hit) setState(fromCache(hit, now()));
    else run("initial");
    return () => inFlight.current?.abort();
  }, [cache, movieTitle, now, run, userId]);

  // Automatic load at nextAt, only while the tab is visible. The timer is cleared and
  // rescheduled whenever nextAt changes (every new fact), so only one is ever pending.
  // Coming back to a visible tab re-runs this, so an overdue load fires straight away.
  // These loads always go to the server: the client cache is only read on mount.
  useEffect(() => {
    if (paused || !visible || state.nextAt === null || state.refreshing || state.status !== "ready") return;
    const dueAt = state.nextAt;
    const timer = setTimeout(() => {
      // Read the clock when the timer fires, not inside the updater: React runs updaters
      // when it renders, which can be later, and an on-time load must not look late.
      const firedAt = now();
      setState((prev) => {
        const current = prev.fact;
        const late = firedAt - dueAt > LATE_LOAD_MS;
        const expired =
          current !== null &&
          !current.stale && // a server stale fallback is labelled: fine to keep showing
          prev.error === null && // so is a fact already shown after a failed load
          firedAt >= windowEndsAt(current, prev.clockOffsetMs);
        // Late (the tab was hidden past the window): never show the expired fact while
        // loading. On time: keep it for the moment the swap takes, then fade to the new one.
        if (late && expired) {
          return { ...prev, status: "loading", fact: null, fallback: current, refreshing: false, manual: false, sameFactWaitMs: null };
        }
        return { ...prev, refreshing: true, manual: false };
      });
      run("auto");
    }, Math.max(0, dueAt - now()));
    return () => clearTimeout(timer);
  }, [paused, visible, state.nextAt, state.refreshing, state.status, now, run]);

  /**
   * "New fact" / "Try again": skip the client cache and ask the server now. If a slow
   * automatic load is still in flight, it is aborted and replaced; a manual load already
   * in flight is left alone.
   */
  const newFact = useCallback(() => {
    const prev = stateRef.current;
    if (prev.manual || (prev.status === "loading" && prev.fact === null && !prev.error)) return;
    setState({
      ...prev,
      status: prev.fact ? "ready" : "loading",
      refreshing: prev.fact !== null,
      manual: true,
      sameFactWaitMs: null,
    });
    run("manual");
  }, [run]);

  const retry = newFact;

  return { ...state, newFact, retry };
}

"use client";

import { useEffect, useState } from "react";

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** Page Visibility API as state: false while the tab is hidden. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(isVisible);

  useEffect(() => {
    const onChange = () => setVisible(isVisible());
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  return visible;
}

/**
 * Current time, re-read every `intervalMs` while `active`. Resyncs right away when it
 * becomes active again (e.g. the tab comes back) or when `resyncKey` changes (e.g. a new
 * countdown target), so a display never lags a fresh target by up to one tick.
 */
export function useNow(active: boolean, intervalMs = 1_000, resyncKey?: unknown): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [active, intervalMs, resyncKey]);

  return now;
}

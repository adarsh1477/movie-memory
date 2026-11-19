// Client fact cache (Variant B): an in-memory Map, mirrored to sessionStorage so it
// survives a full page reload within the same tab. sessionStorage is per tab and is
// cleared when the tab closes; it is never shared between tabs or sent to the server.
//
// Validity is the same wherever an entry comes from: a hit only while
//   now < min(fetchedAt + 30s, generatedAt + 60s)   (server-clock corrected)
// so neither the memory map nor storage can ever return a fact past its server window.

import { z } from "zod";
import { devLog } from "./dev-log";
import { FactResponse } from "./validation";

/** Dev-only decision log. Numbers and fixed words only: never fact text, user ids or emails. */
const log = (message: string) => devLog("fact-cache", message);
const secs = (ms: number) => `${Math.max(0, Math.round(ms / 1000))}s`;

export const CLIENT_CACHE_TTL_MS = 30_000;
/** Must match the server's CACHE_WINDOW_MS: a fact is current until generatedAt + 60s. */
export const FACT_WINDOW_MS = 60_000;
/** sessionStorage key prefix. Bump the version if the stored shape changes. */
export const STORAGE_PREFIX = "movie-memory:fact:v1:";

export type CachedFact = {
  fact: FactResponse;
  /** Browser time the fact was received. */
  fetchedAt: number;
  /** serverNow − browser time at receipt; add to Date.now() for an estimate of server time. */
  clockOffsetMs: number;
};

/** What is written to sessionStorage. userId and title are repeated inside and re-checked on read. */
const StoredFact = z.object({
  v: z.literal(1),
  userId: z.string().min(1),
  movieTitle: z.string().min(1),
  fact: FactResponse,
  fetchedAt: z.number().finite().nonnegative(),
  clockOffsetMs: z.number().finite(),
});

/**
 * Browser time when the fact's server window ends: generatedAt + 60s on the server's
 * clock, converted to browser time with the offset measured at receipt.
 */
export function windowEndsAt(fact: FactResponse, clockOffsetMs: number): number {
  return Date.parse(fact.generatedAt) + FACT_WINDOW_MS - clockOffsetMs;
}

/**
 * Browser time when a cache entry stops being a hit:
 * min(fetchedAt + 30s, end of the fact's 60s server window).
 * A fact fetched when it was already 59s old is a hit for only 1 more second, so the
 * cache can never show a fact the server would no longer serve. A `stale: true` fact
 * (served as a fallback, with an old generatedAt) is therefore never a hit.
 */
export function cacheExpiresAt(entry: CachedFact, ttlMs = CLIENT_CACHE_TTL_MS): number {
  return Math.min(entry.fetchedAt + ttlMs, windowEndsAt(entry.fact, entry.clockOffsetMs));
}

export type FactCache = {
  /** The entry if it is still a hit at `now` (browser time); expired or invalid entries are dropped. */
  get(userId: string, movieTitle: string, now?: number): CachedFact | null;
  set(userId: string, movieTitle: string, entry: CachedFact): void;
  /** Drop one movie's entry (movie edited). */
  deleteMovie(userId: string, movieTitle: string): void;
  /** Drop everything, in memory and in storage (sign out, expired session). */
  clear(reason?: "logout" | "session expired"): void;
};

/** The subset of the Web Storage API we use; lets tests pass a fake. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** sessionStorage, or null when unavailable (server render, privacy modes, sandboxed frames). */
export function browserSessionStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // accessing it can throw (e.g. SecurityError when storage is blocked)
  }
}

const memoryKey = (userId: string, movieTitle: string) => `${userId}\u0000${movieTitle}`;
export const storageKeyOf = (userId: string, movieTitle: string) =>
  `${STORAGE_PREFIX}${encodeURIComponent(userId)}:${encodeURIComponent(movieTitle)}`;

export function createFactCache(
  opts: { ttlMs?: number; storage?: () => StorageLike | null } = {},
): FactCache {
  const ttlMs = opts.ttlMs ?? CLIENT_CACHE_TTL_MS;
  const getStorage = opts.storage ?? browserSessionStorage;
  const memory = new Map<string, CachedFact>();

  // Every storage call is guarded: storage may be missing, full, blocked, or throw on any
  // call. On any failure we silently fall back to the in-memory map. Nothing is logged:
  // stored values contain user ids and fact text.
  let reportedUnavailable = false;
  const unavailable = () => {
    if (reportedUnavailable) return;
    reportedUnavailable = true;
    log("storage unavailable, using memory");
  };
  const tryStorage = <T>(fn: (s: StorageLike) => T, fallback: T): T => {
    try {
      const s = getStorage();
      if (!s) {
        unavailable();
        return fallback;
      }
      return fn(s);
    } catch {
      unavailable();
      return fallback;
    }
  };

  /** The stored entry, null if there is none, or "invalid" if one was found and dropped. */
  function readStored(userId: string, movieTitle: string): CachedFact | null | "invalid" {
    const key = storageKeyOf(userId, movieTitle);
    const raw = tryStorage((s) => s.getItem(key), null);
    if (raw === null) return null;

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const parsed = StoredFact.safeParse(json);
    if (!parsed.success || parsed.data.userId !== userId || parsed.data.movieTitle !== movieTitle) {
      tryStorage((s) => s.removeItem(key), undefined); // malformed or for someone else: drop it
      log("miss (invalid sessionStorage entry, removed)");
      return "invalid";
    }
    const { fact, fetchedAt, clockOffsetMs } = parsed.data;
    log("restored from sessionStorage");
    return { fact, fetchedAt, clockOffsetMs };
  }

  function forget(userId: string, movieTitle: string) {
    memory.delete(memoryKey(userId, movieTitle));
    tryStorage((s) => s.removeItem(storageKeyOf(userId, movieTitle)), undefined);
  }

  return {
    get(userId, movieTitle, now = Date.now()) {
      const entry = memory.get(memoryKey(userId, movieTitle)) ?? readStored(userId, movieTitle);
      if (entry === "invalid") return null; // already logged
      if (!entry) {
        log("miss (empty)");
        return null;
      }
      const expiresAt = cacheExpiresAt(entry, ttlMs);
      if (now >= expiresAt) {
        forget(userId, movieTitle);
        const byTtl = entry.fetchedAt + ttlMs <= windowEndsAt(entry.fact, entry.clockOffsetMs);
        log(byTtl ? "miss (expired by 30s rule)" : "miss (expired by 60s server window)");
        return null;
      }
      memory.set(memoryKey(userId, movieTitle), entry);
      log(`hit (age ${secs(now - entry.fetchedAt)}, expires in ${secs(expiresAt - now)})`);
      return entry;
    },

    set(userId, movieTitle, entry) {
      const serverNowAtFetch = entry.fetchedAt + entry.clockOffsetMs;
      log(`write (generatedAt age ${secs(serverNowAtFetch - Date.parse(entry.fact.generatedAt))})`);
      memory.set(memoryKey(userId, movieTitle), entry);
      const stored: z.infer<typeof StoredFact> = { v: 1, userId, movieTitle, ...entry };
      tryStorage((s) => s.setItem(storageKeyOf(userId, movieTitle), JSON.stringify(stored)), undefined);
    },

    deleteMovie(userId, movieTitle) {
      forget(userId, movieTitle);
      log("cleared (movie change)");
    },

    clear(reason = "logout") {
      log(`cleared (${reason})`);
      memory.clear();
      tryStorage((s) => {
        const ours: string[] = [];
        for (let i = 0; i < s.length; i++) {
          const key = s.key(i);
          if (key?.startsWith(STORAGE_PREFIX)) ours.push(key);
        }
        for (const key of ours) s.removeItem(key); // other apps' keys are left alone
      }, undefined);
    },
  };
}

/** The app-wide instance (one per browser tab), backed by sessionStorage when available. */
export const factCache: FactCache = createFactCache();

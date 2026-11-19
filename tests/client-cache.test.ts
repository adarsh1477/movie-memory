// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  CLIENT_CACHE_TTL_MS,
  FACT_WINDOW_MS,
  STORAGE_PREFIX,
  cacheExpiresAt,
  createFactCache,
  storageKeyOf,
  windowEndsAt,
  type CachedFact,
  type StorageLike,
} from "@/lib/client-cache";

const B = Date.parse("2026-11-18T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

/** A cache entry for a fact generated at `generatedAt` (server time), received at `fetchedAt` (browser time). */
function entry(
  content: string,
  { generatedAt, fetchedAt, clockOffsetMs = 0, stale = false }: { generatedAt: number; fetchedAt: number; clockOffsetMs?: number; stale?: boolean },
): CachedFact {
  return {
    fact: {
      content,
      movieTitle: "Heat",
      generatedAt: iso(generatedAt),
      serverNow: iso(fetchedAt + clockOffsetMs),
      stale,
    },
    fetchedAt,
    clockOffsetMs,
  };
}

describe("client fact cache", () => {
  it("is a 30-second cache bounded by the server's 60-second window", () => {
    expect(CLIENT_CACHE_TTL_MS).toBe(30_000);
    expect(FACT_WINDOW_MS).toBe(60_000);
  });

  // ── Expiry: min(fetchedAt + 30s, generatedAt + 60s) ──────────────────────

  it("a fact fetched at age 0s is a hit until 30s after the fetch", () => {
    const cache = createFactCache();
    cache.set("u1", "Heat", entry("a", { generatedAt: B, fetchedAt: B }));

    expect(cache.get("u1", "Heat", B + 29_999)?.fact.content).toBe("a");
    expect(cache.get("u1", "Heat", B + 30_000)).toBeNull();
  });

  it("a fact fetched at age 59s is a hit for only 1 more second", () => {
    const cache = createFactCache();
    const e = entry("a", { generatedAt: B, fetchedAt: B + 59_000 });
    expect(cacheExpiresAt(e)).toBe(B + 60_000);

    cache.set("u1", "Heat", e);
    expect(cache.get("u1", "Heat", B + 59_999)?.fact.content).toBe("a");
    expect(cache.get("u1", "Heat", B + 60_000)).toBeNull();
  });

  it("a fact fetched at age 45s expires at the window end (60s), not 30s after the fetch", () => {
    const e = entry("a", { generatedAt: B, fetchedAt: B + 45_000 });
    expect(cacheExpiresAt(e)).toBe(B + 60_000); // not B + 75_000
  });

  it("forgets an expired entry instead of just hiding it", () => {
    const cache = createFactCache();
    cache.set("u1", "Heat", entry("a", { generatedAt: B, fetchedAt: B }));
    expect(cache.get("u1", "Heat", B + 31_000)).toBeNull();
    expect(cache.get("u1", "Heat", B)).toBeNull();
  });

  // ── Server clock correction ─────────────────────────────────────────────

  it("uses the server clock: a browser 10s fast keeps the entry until the server's window really ends", () => {
    // Server: generated at B, fetched when the server clock read B + 50s (age 50s).
    // Browser clock is 10s ahead, so it received the fact at B + 60s browser time.
    const e = entry("a", { generatedAt: B, fetchedAt: B + 60_000, clockOffsetMs: -10_000 });
    expect(windowEndsAt(e.fact, e.clockOffsetMs)).toBe(B + 70_000); // server B + 60s in browser time
    expect(cacheExpiresAt(e)).toBe(B + 70_000);

    const cache = createFactCache();
    cache.set("u1", "Heat", e);
    expect(cache.get("u1", "Heat", B + 69_999)).not.toBeNull();
    expect(cache.get("u1", "Heat", B + 70_000)).toBeNull();
  });

  it("uses the server clock: a browser 10s slow drops the entry when the server's window ends", () => {
    // Server: age 50s at fetch. Browser clock is 10s behind: received at B + 40s browser time.
    const e = entry("a", { generatedAt: B, fetchedAt: B + 40_000, clockOffsetMs: 10_000 });
    expect(cacheExpiresAt(e)).toBe(B + 50_000); // server B + 60s = browser B + 50s

    const cache = createFactCache();
    cache.set("u1", "Heat", e);
    expect(cache.get("u1", "Heat", B + 49_999)).not.toBeNull();
    expect(cache.get("u1", "Heat", B + 50_000)).toBeNull();
  });

  it("never serves a stale: true fallback from the cache (its window is long over)", () => {
    const cache = createFactCache();
    cache.set("u1", "Heat", entry("old", { generatedAt: B - 600_000, fetchedAt: B, stale: true }));
    expect(cache.get("u1", "Heat", B)).toBeNull();
  });

  // ── Keys and invalidation ─────────────────────────────────────────────────

  it("keys by userId and exact movie title", () => {
    const cache = createFactCache();
    cache.set("u1", "Heat", entry("u1 heat", { generatedAt: B, fetchedAt: B }));
    expect(cache.get("u2", "Heat", B)).toBeNull();
    expect(cache.get("u1", "heat", B)).toBeNull();
    expect(cache.get("u1", "Alien", B)).toBeNull();
  });

  it("deleteMovie drops only that movie (movie edited)", () => {
    const cache = createFactCache();
    cache.set("u1", "Heat", entry("heat", { generatedAt: B, fetchedAt: B }));
    cache.set("u1", "Alien", entry("alien", { generatedAt: B, fetchedAt: B }));
    cache.deleteMovie("u1", "Heat");
    expect(cache.get("u1", "Heat", B)).toBeNull();
    expect(cache.get("u1", "Alien", B)?.fact.content).toBe("alien");
  });

  it("clear drops everything (sign out)", () => {
    const cache = createFactCache();
    cache.set("u1", "Heat", entry("a", { generatedAt: B, fetchedAt: B }));
    cache.set("u2", "Heat", entry("b", { generatedAt: B, fetchedAt: B }));
    cache.clear();
    expect(cache.get("u1", "Heat", B)).toBeNull();
    expect(cache.get("u2", "Heat", B)).toBeNull();
  });
});

// ── sessionStorage persistence ────────────────────────────────────────────────

/** In-memory Web Storage stand-in; `fail` makes chosen methods throw like a blocked/full store. */
class FakeStorage implements StorageLike {
  data = new Map<string, string>();
  fail = new Set<"getItem" | "setItem" | "removeItem" | "key">();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    if (this.fail.has("key")) throw new DOMException("blocked", "SecurityError");
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    if (this.fail.has("getItem")) throw new DOMException("blocked", "SecurityError");
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail.has("setItem")) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    if (this.fail.has("removeItem")) throw new DOMException("blocked", "SecurityError");
    this.data.delete(k);
  }
}

describe("client fact cache: sessionStorage", () => {
  let storage: FakeStorage;
  /** A fresh in-memory map over the same storage = a full page reload in the same tab. */
  const reload = () => createFactCache({ storage: () => storage });

  beforeEach(() => {
    storage = new FakeStorage();
  });

  it("survives a simulated page reload", () => {
    reload().set("u1", "Heat", entry("persisted", { generatedAt: B, fetchedAt: B }));

    const afterReload = reload();
    expect(afterReload.get("u1", "Heat", B + 5_000)?.fact.content).toBe("persisted");
  });

  it("stores under a namespaced key per userId and exact title", () => {
    reload().set("u1", "Heat: Director's Cut", entry("a", { generatedAt: B, fetchedAt: B }));
    expect([...storage.data.keys()]).toEqual([storageKeyOf("u1", "Heat: Director's Cut")]);
    expect(storageKeyOf("u1", "Heat")).toMatch(new RegExp(`^${STORAGE_PREFIX}`));

    const afterReload = reload();
    expect(afterReload.get("u2", "Heat: Director's Cut", B)).toBeNull();
    expect(afterReload.get("u1", "Heat", B)).toBeNull();
  });

  it("applies the same expiry after a reload: min(fetchedAt + 30s, generatedAt + 60s)", () => {
    reload().set("u1", "Heat", entry("a", { generatedAt: B, fetchedAt: B + 50_000 })); // age 50s at fetch

    expect(reload().get("u1", "Heat", B + 59_999)?.fact.content).toBe("a");
    const late = reload();
    expect(late.get("u1", "Heat", B + 60_000)).toBeNull();
    expect(storage.data.size).toBe(0); // expired entries are removed from storage too
  });

  it("applies the clock correction after a reload", () => {
    // Browser 10s fast: fact age 50s on the server, received at B + 60s browser time.
    reload().set("u1", "Heat", entry("a", { generatedAt: B, fetchedAt: B + 60_000, clockOffsetMs: -10_000 }));
    expect(reload().get("u1", "Heat", B + 69_999)).not.toBeNull();
    expect(reload().get("u1", "Heat", B + 70_000)).toBeNull();
  });

  it("clear removes this app's entries from storage (sign out) and leaves other keys alone", () => {
    const cache = reload();
    cache.set("u1", "Heat", entry("a", { generatedAt: B, fetchedAt: B }));
    cache.set("u2", "Alien", entry("b", { generatedAt: B, fetchedAt: B }));
    storage.data.set("someone-else:key", "keep me");

    cache.clear();

    expect([...storage.data.keys()]).toEqual(["someone-else:key"]);
    expect(reload().get("u1", "Heat", B)).toBeNull();
  });

  it("deleteMovie removes that movie from storage (movie change)", () => {
    const cache = reload();
    cache.set("u1", "Heat", entry("heat", { generatedAt: B, fetchedAt: B }));
    cache.set("u1", "Alien", entry("alien", { generatedAt: B, fetchedAt: B }));

    cache.deleteMovie("u1", "Heat");

    const afterReload = reload();
    expect(afterReload.get("u1", "Heat", B)).toBeNull();
    expect(afterReload.get("u1", "Alien", B)?.fact.content).toBe("alien");
  });

  it.each([
    ["not JSON", "{oops"],
    ["JSON null", "null"],
    ["wrong version", JSON.stringify({ v: 2 })],
    ["missing fact", JSON.stringify({ v: 1, userId: "u1", movieTitle: "Heat", fetchedAt: B, clockOffsetMs: 0 })],
    [
      "fact with the wrong shape",
      JSON.stringify({ v: 1, userId: "u1", movieTitle: "Heat", fact: { content: 42 }, fetchedAt: B, clockOffsetMs: 0 }),
    ],
    [
      "non-numeric fetchedAt",
      JSON.stringify({
        v: 1,
        userId: "u1",
        movieTitle: "Heat",
        fact: entry("x", { generatedAt: B, fetchedAt: B }).fact,
        fetchedAt: "soon",
        clockOffsetMs: 0,
      }),
    ],
    [
      "an entry belonging to another user under this key",
      JSON.stringify({
        v: 1,
        userId: "intruder",
        movieTitle: "Heat",
        fact: entry("x", { generatedAt: B, fetchedAt: B }).fact,
        fetchedAt: B,
        clockOffsetMs: 0,
      }),
    ],
  ])("ignores and removes malformed storage: %s", (_label, raw) => {
    const key = storageKeyOf("u1", "Heat");
    storage.data.set(key, raw);

    expect(reload().get("u1", "Heat", B)).toBeNull();
    expect(storage.data.has(key)).toBe(false);
  });

  it("falls back to memory when storage is unavailable (getter returns null)", () => {
    const cache = createFactCache({ storage: () => null });
    cache.set("u1", "Heat", entry("mem", { generatedAt: B, fetchedAt: B }));
    expect(cache.get("u1", "Heat", B)?.fact.content).toBe("mem");
  });

  it("falls back to memory when touching storage throws", () => {
    const cache = createFactCache({
      storage: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    expect(() => cache.set("u1", "Heat", entry("mem", { generatedAt: B, fetchedAt: B }))).not.toThrow();
    expect(cache.get("u1", "Heat", B)?.fact.content).toBe("mem");
    expect(() => cache.deleteMovie("u1", "Heat")).not.toThrow();
    expect(() => cache.clear()).not.toThrow();
  });

  it.each(["getItem", "setItem", "removeItem", "key"] as const)(
    "keeps working in memory when storage.%s throws",
    (method) => {
      storage.fail.add(method);
      const cache = reload();
      expect(() => cache.set("u1", "Heat", entry("mem", { generatedAt: B, fetchedAt: B }))).not.toThrow();
      expect(cache.get("u1", "Heat", B)?.fact.content).toBe("mem");
      expect(() => cache.get("u1", "Heat", B + 31_000)).not.toThrow(); // expiry → removeItem
      expect(() => cache.clear()).not.toThrow();
    },
  );

  it("logs nothing, even on malformed or failing storage", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    storage.data.set(storageKeyOf("u1", "Heat"), "{oops");
    storage.fail.add("setItem");

    const cache = reload();
    cache.get("u1", "Heat", B);
    cache.set("u1", "Heat", entry("secret fact text", { generatedAt: B, fetchedAt: B }));
    cache.clear();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

// ── Development-only logging ──────────────────────────────────────────────────

describe("client fact cache: dev logging", () => {
  const USER = "user-cuid-123";
  const SECRET = "Secret fact text that must never be logged.";
  let storage: FakeStorage;
  let lines: string[];
  let consoleSpies: ReturnType<typeof vi.spyOn>[];

  const factEntry = (generatedAt: number, fetchedAt: number): CachedFact => ({
    ...entry(SECRET, { generatedAt, fetchedAt }),
  });

  beforeEach(() => {
    storage = new FakeStorage();
    lines = [];
    consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      }),
    );
  });

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockRestore();
    vi.unstubAllEnvs();
  });

  /** Runs every cache decision once. */
  function exerciseEverything() {
    const cache = createFactCache({ storage: () => storage });
    cache.get(USER, "Heat", B); // miss (empty)
    cache.set(USER, "Heat", factEntry(B - 5_000, B)); // write (generatedAt age 5s)
    cache.get(USER, "Heat", B + 12_000); // hit (age 12s, expires in 18s)
    createFactCache({ storage: () => storage }).get(USER, "Heat", B + 1_000); // restored + hit
    cache.get(USER, "Heat", B + 30_000); // miss (expired by 30s rule)
    cache.set(USER, "Alien", factEntry(B - 50_000, B)); // window ends at B + 10s
    cache.get(USER, "Alien", B + 10_000); // miss (expired by 60s server window)
    storage.data.set(storageKeyOf(USER, "Broken"), "{oops");
    cache.get(USER, "Broken", B); // miss (invalid sessionStorage entry, removed)
    cache.set(USER, "Heat", factEntry(B, B));
    cache.deleteMovie(USER, "Heat"); // cleared (movie change)
    cache.clear("logout"); // cleared (logout)
    cache.clear("session expired"); // cleared (session expired)
    const noStorage = createFactCache({ storage: () => null });
    noStorage.set(USER, "Heat", factEntry(B, B)); // storage unavailable, using memory
    noStorage.get(USER, "Heat", B); // (reported once per cache, not again)
  }

  it("logs one [fact-cache] line per decision in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    exerciseEverything();

    expect(lines).toEqual([
      "[fact-cache] miss (empty)",
      "[fact-cache] write (generatedAt age 5s)",
      "[fact-cache] hit (age 12s, expires in 18s)",
      "[fact-cache] restored from sessionStorage",
      "[fact-cache] hit (age 1s, expires in 29s)",
      "[fact-cache] miss (expired by 30s rule)",
      "[fact-cache] write (generatedAt age 50s)",
      "[fact-cache] miss (expired by 60s server window)",
      "[fact-cache] miss (invalid sessionStorage entry, removed)",
      "[fact-cache] write (generatedAt age 0s)",
      "[fact-cache] cleared (movie change)",
      "[fact-cache] cleared (logout)",
      "[fact-cache] cleared (session expired)",
      "[fact-cache] write (generatedAt age 0s)",
      "[fact-cache] storage unavailable, using memory", // the write, then its storage attempt
      "[fact-cache] hit (age 0s, expires in 30s)",
    ]);
  });

  it("logs a storage failure once, when touching storage throws", () => {
    vi.stubEnv("NODE_ENV", "development");
    storage.fail.add("setItem");
    const cache = createFactCache({ storage: () => storage });
    cache.set(USER, "Heat", factEntry(B, B));
    cache.set(USER, "Heat", factEntry(B, B));
    expect(lines.filter((l) => l.includes("storage unavailable"))).toEqual([
      "[fact-cache] storage unavailable, using memory",
    ]);
  });

  it("never logs the fact text, the user id or an email", () => {
    vi.stubEnv("NODE_ENV", "development");
    exerciseEverything();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).not.toContain(USER);
      expect(line).not.toMatch(/@/);
      expect(line).not.toMatch(/Heat|Alien|Broken/); // titles aren't needed either
    }
  });

  it.each(["production", "test"])("logs nothing at all when NODE_ENV is %s", (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    storage.fail.add("setItem");
    exerciseEverything();

    expect(lines).toEqual([]);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

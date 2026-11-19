import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import FactCard, { OVERDUE_GRACE_MS, formatCountdown } from "@/components/FactCard";
import { createFactCache, factCache, storageKeyOf } from "@/lib/client-cache";

const replace = vi.fn();
// A new object per call on purpose: the hook must not refetch when callback identities change.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const T0 = Date.parse("2026-11-18T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

type Fact = { content: string; movieTitle: string; generatedAt: string; serverNow: string; stale: boolean };
const fact = (content: string, generatedAtMs: number, over: Partial<Fact> = {}): Fact => ({
  content,
  movieTitle: "Heat",
  generatedAt: iso(generatedAtMs),
  serverNow: iso(Date.now()),
  stale: false,
  ...over,
});

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });
const fail = (status: number, error: Record<string, unknown>): Reply => ({ status, body: { ok: false, error } });

let fetchMock: ReturnType<typeof vi.fn>;

/** Each fetch takes the next reply (a Reply, a function building one, or a pending promise). */
function replies(...queue: Array<Reply | (() => Reply) | Promise<Reply>>) {
  fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) return new Promise(() => {});
    const r = typeof next === "function" ? next() : await next;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: new Headers(r.headers),
      json: async () => r.body,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
}

function pending() {
  let resolve!: (r: Reply) => void;
  const promise = new Promise<Reply>((r) => (resolve = r));
  return { promise, resolve };
}

/** Let resolved fetches settle and React re-render. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

let visibility: DocumentVisibilityState = "visible";
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const countdown = () => screen.getByTestId("countdown").textContent?.replace(/\s+/g, " ").trim();
const renderCard = () => render(<FactCard userId="u1" movieTitle="Heat" />);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  replace.mockReset();
  factCache.clear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Loading, errors, auth ─────────────────────────────────────────────────────

describe("FactCard loading and errors", () => {
  it("shows a skeleton, then the fact", async () => {
    const reply = pending();
    replies(reply.promise);
    renderCard();

    expect(screen.getByRole("status", { name: "Loading fact…" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new fact|try again/i })).toBeNull();

    reply.resolve(ok(fact("The diner scene was shot in one afternoon.", T0)));
    await flush();

    expect(screen.getByText("The diner scene was shot in one afternoon.")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading fact…" })).toBeNull();
    expect(screen.queryByText(/last available fact/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/fact", expect.objectContaining({ cache: "no-store" }));
  });

  it("shows the stale hint when the server served the last stored fact", async () => {
    replies(ok(fact("Old one.", T0 - 600_000, { stale: true })));
    renderCard();
    await flush();

    expect(screen.getByText("Old one.")).toBeTruthy();
    expect(screen.getByText("Showing the last available fact")).toBeTruthy();
    expect(countdown()).toBe("Next try in 0:30");
  });

  it("shows an error with Try again, which refetches and recovers", async () => {
    replies(fail(502, { code: "UPSTREAM_FAILED", message: "nope" }), ok(fact("Recovered.", T0)));
    renderCard();
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the fact service");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Recovered.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a generic error for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderCard();
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load a fact");
  });

  it("shows the rate-limit wait time when there is no fact yet", async () => {
    replies(fail(429, { code: "RATE_LIMITED", message: "Too many requests", retryAfterMs: 12_300 }));
    renderCard();
    await flush();
    expect(screen.getByRole("alert").textContent).toMatch(/Slow down a little.*Try again in 13s/);
  });

  it("redirects to / when the session has expired", async () => {
    replies(fail(401, { code: "UNAUTHORIZED", message: "Sign in required" }));
    renderCard();
    await flush();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("makes exactly one request across re-renders", async () => {
    replies(ok(fact("A.", T0)), ok(fact("B.", T0)));
    const { rerender } = renderCard();
    await flush();
    rerender(<FactCard userId="u1" movieTitle="Heat" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts the request on unmount", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const { unmount } = renderCard();
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("shows the saving skeleton and holds requests while a movie edit is pending", async () => {
    replies(ok(fact("A.", T0)), ok(fact("B.", T0 + 60_000)));
    const { rerender } = renderCard();
    await flush();

    rerender(<FactCard userId="u1" movieTitle="Heat" pending />);
    expect(screen.getByRole("status", { name: "Saving your movie…" })).toBeTruthy();
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// ── Client cache ──────────────────────────────────────────────────────────────

describe("FactCard client cache", () => {
  it("a cache hit shows the fact instantly with no request", () => {
    replies();
    factCache.set("u1", "Heat", { fact: fact("Cached.", T0 - 10_000), fetchedAt: T0 - 10_000, clockOffsetMs: 0 });

    renderCard();

    expect(screen.getByText("Cached.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(countdown()).toBe("Next fact in 0:51"); // 60s window − 10s, + 250ms grace → rounds up
  });

  it("an expired entry (30s) is ignored and refetched", async () => {
    replies(ok(fact("Fresh.", T0)));
    factCache.set("u1", "Heat", { fact: fact("Cached.", T0 - 30_000), fetchedAt: T0 - 30_000, clockOffsetMs: 0 });

    renderCard();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Fresh.")).toBeTruthy();
  });

  it("is keyed by user and movie", async () => {
    replies(ok(fact("Mine.", T0)));
    factCache.set("u2", "Heat", { fact: fact("Someone else's.", T0), fetchedAt: T0, clockOffsetMs: 0 });
    factCache.set("u1", "Alien", { fact: fact("Other movie.", T0), fetchedAt: T0, clockOffsetMs: 0 });

    renderCard();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Mine.")).toBeTruthy();
  });

  it("stores each received fact, so a remount within 30s is instant", async () => {
    replies(ok(fact("Stored.", T0)));
    const first = renderCard();
    await flush();
    first.unmount();

    await advance(29_000);
    renderCard();
    expect(screen.getByText("Stored.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a fact cached before a full page reload (sessionStorage) shows instantly, with no request", () => {
    replies();
    // A different cache instance over the same sessionStorage = the previous page load.
    createFactCache().set("u1", "Heat", { fact: fact("From before the reload.", T0 - 10_000), fetchedAt: T0 - 10_000, clockOffsetMs: 0 });
    expect(window.sessionStorage.getItem(storageKeyOf("u1", "Heat"))).not.toBeNull();

    renderCard();

    expect(screen.getByText("From before the reload.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a stored fact past its window after a reload shows the skeleton and fetches", async () => {
    replies(ok(fact("Fresh.", T0)));
    createFactCache().set("u1", "Heat", { fact: fact("Too old.", T0 - 61_000), fetchedAt: T0 - 1_000, clockOffsetMs: 0 });

    renderCard();
    expect(screen.queryByText("Too old.")).toBeNull();
    expect(screen.getByRole("status", { name: "Loading fact…" })).toBeTruthy();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(storageKeyOf("u1", "Heat"))).toContain("Fresh.");
  });

  it("malformed sessionStorage is ignored and replaced", async () => {
    replies(ok(fact("Fresh.", T0)));
    window.sessionStorage.setItem(storageKeyOf("u1", "Heat"), "{not json");

    renderCard();
    await flush();
    expect(screen.getByText("Fresh.")).toBeTruthy();
  });

  it("an expired session (401) clears the cache from memory and sessionStorage", async () => {
    factCache.set("u1", "Alien", { fact: fact("Other movie.", T0), fetchedAt: T0, clockOffsetMs: 0 });
    replies(fail(401, { code: "UNAUTHORIZED", message: "Sign in required" }));

    renderCard();
    await flush();

    expect(replace).toHaveBeenCalledWith("/");
    expect(factCache.get("u1", "Alien")).toBeNull();
    expect(window.sessionStorage.getItem(storageKeyOf("u1", "Alien"))).toBeNull();
  });

  it("a cleared cache (sign out / movie change) means a fresh request", async () => {
    replies(ok(fact("One.", T0)), ok(fact("Two.", T0)));
    const first = renderCard();
    await flush();
    first.unmount();

    factCache.deleteMovie("u1", "Heat");
    renderCard();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── Countdown and auto-swap ───────────────────────────────────────────────────

describe("FactCard countdown and auto-swap", () => {
  it("counts down to generatedAt + 60s", async () => {
    replies(ok(fact("A.", T0)));
    renderCard();
    await flush();

    expect(countdown()).toBe("Next fact in 1:01"); // 60s + 250ms grace, rounded up
    await advance(13_000);
    expect(countdown()).toBe("Next fact in 0:48");
    expect(screen.getByTestId("countdown").getAttribute("aria-hidden")).toBe("true");
  });

  it("uses the server's clock: a browser running 10s fast still waits the real window", async () => {
    // Server time is T0; the browser thinks it is T0 + 10s.
    vi.setSystemTime(T0 + 10_000);
    replies(ok({ ...fact("A.", T0), serverNow: iso(T0) }), ok(fact("B.", T0 + 60_000)));
    renderCard();
    await flush();

    expect(countdown()).toBe("Next fact in 1:01");
    await advance(55_000); // a naive timer would have fired at 50s
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(6_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("at 0:00 fetches a new fact and swaps it in", async () => {
    replies(ok(fact("First.", T0)), () => ok(fact("Second.", T0 + 60_250)));
    renderCard();
    await flush();

    await advance(60_300);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Second.")).toBeTruthy();
    expect(screen.queryByText("First.")).toBeNull();
    expect(screen.getByText("Second.").parentElement?.className).toContain("motion-safe:animate-fade-in");
  });

  it("pauses while the tab is hidden and resyncs when it returns", async () => {
    replies(ok(fact("First.", T0)), () => ok(fact("Second.", Date.now())));
    renderCard();
    await flush();

    await advance(10_000);
    setVisibility("hidden");
    await advance(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Second.")).toBeTruthy();
  });

  it("returning before the window ends just resumes the countdown", async () => {
    replies(ok(fact("First.", T0)));
    renderCard();
    await flush();

    setVisibility("hidden");
    await advance(20_000);
    setVisibility("visible");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(countdown()).toBe("Next fact in 0:41");
  });

  it("keeps the last fact and shows the stale hint when the auto-fetch fails, then retries in 30s", async () => {
    replies(ok(fact("First.", T0)), fail(502, { code: "UPSTREAM_FAILED", message: "nope" }), () =>
      ok(fact("Back.", Date.now())),
    );
    renderCard();
    await flush();

    await advance(60_300);
    await flush();
    expect(screen.getByText("First.")).toBeTruthy();
    expect(screen.getByText("Showing the last available fact")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(countdown()).toBe("Next try in 0:30");

    await advance(30_000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Back.")).toBeTruthy();
  });

  it("does not loop when an auto-fetch returns the same fact", async () => {
    replies(ok(fact("Same.", T0)), () => ok(fact("Same.", T0)), () => ok(fact("Same.", T0)));
    renderCard();
    await flush();

    await advance(60_300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // waits at least 5s before asking again
  });
});

// ── The action button: only when the user can actually help ──────────────────

describe("FactCard action button", () => {
  const actionButton = () => screen.queryByRole("button", { name: /new fact|try again/i });

  it("is hidden in the normal state: a current fact with the countdown running", async () => {
    replies(ok(fact("Current.", T0)));
    renderCard();
    await flush();

    expect(screen.getByText("Current.")).toBeTruthy();
    expect(countdown()).toBe("Next fact in 1:01");
    expect(actionButton()).toBeNull();

    await advance(59_000); // still counting down
    expect(actionButton()).toBeNull();
  });

  it("is hidden while the first fact loads and when a fact comes from the cache", async () => {
    const reply = pending();
    replies(reply.promise);
    const first = renderCard();
    expect(actionButton()).toBeNull();

    reply.resolve(ok(fact("Cached later.", T0)));
    await flush();
    first.unmount();

    renderCard(); // cache hit
    expect(screen.getByText("Cached later.")).toBeTruthy();
    expect(actionButton()).toBeNull();
  });

  // (a) the last fetch failed → "Try again"
  it("(a) after a failed refresh: 'Try again', which reloads", async () => {
    replies(ok(fact("Kept.", T0)), fail(502, { code: "UPSTREAM_FAILED", message: "nope" }), () =>
      ok(fact("Recovered.", Date.now())),
    );
    renderCard();
    await flush();
    await advance(60_300); // auto-swap fails
    await flush();

    expect(screen.getByText("Kept.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /new fact/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Recovered.")).toBeTruthy();
    expect(actionButton()).toBeNull(); // back to normal
  });

  it("(a) after a failed first load: 'Try again'", async () => {
    replies(fail(502, { code: "UPSTREAM_FAILED", message: "nope" }));
    renderCard();
    await flush();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  // (b) the fact shown is stale → "New fact"
  it("(b) on a stale fallback: 'New fact', which asks the server now (not the cache)", async () => {
    replies(ok(fact("Fallback.", T0 - 600_000, { stale: true })), ok(fact("Fresh.", T0)));
    renderCard();
    await flush();

    expect(screen.getByText("Showing the last available fact")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New fact" }));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Fresh.")).toBeTruthy();
    expect(actionButton()).toBeNull();
  });

  it("(b) is disabled with a spinner while its request is in flight, and can't double-send", async () => {
    const second = pending();
    replies(ok(fact("Fallback.", T0 - 600_000, { stale: true })), second.promise);
    renderCard();
    await flush();

    const button = screen.getByRole("button", { name: "New fact" });
    fireEvent.click(button);
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    second.resolve(ok(fact("Fresh.", T0)));
    await flush();
    expect(screen.getByText("Fresh.")).toBeTruthy();
  });

  // (c) countdown reached 0:00 and the new fact hasn't arrived
  it("(c) appears once 0:00 has passed (+2s grace) without a new fact, and replaces the slow load", async () => {
    replies(ok(fact("Waiting.", T0)), new Promise<Reply>(() => {}), () => ok(fact("Arrived.", Date.now())));
    renderCard();
    await flush();

    await advance(60_300); // 0:00 — the auto-swap request starts and hangs
    expect(screen.getByText("Getting a fresh fact…")).toBeTruthy();
    expect(actionButton()).toBeNull(); // no flash during a normal swap

    // The countdown clock ticks once a second, so the button shows within one tick of 0:00 + 2s.
    await advance(OVERDUE_GRACE_MS + 1_000);
    const button = screen.getByRole("button", { name: "New fact" });
    fireEvent.click(button);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Arrived.")).toBeTruthy();
    expect(actionButton()).toBeNull();
  });

  it("(c) a manual load that gets the same fact (clock skew) shows a hint, not an error", async () => {
    replies(ok(fact("Same.", T0)), new Promise<Reply>(() => {}), () =>
      ok({ ...fact("Same.", T0), serverNow: iso(T0 + 50_000) }), // server: still inside its window
    );
    renderCard();
    await flush();
    await advance(60_300 + OVERDUE_GRACE_MS + 1_000);

    fireEvent.click(screen.getByRole("button", { name: "New fact" }));
    await flush();

    expect(screen.getByRole("status").textContent).toBe("Same fact for now. Next fresh fact in 10s.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never appears while a movie edit is saving", async () => {
    replies(ok(fact("Fallback.", T0 - 600_000, { stale: true })));
    const { rerender } = renderCard();
    await flush();
    expect(screen.getByRole("button", { name: "New fact" })).toBeTruthy();

    rerender(<FactCard userId="u1" movieTitle="Heat" pending />);
    expect(actionButton()).toBeNull();
  });
});

// ── Never past the server's 60s window ────────────────────────────────────────

describe("FactCard never shows a fact past its 60s window", () => {
  const skeleton = () => screen.queryByRole("status", { name: "Loading fact…" });

  it("a fact fetched at age 59s is served from the cache for 1 more second, then refetched", async () => {
    replies(ok(fact("Almost expired.", T0 - 59_000)), ok(fact("Fresh.", T0 + 1_000)));
    const first = renderCard();
    await flush();
    first.unmount();

    await advance(500);
    const second = renderCard();
    expect(screen.getByText("Almost expired.")).toBeTruthy(); // hit at age 59.5s
    expect(fetchMock).toHaveBeenCalledTimes(1);
    second.unmount();

    await advance(500); // age 60s: the window is over
    renderCard();
    expect(screen.queryByText("Almost expired.")).toBeNull();
    expect(skeleton()).toBeTruthy();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Fresh.")).toBeTruthy();
  });

  it("a fact fetched at age 0s is served from the cache until 30s, then refetched", async () => {
    replies(ok(fact("New.", T0)), ok(fact("Next.", T0 + 30_000)));
    const first = renderCard();
    await flush();
    first.unmount();

    await advance(29_999);
    const second = renderCard();
    expect(screen.getByText("New.")).toBeTruthy();
    second.unmount();

    await advance(1);
    renderCard();
    expect(screen.queryByText("New.")).toBeNull();
    expect(skeleton()).toBeTruthy();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a remount at 70s shows the skeleton and fetches — never the old fact", async () => {
    replies(ok(fact("Old.", T0)), ok(fact("Current.", T0 + 70_000)));
    const first = renderCard();
    await flush();
    first.unmount();

    await advance(70_000);
    renderCard();

    // First paint after remount: skeleton, not the 70s-old fact.
    expect(screen.queryByText("Old.")).toBeNull();
    expect(skeleton()).toBeTruthy();
    await flush();
    expect(screen.getByText("Current.")).toBeTruthy();
    expect(screen.queryByText("Old.")).toBeNull();
  });

  it("uses the server clock for cache expiry: browser 10s fast, fact age 50s → valid 10 more seconds", async () => {
    vi.setSystemTime(T0 + 10_000); // browser ahead of the server (server time is T0)
    replies(ok({ ...fact("Skewed.", T0 - 50_000), serverNow: iso(T0) }), ok(fact("After.", T0 + 10_000)));
    const first = renderCard();
    await flush();
    first.unmount();

    await advance(9_999);
    const second = renderCard();
    expect(screen.getByText("Skewed.")).toBeTruthy();
    second.unmount();

    await advance(1);
    renderCard();
    expect(screen.queryByText("Skewed.")).toBeNull();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("still shows a server stale: true fallback, with the stale hint", async () => {
    replies(ok(fact("Fallback fact.", T0 - 600_000, { stale: true })));
    renderCard();
    await flush();

    expect(screen.getByText("Fallback fact.")).toBeTruthy();
    expect(screen.getByText("Showing the last available fact")).toBeTruthy();
  });

  it("never serves a stale: true fallback from the client cache", async () => {
    replies(ok(fact("Fallback fact.", T0 - 600_000, { stale: true })), ok(fact("Recovered.", T0)));
    const first = renderCard();
    await flush();
    first.unmount();

    renderCard();
    expect(skeleton()).toBeTruthy();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Recovered.")).toBeTruthy();
  });

  it("the auto-swap at generatedAt + 60s goes to the server even if the cache has an entry", async () => {
    replies(ok(fact("First.", T0)), () => ok(fact("From server.", Date.now())));
    renderCard();
    await flush();

    await advance(59_000);
    // Something else put a valid entry in the cache; the auto-swap must not use it.
    factCache.set("u1", "Heat", { fact: fact("From cache.", Date.now()), fetchedAt: Date.now(), clockOffsetMs: 0 });

    await advance(1_300);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("From server.")).toBeTruthy();
    expect(screen.queryByText("From cache.")).toBeNull();
  });

  it("clears and reschedules the timer when a new fact arrives (one load per window)", async () => {
    replies(ok(fact("A.", T0)), () => ok(fact("B.", Date.now())), () => ok(fact("C.", Date.now())));
    renderCard();
    await flush();

    await advance(60_300); // A's window ends at 60s (+250ms grace)
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("B.")).toBeTruthy();

    await advance(59_000); // well inside B's window: no leftover timer fires
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(1_300); // B's window ends ~60.25s after it arrived
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("C.")).toBeTruthy();
  });

  it("returning to a tab hidden past the window shows the skeleton while loading, not the expired fact", async () => {
    const reply = pending();
    replies(ok(fact("Expired.", T0)), reply.promise);
    renderCard();
    await flush();

    setVisibility("hidden");
    await advance(5 * 60_000);
    setVisibility("visible");
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Expired.")).toBeNull();
    expect(skeleton()).toBeTruthy();

    reply.resolve(ok(fact("Now.", Date.now())));
    await flush();
    expect(screen.getByText("Now.")).toBeTruthy();
  });

  it("if that late load fails, the expired fact comes back only as a labelled fallback", async () => {
    replies(ok(fact("Expired.", T0)), fail(502, { code: "UPSTREAM_FAILED", message: "nope" }));
    renderCard();
    await flush();

    setVisibility("hidden");
    await advance(5 * 60_000);
    setVisibility("visible");
    await flush();

    expect(screen.getByText("Expired.")).toBeTruthy();
    expect(screen.getByText("Showing the last available fact")).toBeTruthy();
    expect(countdown()).toBe("Next try in 0:30");
  });

  it("an on-time auto-swap keeps the current fact visible while it loads (no skeleton flash)", async () => {
    const reply = pending();
    replies(ok(fact("Current.", T0)), reply.promise);
    renderCard();
    await flush();

    await advance(60_300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Current.")).toBeTruthy();
    expect(skeleton()).toBeNull();
    expect(screen.getByText("Getting a fresh fact…")).toBeTruthy();

    reply.resolve(ok(fact("Next.", Date.now())));
    await flush();
    expect(screen.getByText("Next.")).toBeTruthy();
  });
});

describe("formatCountdown", () => {
  it.each([
    [47_000, "0:47"],
    [60_000, "1:00"],
    [61_000, "1:01"],
    [500, "0:01"],
    [0, "0:00"],
    [-5_000, "0:00"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

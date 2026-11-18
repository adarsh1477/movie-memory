import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import FactCard from "@/components/FactCard";

const replace = vi.fn();
// A new object per call on purpose: the hook must not refetch when callback identities change.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const FACT = {
  content: "The diner scene was shot in one afternoon.",
  movieTitle: "Heat",
  generatedAt: "2026-11-18T12:00:00.000Z",
  stale: false,
};

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });
const fail = (status: number, error: Record<string, unknown>): Reply => ({ status, body: { ok: false, error } });

let fetchMock: ReturnType<typeof vi.fn>;

/** Each call to fetch takes the next reply; `pending()` returns a reply you resolve later. */
function replies(...queue: Array<Reply | Promise<Reply>>) {
  fetchMock = vi.fn(async () => {
    const r = await queue.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function pending() {
  let resolve!: (r: Reply) => void;
  const promise = new Promise<Reply>((r) => (resolve = r));
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => replace.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FactCard", () => {
  it("shows a skeleton, then the fact", async () => {
    const reply = pending();
    replies(reply.promise);
    render(<FactCard movieTitle="Heat" />);

    expect(screen.getByRole("status", { name: "Loading fact…" })).toBeTruthy();
    expect(screen.queryByText(FACT.content)).toBeNull();

    reply.resolve(ok(FACT));
    await flush();

    expect(screen.getByText(FACT.content)).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Loading fact…" })).toBeNull();
    expect(screen.queryByText(/last available fact/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/fact", expect.objectContaining({ cache: "no-store" }));
  });

  it("shows the stale hint when the server served the last stored fact", async () => {
    replies(ok({ ...FACT, stale: true }));
    render(<FactCard movieTitle="Heat" />);
    await flush();

    expect(screen.getByText(FACT.content)).toBeTruthy();
    expect(screen.getByText("Showing the last available fact")).toBeTruthy();
  });

  it("makes exactly one request across re-renders", async () => {
    replies(ok(FACT), ok(FACT), ok(FACT));
    const { rerender } = render(<FactCard movieTitle="Heat" />);
    await flush();
    rerender(<FactCard movieTitle="Heat" />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error with Try again, which refetches and recovers", async () => {
    const second = pending();
    replies(fail(502, { code: "UPSTREAM_FAILED", message: "Couldn't fetch a fact right now" }), second.promise);
    render(<FactCard movieTitle="Heat" />);
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("Couldn't reach the fact service");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Back to the skeleton while retrying with nothing to show.
    expect(screen.getByRole("status", { name: "Loading fact…" })).toBeTruthy();
    second.resolve(ok(FACT));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(FACT.content)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a generic error for a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<FactCard movieTitle="Heat" />);
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("Couldn't load a fact");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("shows the rate-limit wait time", async () => {
    replies(fail(429, { code: "RATE_LIMITED", message: "Too many requests", retryAfterMs: 12_300 }));
    render(<FactCard movieTitle="Heat" />);
    await flush();

    expect(screen.getByRole("alert").textContent).toMatch(/Slow down a little.*Try again in 13s/);
  });

  it("shows no Try again button while healthy", async () => {
    replies(ok(FACT));
    render(<FactCard movieTitle="Heat" />);
    await flush();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("redirects to / when the session has expired", async () => {
    replies(fail(401, { code: "UNAUTHORIZED", message: "Sign in required" }));
    render(<FactCard movieTitle="Heat" />);
    await flush();

    expect(replace).toHaveBeenCalledWith("/");
  });

  it("aborts the request on unmount", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const { unmount } = render(<FactCard movieTitle="Heat" />);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

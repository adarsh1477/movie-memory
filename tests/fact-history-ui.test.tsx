import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import FactHistory, { formatRelative } from "@/components/FactHistory";
import { HISTORY_PAGE_SIZE } from "@/lib/validation";
import { STORAGE_PREFIX, factCache } from "@/lib/client-cache";

const replace = vi.fn();
// A new object per call on purpose: the component must not refetch when identities change.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const T0 = Date.parse("2026-11-18T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

type Item = { id: string; movieTitle: string; content: string; createdAt: string };
const item = (id: string, minutesAgo: number, content = `Fact ${id}.`, movieTitle = "Heat"): Item => ({
  id,
  movieTitle,
  content,
  createdAt: iso(T0 - minutesAgo * 60_000),
});

type Reply = { status: number; body: unknown };
const page = (items: Item[], nextCursor: string | null): Reply => ({ status: 200, body: { ok: true, data: { items, nextCursor } } });
const fail = (status: number, error: Record<string, unknown>): Reply => ({ status, body: { ok: false, error } });

let fetchMock: ReturnType<typeof vi.fn>;
function replies(...queue: Array<Reply | Promise<Reply>>) {
  fetchMock = vi.fn(async () => {
    const next = queue.shift();
    const r = next ? await next : await new Promise<Reply>(() => {});
    return { ok: r.status < 300, status: r.status, headers: new Headers(), json: async () => r.body };
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
    await vi.advanceTimersByTimeAsync(0);
  });
}

const urls = () => fetchMock.mock.calls.map(([u]) => String(u));
const listItems = () => screen.queryAllByRole("listitem").filter((li) => li.querySelector("article"));
const contents = () => listItems().map((li) => li.querySelector("p")?.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  replace.mockReset();
  factCache.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FactHistory states", () => {
  it("shows a skeleton while the first page loads, then the timeline", async () => {
    const first = pending();
    replies(first.promise);
    render(<FactHistory latestFactAt={null} />);

    expect(screen.getByRole("status", { name: "Loading fact history…" })).toBeTruthy();
    expect(urls()).toEqual(["/api/facts/history?limit=5"]);

    first.resolve(page([item("f3", 0), item("f2", 2, "Second.", "Alien"), item("f1", 90)], null));
    await flush();

    expect(screen.queryByRole("status", { name: "Loading fact history…" })).toBeNull();
    expect(contents()).toEqual(["Fact f3.", "Second.", "Fact f1."]);
    const [, second, third] = listItems();
    expect(second.textContent).toContain("Alien"); // movie badge
    expect(second.querySelector("time")?.textContent).toBe("2 min ago");
    expect(second.querySelector("time")?.getAttribute("dateTime")).toBe(iso(T0 - 120_000));
    expect(third.querySelector("time")?.textContent).toBe("1 h ago");
  });

  it("marks the fact currently on the card as 'Now showing'", async () => {
    replies(page([item("f2", 0), item("f1", 5)], null));
    render(<FactHistory latestFactAt={iso(T0)} />);
    await flush();

    const [current, older] = listItems();
    expect(current.textContent).toContain("Now showing");
    expect(older.textContent).not.toContain("Now showing");
  });

  it("shows an empty state when there are no facts", async () => {
    replies(page([], null));
    render(<FactHistory latestFactAt={null} />);
    await flush();

    expect(screen.getByText("No facts yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /load more/i })).toBeNull();
  });

  it("shows an error with Try again, which recovers", async () => {
    replies(fail(500, { code: "INTERNAL", message: "x" }), page([item("f1", 1)], null));
    render(<FactHistory latestFactAt={null} />);
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("Couldn't load your fact history");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();

    expect(contents()).toEqual(["Fact f1."]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("redirects to / and clears the fact cache on 401", async () => {
    factCache.set("u1", "Heat", {
      fact: { content: "x", movieTitle: "Heat", generatedAt: iso(T0), serverNow: iso(T0), stale: false },
      fetchedAt: T0,
      clockOffsetMs: 0,
    });
    replies(fail(401, { code: "UNAUTHORIZED", message: "Sign in required" }));
    render(<FactHistory latestFactAt={null} />);
    await flush();

    expect(replace).toHaveBeenCalledWith("/");
    expect(factCache.get("u1", "Heat", T0)).toBeNull();
  });
});

describe("FactHistory Load more", () => {
  it("appends the next page using the cursor, shows a loading state, then disappears at the end", async () => {
    const second = pending();
    replies(page([item("f4", 0), item("f3", 1)], "f3"), second.promise);
    render(<FactHistory latestFactAt={null} pageSize={2} />);
    await flush();

    const button = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(button);
    expect(button.textContent).toBe("Loading…");
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button); // no double request
    expect(urls()).toEqual(["/api/facts/history?limit=2", "/api/facts/history?limit=2&cursor=f3"]);

    second.resolve(page([item("f2", 3), item("f1", 4)], null));
    await flush();

    expect(contents()).toEqual(["Fact f4.", "Fact f3.", "Fact f2.", "Fact f1."]);
    expect(screen.queryByRole("button", { name: /load more|loading/i })).toBeNull();
    expect(screen.getByText("Loaded 2 more facts.")).toBeTruthy();
  });

  it("keeps the list and the button when loading more fails", async () => {
    replies(page([item("f2", 0)], "f2"), fail(500, { code: "INTERNAL", message: "x" }), page([item("f1", 5)], null));
    render(<FactHistory latestFactAt={null} pageSize={1} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load more");
    expect(contents()).toEqual(["Fact f2."]);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(contents()).toEqual(["Fact f2.", "Fact f1."]);
  });

  it("never asks for more than one page at a time", async () => {
    replies(page([item("f1", 0)], "f1"));
    render(<FactHistory latestFactAt={null} />);
    await flush();
    expect(urls()).toEqual(["/api/facts/history?limit=5"]);
  });

  it("uses pages of 5 by default: first 5, then the next 5 per Load more", async () => {
    expect(HISTORY_PAGE_SIZE).toBe(5);
    const five = (from: number) => Array.from({ length: 5 }, (_, i) => item(`f${from - i}`, 15 - from + i));
    replies(page(five(15), "f11"), page(five(10), "f6"), page(five(5), null));
    render(<FactHistory latestFactAt={null} />);
    await flush();
    expect(listItems()).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(listItems()).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    expect(listItems()).toHaveLength(15);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(urls()).toEqual([
      "/api/facts/history?limit=5",
      "/api/facts/history?limit=5&cursor=f11",
      "/api/facts/history?limit=5&cursor=f6",
    ]);
  });
});

describe("FactHistory refresh on a new fact", () => {
  it("refreshes page 1 once when a new fact is shown, prepending it without duplicates", async () => {
    replies(page([item("f2", 1), item("f1", 2)], null), page([item("f3", 0, "Brand new."), item("f2", 1), item("f1", 2)], null));
    const { rerender } = render(<FactHistory latestFactAt={iso(T0 - 60_000)} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the first load already had that fact

    rerender(<FactHistory latestFactAt={iso(T0)} />);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(contents()).toEqual(["Brand new.", "Fact f2.", "Fact f1."]);
    expect(listItems()[0].textContent).toContain("Now showing");
  });

  it("doesn't refetch on re-renders or when the same fact is shown again", async () => {
    replies(page([item("f1", 0)], null));
    const { rerender } = render(<FactHistory latestFactAt={iso(T0)} />);
    await flush();
    rerender(<FactHistory latestFactAt={iso(T0)} />);
    rerender(<FactHistory latestFactAt={iso(T0)} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't fetch twice when the fact arrives while the first page is still loading", async () => {
    const first = pending();
    replies(first.promise);
    const { rerender } = render(<FactHistory latestFactAt={null} />);
    rerender(<FactHistory latestFactAt={iso(T0)} />);

    first.resolve(page([item("f1", 0)], null));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the pages already loaded when refreshing", async () => {
    replies(
      page([item("f3", 1), item("f2", 2)], "f2"),
      page([item("f1", 3)], null),
      page([item("f4", 0, "Newest."), item("f3", 1)], "f3"),
    );
    const { rerender } = render(<FactHistory latestFactAt={iso(T0 - 60_000)} pageSize={2} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();

    rerender(<FactHistory latestFactAt={iso(T0)} pageSize={2} />);
    await flush();

    expect(contents()).toEqual(["Newest.", "Fact f3.", "Fact f2.", "Fact f1."]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull(); // still at the end
  });

  it("starts over from the new page if it doesn't overlap the old list (a gap)", async () => {
    replies(page([item("f1", 30)], null), page([item("f9", 0), item("f8", 1)], "f8"));
    const { rerender } = render(<FactHistory latestFactAt={iso(T0 - 30 * 60_000)} pageSize={2} />);
    await flush();

    rerender(<FactHistory latestFactAt={iso(T0)} pageSize={2} />);
    await flush();

    expect(contents()).toEqual(["Fact f9.", "Fact f8."]);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("keeps the list if a refresh fails", async () => {
    replies(page([item("f1", 1)], null), fail(500, { code: "INTERNAL", message: "x" }));
    const { rerender } = render(<FactHistory latestFactAt={iso(T0 - 60_000)} />);
    await flush();

    rerender(<FactHistory latestFactAt={iso(T0)} />);
    await flush();
    expect(contents()).toEqual(["Fact f1."]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("only ever calls the history endpoint, and writes nothing to the fact cache", async () => {
    replies(page([item("f1", 1)], null), page([item("f2", 0), item("f1", 1)], null));
    const { rerender } = render(<FactHistory latestFactAt={iso(T0 - 60_000)} />);
    await flush();
    rerender(<FactHistory latestFactAt={iso(T0)} />);
    await flush();

    expect(urls().every((u) => u.startsWith("/api/facts/history"))).toBe(true);
    const storedKeys = Object.keys(window.sessionStorage).filter((k) => k.startsWith(STORAGE_PREFIX));
    expect(storedKeys).toEqual([]);
  });

  it("aborts its requests on unmount", () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const { unmount } = render(<FactHistory latestFactAt={null} />);
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});

describe("formatRelative", () => {
  it.each([
    [0, "just now"],
    [44_000, "just now"],
    [50_000, "1 min ago"],
    [2 * 60_000, "2 min ago"],
    [59 * 60_000, "59 min ago"],
    [60 * 60_000, "1 h ago"],
    [23 * 3_600_000, "23 h ago"],
    [30 * 3_600_000, "yesterday"],
  ])("%i ms ago → %s", (ago, text) => {
    expect(formatRelative(iso(T0 - ago), T0)).toBe(text);
  });

  it("uses a short date after two days", () => {
    expect(formatRelative(iso(T0 - 5 * 86_400_000), T0)).toMatch(/13/);
  });

  it("never says 'in the future' for a slightly fast server clock", () => {
    expect(formatRelative(iso(T0 + 5_000), T0)).toBe("just now");
  });
});

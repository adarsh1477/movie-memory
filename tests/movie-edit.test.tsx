import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import MovieHeroCard, { type HeroMovie } from "@/components/MovieHeroCard";
import { factCache } from "@/lib/client-cache";

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => {
    const rest = { ...props };
    delete rest.fill;
    delete rest.priority;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} />;
  },
}));

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const T0 = Date.parse("2026-11-18T12:00:00.000Z");
const HEAT: HeroMovie = { title: "Heat", tmdbId: 949, year: 1995, posterPath: "/heat.jpg" };
const ALIEN = { tmdbId: 348, title: "Alien", year: 1979, posterPath: "/alien.jpg" };

type Reply = { status: number; body: unknown };
const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });
const fail = (status: number, error: Record<string, unknown>): Reply => ({ status, body: { ok: false, error } });
const meWith = (movie: Omit<HeroMovie, never>) =>
  ok({
    user: { id: "u1", name: "Ada", email: "ada@example.com", image: null },
    movie: { ...movie, updatedAt: new Date(T0).toISOString() },
  });
const factFor = (title: string, content: string) =>
  ok({ content, movieTitle: title, generatedAt: new Date(Date.now()).toISOString(), serverNow: new Date(Date.now()).toISOString(), stale: false });

/** Routes fetch by URL. `put` may be a Reply or a promise for one (to hold the save open). */
let routes: {
  fact: (n: number) => Reply | Promise<Reply>;
  search: Reply;
  put: () => Reply | Promise<Reply>;
  history: () => Reply | Promise<Reply>;
};
let fetchMock: ReturnType<typeof vi.fn>;

function installFetch() {
  let factCalls = 0;
  fetchMock = vi.fn(async (url: string) => {
    // Match by exact path: "/api/facts/history" must not be answered as "/api/fact".
    const path = url.split("?")[0];
    const r: Reply = path === "/api/fact"
      ? await routes.fact(factCalls++)
      : path === "/api/facts/history"
        ? await routes.history()
        : url.startsWith("/api/movies/search")
        ? routes.search
        : url.startsWith("/api/me/movie")
          ? await routes.put()
          : fail(404, { code: "NOT_FOUND", message: "?" });
    return { ok: r.status < 300, status: r.status, headers: new Headers(), json: async () => r.body };
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** Calls to exactly this path (query string ignored). */
const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).split("?")[0] === path);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const heading = () => screen.getByRole("heading", { level: 1 });
const pencil = () => screen.getByRole("button", { name: "Edit favorite movie" });
const posterSrc = () => screen.getByAltText(/Heat|Alien|My Indie Film/).getAttribute("src");

async function renderHero(movie: HeroMovie = HEAT) {
  render(<MovieHeroCard userId="u1" movie={movie} />);
  await flush();
}

async function openEditorAndSearch(query: string) {
  fireEvent.click(pencil());
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  await flush(300);
  return input;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  replace.mockReset();
  refresh.mockReset();
  factCache.clear();
  routes = {
    fact: (n) => factFor(n === 0 ? "Heat" : "Alien", n === 0 ? "A Heat fact." : "An Alien fact."),
    search: ok({ results: [ALIEN], degraded: false }),
    put: () => meWith(ALIEN),
    history: () => ok({ items: [], nextCursor: null }),
  };
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("inline movie edit", () => {
  it("the pencil opens the search box, focused and prefilled with the current title", async () => {
    await renderHero();

    expect(pencil().hasAttribute("disabled")).toBe(false);
    fireEvent.click(pencil());

    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("Heat");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("picking a result shows the new title, year and poster before the save finishes", async () => {
    const save = deferred<Reply>();
    routes.put = () => save.promise;
    await renderHero();
    expect(screen.getByText("A Heat fact.")).toBeTruthy();

    await openEditorAndSearch("alien");
    fireEvent.click(screen.getByRole("option", { name: /Alien/ }));

    // Optimistic: already showing Alien while the PUT is still open.
    expect(heading().textContent).toBe("Alien1979");
    expect(posterSrc()).toContain("/alien.jpg");
    expect(pencil().hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("status", { name: "Saving your movie…" })).toBeTruthy();
    expect(callsTo("/api/fact")).toHaveLength(1); // no fact request for Alien yet

    const [, init] = callsTo("/api/me/movie")[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Alien", tmdbId: 348, year: 1979, posterPath: "/alien.jpg" });

    save.resolve(meWith(ALIEN));
    await flush();

    expect(heading().textContent).toBe("Alien1979");
    expect(callsTo("/api/fact")).toHaveLength(2); // the FactCard remounted for the confirmed movie
    expect(screen.getByText("An Alien fact.")).toBeTruthy();
    expect(document.activeElement).toBe(pencil());
    expect(refresh).toHaveBeenCalled();
  });

  it("clears the old movie's cached fact after a successful save", async () => {
    await renderHero();
    expect(factCache.get("u1", "Heat")).not.toBeNull();

    await openEditorAndSearch("alien");
    fireEvent.click(screen.getByRole("option", { name: /Alien/ }));
    await flush();

    expect(factCache.get("u1", "Heat")).toBeNull();
  });

  it("reverts title, year and poster and shows the error when the save fails", async () => {
    routes.put = () => fail(500, { code: "INTERNAL", message: "Something went wrong. Please try again." });
    await renderHero();

    await openEditorAndSearch("alien");
    fireEvent.click(screen.getByRole("option", { name: /Alien/ }));
    expect(heading().textContent).toBe("Alien1979"); // optimistic first
    await flush();

    expect(heading().textContent).toBe("Heat1995");
    expect(posterSrc()).toContain("/heat.jpg");
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong. Please try again.");
    expect(screen.getByText("A Heat fact.")).toBeTruthy();
    expect(callsTo("/api/fact")).toHaveLength(1);
    expect(document.activeElement).toBe(pencil());
  });

  it("Cancel leaves edit mode without saving and returns focus to the pencil", async () => {
    await renderHero();
    fireEvent.click(pencil());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "something else" } });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(heading().textContent).toBe("Heat1995");
    expect(callsTo("/api/me/movie")).toHaveLength(0);
    expect(document.activeElement).toBe(pencil());
  });

  it("Escape closes an open dropdown first, then leaves edit mode", async () => {
    await renderHero();
    const input = await openEditorAndSearch("alien");
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox")).toBeTruthy(); // still editing

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(callsTo("/api/me/movie")).toHaveLength(0);
    expect(document.activeElement).toBe(pencil());
  });

  it("is keyboard operable: arrows + Enter pick a result and save it", async () => {
    await renderHero();
    const input = await openEditorAndSearch("alien");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await flush();

    expect(callsTo("/api/me/movie")).toHaveLength(1);
    expect(heading().textContent).toBe("Alien1979");
  });

  it("free text is sent without TMDB fields and the server's rule is shown on rejection", async () => {
    routes.search = ok({ results: [], degraded: true });
    routes.put = () =>
      fail(400, {
        code: "VALIDATION",
        message: "Pick your movie from the suggestions so we get the right film.",
        fieldErrors: { title: "Pick your movie from the suggestions so we get the right film." },
      });
    await renderHero();

    const input = await openEditorAndSearch("my indie film");
    fireEvent.submit(input.closest("form")!);
    expect(heading().textContent).toBe("My Indie Film"); // optimistic, no year
    await flush();

    const [, init] = callsTo("/api/me/movie")[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ title: "my indie film", tmdbId: null, year: null, posterPath: null });
    expect(heading().textContent).toBe("Heat1995");
    expect(screen.getByRole("alert").textContent).toContain("Pick your movie from the suggestions");
  });

  it("free text is saved when the server accepts it", async () => {
    routes.search = ok({ results: [], degraded: true });
    routes.put = () => meWith({ title: "my indie film", tmdbId: null, year: null, posterPath: null });
    await renderHero();

    const input = await openEditorAndSearch("my indie film");
    fireEvent.submit(input.closest("form")!);
    await flush();

    expect(heading().textContent).toBe("My Indie Film");
    expect(screen.getByRole("img", { name: /No poster available/ })).toBeTruthy();
  });

  it("an empty title shows an inline error and doesn't save", async () => {
    await renderHero();
    fireEvent.click(pencil());
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(within(input.closest("form")!.parentElement!).getByRole("alert").textContent).toMatch(/Type a movie title/);
    expect(callsTo("/api/me/movie")).toHaveLength(0);
  });

  it("an unchanged title just closes the editor", async () => {
    await renderHero();
    fireEvent.click(pencil());
    fireEvent.submit(screen.getByRole("combobox").closest("form")!);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(callsTo("/api/me/movie")).toHaveLength(0);
  });

  // jsdom doesn't compute stacking, so these pin the classes that create the order: the
  // title area (which hosts the dropdown) comes BEFORE the FactCard area in the DOM, so it
  // needs an explicitly higher z-index than the FactCard area to paint on top of it.
  describe("dropdown stacking above the FactCard", () => {
    it("the title area (which hosts the dropdown) stacks above the FactCard area", async () => {
      await renderHero();
      await openEditorAndSearch("alien");

      const titleArea = screen.getByTestId("hero-title-area");
      const factArea = screen.getByTestId("hero-fact-area");
      const popup = screen.getByTestId("combobox-popup");

      expect(titleArea.classList).toContain("relative");
      expect(titleArea.classList).toContain("z-20");
      expect(factArea.classList).toContain("relative");
      expect(factArea.classList).toContain("z-0");
      expect(titleArea.contains(popup)).toBe(true);
      expect(factArea.contains(popup)).toBe(false);
      // The FactCard comes later in the DOM, so without the z-index it would paint on top.
      expect(titleArea.compareDocumentPosition(factArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("the fact history sits below the title area too, so the dropdown paints over it", async () => {
      await renderHero();
      await openEditorAndSearch("alien");

      const titleArea = screen.getByTestId("hero-title-area");
      const historyArea = screen.getByTestId("hero-history-area");
      expect(historyArea.classList).toContain("relative");
      expect(historyArea.classList).toContain("z-0");
      expect(historyArea.contains(screen.getByTestId("combobox-popup"))).toBe(false);
      expect(titleArea.compareDocumentPosition(historyArea) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Fact history" })).toBeTruthy();
    });

    it("no ancestor of the dropdown clips it", async () => {
      await renderHero();
      await openEditorAndSearch("alien");

      const section = screen.getByTestId("hero-title-area").closest("section")!;
      let el: HTMLElement | null = screen.getByTestId("combobox-popup").parentElement;
      while (el && el !== section.parentElement) {
        expect(el.className).not.toMatch(/\boverflow-(hidden|clip)\b/);
        el = el.parentElement;
      }
      // Only the backdrop layer is clipped.
      expect(section.querySelector('[aria-hidden="true"]')?.className).toContain("overflow-hidden");
    });

    it("the dropdown is fully opaque, bordered, shadowed and scrolls", async () => {
      await renderHero();
      await openEditorAndSearch("alien");

      const popup = screen.getByTestId("combobox-popup");
      expect(popup.className).toContain("bg-[#17171E]");
      expect(popup.className).not.toMatch(/bg-\[#17171E\]\//); // no alpha
      expect(popup.className).not.toMatch(/backdrop-blur/);
      expect(popup.className).toMatch(/\bborder\b/);
      expect(popup.className).toMatch(/shadow-\[/);
      expect(popup.className).toContain("z-50");
      const list = screen.getByRole("listbox");
      expect(list.className).toMatch(/max-h-/);
      expect(list.className).toContain("overflow-y-auto");
    });

    it("clicking a result works while the FactCard is still loading (animating in)", async () => {
      routes.fact = () => new Promise<Reply>(() => {}); // the FactCard stays in its loading skeleton
      await renderHero();
      expect(screen.getByRole("status", { name: "Loading fact…" })).toBeTruthy();
      await openEditorAndSearch("alien");

      fireEvent.click(screen.getByRole("option", { name: /Alien/ }));
      await flush();
      expect(callsTo("/api/me/movie")).toHaveLength(1);
      expect(heading().textContent).toBe("Alien1979");
    });
  });

  it("a new fact on the card refreshes the history once, with no extra fact requests", async () => {
    const heatAt = new Date(T0).toISOString();
    let historyCalls = 0;
    routes.history = () => {
      historyCalls++;
      return ok({
        items:
          historyCalls === 1
            ? [{ id: "h1", movieTitle: "Heat", content: "A Heat fact.", createdAt: heatAt }]
            : [
                { id: "h2", movieTitle: "Alien", content: "An Alien fact.", createdAt: new Date(Date.now()).toISOString() },
                { id: "h1", movieTitle: "Heat", content: "A Heat fact.", createdAt: heatAt },
              ],
        nextCursor: null,
      });
    };
    await renderHero();
    expect(callsTo("/api/fact")).toHaveLength(1);
    expect(callsTo("/api/facts/history")).toHaveLength(1); // first fact was already in page 1

    await openEditorAndSearch("alien");
    fireEvent.click(screen.getByRole("option", { name: /Alien/ }));
    await flush();
    await flush();

    expect(callsTo("/api/fact")).toHaveLength(2); // just the new movie's fact
    // The movie change remounts the history (keyed by movie): one fresh "latest 5" request,
    // which already contains the new fact, so no extra refresh is needed.
    expect(callsTo("/api/facts/history")).toHaveLength(2);
    const history = screen.getByTestId("hero-history-area");
    expect(history.textContent).toContain("An Alien fact.");
    expect(history.textContent).toContain("A Heat fact.");
  });

  it("a movie change resets an expanded history to the latest 5", async () => {
    const at = (minutesAgo: number) => new Date(T0 - minutesAgo * 60_000).toISOString();
    const h = (n: number) => ({ id: `h${n}`, movieTitle: "Heat", content: `Heat fact ${n}.`, createdAt: at(n) });
    // h0 is the fact on the card (generatedAt = now), so page 1 already contains it and no
    // refresh is triggered; call 2 is the Load more, call 3 the remount after the movie change.
    let call = 0;
    routes.history = () => {
      call++;
      if (call === 1) return ok({ items: [0, 1, 2, 3, 4].map(h), nextCursor: "h4" });
      if (call === 2) return ok({ items: [5, 6, 7].map(h), nextCursor: null });
      return ok({ items: [0, 1, 2, 3, 4].map(h), nextCursor: "h4" });
    };
    await renderHero();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await flush();
    const history = () => screen.getByTestId("hero-history-area");
    expect(history().querySelectorAll("article")).toHaveLength(8);

    await openEditorAndSearch("alien");
    fireEvent.click(screen.getByRole("option", { name: /Alien/ }));
    await flush();
    await flush();

    expect(history().querySelectorAll("article")).toHaveLength(5);
    const historyUrls = callsTo("/api/facts/history").map(([u]) => String(u));
    expect(historyUrls.at(-1)).toBe("/api/facts/history?limit=5"); // a fresh first page, no cursor
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
  });

  it("an expired session redirects to /", async () => {
    routes.put = () => fail(401, { code: "UNAUTHORIZED", message: "Sign in required" });
    await renderHero();
    await openEditorAndSearch("alien");
    fireEvent.click(screen.getByRole("option", { name: /Alien/ }));
    await flush();
    expect(replace).toHaveBeenCalledWith("/");
  });
});

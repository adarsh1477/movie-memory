// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WIKIPEDIA_MAX_CHARS,
  WIKIPEDIA_TIMEOUT_MS,
  WIKIPEDIA_TTL_MS,
  confirmsFilm,
  createWikipediaLoader,
  extractProductionNotes,
  fetchWikipediaNotes,
  normalizeTitle,
  rankCandidates,
  type WikipediaQuery,
  type WikipediaResult,
} from "@/lib/wikipedia";

const DUNE: WikipediaQuery = { title: "Dune: Part Two", year: 2024, director: "Denis Villeneuve" };

const DUNE_EXTRACT = [
  "Dune: Part Two is a 2024 American epic science fiction film directed by Denis Villeneuve.",
  "",
  "== Plot ==",
  "Paul Atreides unites with the Fremen. SECRET PLOT TEXT.",
  "",
  "== Cast ==",
  "Timothée Chalamet as Paul Atreides",
  "",
  "== Production ==",
  "",
  "=== Development ===",
  "Legendary Pictures confirmed the sequel in October 2021.",
  "",
  "=== Casting ===",
  "Florence Pugh joined the cast as Princess Irulan in March 2022.",
  "",
  "=== Filming ===",
  "Principal photography began on July 18, 2022, at Origo Studios in Budapest, with desert scenes shot in Jordan and Abu Dhabi.",
  "",
  "== Music ==",
  "Hans Zimmer returned to compose the score.",
  "",
  "== Release ==",
  "The film was released on March 1, 2024.",
].join("\n");

type Call = { url: URL; init: RequestInit };
let calls: Call[];

/** Routes the two MediaWiki requests: list=search and prop=extracts. */
function wiki({
  search = [] as string[],
  extract = DUNE_EXTRACT as string | undefined,
  searchBody,
  extractBody,
  status = 200,
}: {
  search?: string[];
  extract?: string;
  searchBody?: unknown;
  extractBody?: unknown;
  status?: number;
} = {}) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL, init: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      const isSearch = url.searchParams.get("list") === "search";
      const body = isSearch
        ? (searchBody ?? { query: { search: search.map((title, i) => ({ title, pageid: i + 1 })) } })
        : (extractBody ?? { query: { pages: [{ pageid: 1, title: url.searchParams.get("titles"), extract }] } });
      return { ok: status < 300, status, json: async () => body };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── fetchWikipediaNotes ───────────────────────────────────────────────────────

describe("fetchWikipediaNotes", () => {
  it("finds the film and returns only production-type sections", async () => {
    wiki({ search: ["Dune (novel)", "Dune: Part Two", "Dune: Part Two (soundtrack)"] });

    const result = await fetchWikipediaNotes(DUNE);

    expect(result.ok).toBe(true);
    expect(result.notes?.pageTitle).toBe("Dune: Part Two");
    const text = result.notes!.text;
    expect(text).toContain("Production – Filming: Principal photography began on July 18, 2022, at Origo Studios in Budapest");
    expect(text).toContain("Production – Casting: Florence Pugh joined the cast");
    expect(text).toContain("Production – Development:");
    expect(text).toContain("Music: Hans Zimmer");
    expect(text).not.toMatch(/SECRET PLOT TEXT|Plot:/); // no plot summary
    expect(text).not.toContain("Timothée Chalamet as"); // no cast list
    expect(text).not.toContain("released on March 1"); // no release section
  });

  it("calls the public MediaWiki API with a descriptive User-Agent and no key", async () => {
    wiki({ search: ["Dune: Part Two"] });
    await fetchWikipediaNotes(DUNE);

    expect(calls).toHaveLength(2);
    const [search, extract] = calls;
    expect(search.url.origin + search.url.pathname).toBe("https://en.wikipedia.org/w/api.php");
    expect(search.url.searchParams.get("srsearch")).toBe("Dune: Part Two 2024 film");
    expect(extract.url.searchParams.get("titles")).toBe("Dune: Part Two");
    expect(extract.url.searchParams.get("explaintext")).toBe("1");
    const headers = search.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^MovieMemory\/\d/);
    expect(headers["User-Agent"]).not.toMatch(/@/); // no personal contact data
    expect(search.init.signal).toBeInstanceOf(AbortSignal);
    expect([...search.url.searchParams.keys()].some((k) => /key|token/i.test(k))).toBe(false);
  });

  it("prefers the '(YEAR film)' page and rejects other years and other works", async () => {
    const extract2021 = "Dune is a 2021 American epic science fiction film directed by Denis Villeneuve.\n\n== Production ==\nFilmed in Jordan.";
    wiki({ search: ["Dune", "Dune (1984 film)", "Dune (2021 film)", "Dune (novel)"], extract: extract2021 });

    const result = await fetchWikipediaNotes({ title: "Dune", year: 2021, director: "Denis Villeneuve" });

    expect(calls[1].url.searchParams.get("titles")).toBe("Dune (2021 film)");
    expect(result.notes?.text).toBe("Production: Filmed in Jordan.");
  });

  it("rejects a page whose title doesn't match (e.g. only the novel or the soundtrack)", async () => {
    wiki({ search: ["Dune (novel)", "Dune: Part Two (soundtrack)", "Dune: Part Three"] });
    expect(await fetchWikipediaNotes(DUNE)).toEqual({ ok: true, notes: null });
    expect(calls).toHaveLength(1); // never fetched an article
  });

  it("rejects a same-titled page that doesn't mention the year or the director", async () => {
    wiki({
      search: ["Dune: Part Two"],
      extract: "Dune: Part Two is a 1999 board game expansion.\n\n== Production ==\nDesigned in Germany.",
    });
    expect(await fetchWikipediaNotes(DUNE)).toEqual({ ok: true, notes: null });
  });

  it("accepts a page confirmed by the director when the year isn't in the lead", async () => {
    wiki({
      search: ["Dune: Part Two"],
      extract: "Dune: Part Two is an epic film by Villeneuve.\n\n== Production ==\nFilmed in Budapest.",
    });
    expect((await fetchWikipediaNotes(DUNE)).notes?.text).toBe("Production: Filmed in Budapest.");
  });

  it("no search results → no notes", async () => {
    wiki({ search: [] });
    expect(await fetchWikipediaNotes(DUNE)).toEqual({ ok: true, notes: null });
  });

  it("an article without production sections → no notes (plot alone isn't useful)", async () => {
    wiki({
      search: ["Dune: Part Two"],
      extract: "Dune: Part Two is a 2024 film.\n\n== Plot ==\nThings happen.\n\n== Cast ==\nPeople.\n\n== Reception ==\nGood.",
    });
    expect(await fetchWikipediaNotes(DUNE)).toEqual({ ok: true, notes: null });
  });

  it("caps the notes at about 3000 characters", async () => {
    const long = Array.from({ length: 200 }, (_, i) => `Filming detail number ${i} took place on set.`).join(" ");
    wiki({ search: ["Dune: Part Two"], extract: `Dune: Part Two is a 2024 film.\n\n== Production ==\n${long}` });

    const text = (await fetchWikipediaNotes(DUNE)).notes!.text;
    expect(text.length).toBeLessThanOrEqual(WIKIPEDIA_MAX_CHARS);
    expect(text.length).toBeGreaterThan(WIKIPEDIA_MAX_CHARS * 0.6);
    expect(text.endsWith(".")).toBe(true);
  });

  it("gives up after the 2s timeout and reports a transient failure", { timeout: 6_000 }, async () => {
    expect(WIKIPEDIA_TIMEOUT_MS).toBe(2_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      ),
    );

    const started = Date.now();
    const result = await fetchWikipediaNotes(DUNE);
    const elapsed = Date.now() - started;

    expect(result).toEqual({ ok: false, notes: null });
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(3_500);
  });

  it.each([
    ["a network error", () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))],
    ["an HTTP 503", () => wiki({ search: ["Dune: Part Two"], status: 503 })],
    ["a malformed search response", () => wiki({ searchBody: { batchcomplete: true } })],
    ["a malformed article response", () => wiki({ search: ["Dune: Part Two"], extractBody: { query: { pages: "nope" } } })],
  ])("returns a transient failure (never throws) on %s", async (_label, setup) => {
    setup();
    await expect(fetchWikipediaNotes(DUNE)).resolves.toEqual({ ok: false, notes: null });
  });

  it("doesn't search when there's nothing to verify a match with (no year, no director)", async () => {
    wiki({ search: ["Dune: Part Two"] });
    expect(await fetchWikipediaNotes({ title: "Dune: Part Two", year: null, director: null })).toEqual({
      ok: true,
      notes: null,
    });
    expect(calls).toHaveLength(0);
  });
});

// ── Matching helpers ──────────────────────────────────────────────────────────

describe("matching helpers", () => {
  it("normalizes titles across punctuation, case and accents", () => {
    expect(normalizeTitle("Spider-Man: Brand New Day")).toBe("spider man brand new day");
    expect(normalizeTitle("Amélie")).toBe("amelie");
    expect(normalizeTitle("Fast & Furious")).toBe("fast and furious");
  });

  it("matches Spider-Man: Brand New Day to its '(film)' page", () => {
    const q = { title: "Spider-Man: Brand New Day", year: 2026, director: "Destin Daniel Cretton" };
    expect(rankCandidates(["Spider-Man: Brand New Day (soundtrack)", "Spider-Man: Brand New Day"], q)).toEqual([
      "Spider-Man: Brand New Day",
    ]);
    expect(rankCandidates(["Spider-Man: Brand New Day", "Spider-Man: Brand New Day (film)", "Spider-Man: Brand New Day (2026 film)"], q)).toEqual([
      "Spider-Man: Brand New Day (2026 film)",
      "Spider-Man: Brand New Day (film)",
      "Spider-Man: Brand New Day",
    ]);
  });

  it("confirms by year or by director surname, and nothing else", () => {
    expect(confirmsFilm("A 2024 film.", DUNE)).toBe(true);
    expect(confirmsFilm("Directed by Denis Villeneuve.", DUNE)).toBe(true);
    expect(confirmsFilm("Villeneuve's sequel.", DUNE)).toBe(true);
    expect(confirmsFilm("A 2023 film by someone else.", DUNE)).toBe(false);
    expect(confirmsFilm("A 20245 thing.", DUNE)).toBe(false);
  });

  it("keeps production subsections but drops plot, cast, release, reception and soundtrack", () => {
    const text = extractProductionNotes(
      [
        "Lead.",
        "== Plot ==",
        "plot",
        "== Production ==",
        "=== Casting ===",
        "casting story",
        "=== Soundtrack ===",
        "track list",
        "== Visual effects ==",
        "vfx story",
        "== Reception ==",
        "reviews",
      ].join("\n"),
    );
    expect(text).toBe("Production – Casting: casting story\nVisual effects: vfx story");
  });
});

// ── Cache ─────────────────────────────────────────────────────────────────────

describe("createWikipediaLoader (24h cache)", () => {
  const FOUND: WikipediaResult = { ok: true, notes: { pageTitle: "Dune: Part Two", text: "Production: Filmed in Budapest." } };

  it("cache hit: a second lookup within 24h makes no request", async () => {
    const fetchNotes = vi.fn(async () => FOUND);
    const load = createWikipediaLoader({ fetchNotes });

    expect(await load(DUNE)).toEqual(FOUND);
    expect(await load({ ...DUNE, title: "dune part two" })).toEqual(FOUND); // same film, normalized key
    expect(fetchNotes).toHaveBeenCalledTimes(1);
  });

  it("caches a miss too, so a film without a usable article isn't looked up on every fact", async () => {
    const fetchNotes = vi.fn(async () => ({ ok: true, notes: null }));
    const load = createWikipediaLoader({ fetchNotes });

    await load(DUNE);
    await load(DUNE);
    expect(fetchNotes).toHaveBeenCalledTimes(1);
  });

  it("does not cache a transient failure (timeout / network), so the next request tries again", async () => {
    const fetchNotes = vi
      .fn<(q: WikipediaQuery) => Promise<WikipediaResult>>()
      .mockResolvedValueOnce({ ok: false, notes: null })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(FOUND);
    const load = createWikipediaLoader({ fetchNotes });

    expect(await load(DUNE)).toEqual({ ok: false, notes: null });
    expect(await load(DUNE)).toEqual({ ok: false, notes: null }); // a throw becomes a failure, never an exception
    expect(await load(DUNE)).toEqual(FOUND);
    await load(DUNE);
    expect(fetchNotes).toHaveBeenCalledTimes(3);
  });

  it("expires after 24h", async () => {
    let t = 0;
    const fetchNotes = vi.fn(async () => FOUND);
    const load = createWikipediaLoader({ fetchNotes, now: () => t });

    await load(DUNE);
    t = WIKIPEDIA_TTL_MS - 1;
    await load(DUNE);
    expect(fetchNotes).toHaveBeenCalledTimes(1);
    t = WIKIPEDIA_TTL_MS + 1;
    await load(DUNE);
    expect(fetchNotes).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const fetchNotes = vi.fn(async () => FOUND);
    const load = createWikipediaLoader({ fetchNotes });

    const results = await Promise.all(Array.from({ length: 10 }, () => load(DUNE)));
    expect(fetchNotes).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === results[0])).toBe(true);
  });

  it("keys by title, year and director", async () => {
    const fetchNotes = vi.fn(async () => FOUND);
    const load = createWikipediaLoader({ fetchNotes });
    await load(DUNE);
    await load({ ...DUNE, year: 2021 });
    await load({ ...DUNE, director: "Someone Else" });
    expect(fetchNotes).toHaveBeenCalledTimes(3);
  });
});

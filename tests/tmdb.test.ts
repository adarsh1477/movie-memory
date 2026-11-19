import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPosterPool,
  fetchPosterList,
  mergePosterLists,
  createPosterPoolLoader,
  POSTER_POOL_MAX,
  POSTER_POOL_TTL_MS,
  POSTER_POOL_PARTIAL_TTL_MS,
  POSTER_POOL_RETRY_MS,
  type PosterList,
  searchMovies,
  fetchMovieDetails,
  createMovieDetailsLoader,
  MOVIE_DETAILS_TTL_MS,
  type MovieDetails,
} from "@/lib/tmdb";

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }),
  );
}

beforeEach(() => {
  process.env.TMDB_API_KEY = "test-bearer-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.TMDB_API_KEY;
});

// .env.example ships `TMDB_API_KEY=` (empty): it must behave exactly like unset.
describe("an empty TMDB_API_KEY is treated as unset", () => {
  beforeEach(() => {
    process.env.TMDB_API_KEY = "";
  });

  it("search degrades (free text allowed) with no fetch and no error", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(searchMovies("heat")).resolves.toEqual({ results: [], degraded: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("movie details are null (facts use knowledge mode) with no fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchMovieDetails(1)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the poster pool is empty (gradient fallback) with no fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getPosterPool()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchPosterList", () => {
  it("returns poster paths, skipping posters with no image or an odd path", async () => {
    stubFetch({
      results: [
        { poster_path: "/abc123.jpg" },
        { poster_path: "/def456.jpg" },
        { poster_path: null },
        {},
        { poster_path: "https://evil.example/x.jpg" },
        { poster_path: "/ghi789.jpg" },
      ],
    });
    await expect(fetchPosterList("movie/popular")).resolves.toEqual(["/abc123.jpg", "/def456.jpg", "/ghi789.jpg"]);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toBe("https://api.themoviedb.org/3/movie/popular?language=en-US&page=1");
    expect(init).toMatchObject({ headers: { Authorization: "Bearer test-bearer-token" }, cache: "no-store" });
  });

  it.each([
    ["an unexpected body", () => stubFetch({ page: 1, total_results: 0 })],
    ["fetch throwing", () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")))],
    ["a non-OK status", () => stubFetch({}, false)],
  ])("returns null (failed, not empty) on %s", async (_label, arrange) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    arrange();
    await expect(fetchPosterList("trending/movie/day")).resolves.toBeNull();
  });

  it("returns null with no fetch when TMDB_API_KEY is not set", async () => {
    delete process.env.TMDB_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchPosterList("movie/popular")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("mergePosterLists", () => {
  it("de-duplicates across lists, interleaves them, and caps the pool", () => {
    const pool = mergePosterLists([
      ["/a.jpg", "/b.jpg", "/c.jpg"],
      ["/b.jpg", "/d.jpg"],
      ["/a.jpg", "/e.jpg", "/f.jpg"],
    ]);
    expect(pool).toEqual(["/a.jpg", "/b.jpg", "/d.jpg", "/e.jpg", "/c.jpg", "/f.jpg"]);
    expect(new Set(pool).size).toBe(pool.length);
    expect(mergePosterLists([["/a.jpg", "/b.jpg"], ["/c.jpg"]], 2)).toEqual(["/a.jpg", "/c.jpg"]);
  });

  it("four realistic lists of 20 with overlap give a 60-80 poster pool with no duplicates", () => {
    const list = (from: number) => Array.from({ length: 20 }, (_, i) => `/p${from + i}.jpg`);
    const pool = mergePosterLists([list(0), list(10), list(25), list(45)]); // overlaps 0-19/10-29
    expect(pool.length).toBeGreaterThanOrEqual(60);
    expect(pool.length).toBeLessThanOrEqual(POSTER_POOL_MAX);
    expect(new Set(pool).size).toBe(pool.length);
  });
});

describe("createPosterPoolLoader", () => {
  const LISTS = ["trending/movie/day", "movie/popular", "movie/top_rated", "movie/now_playing"] as const;
  const listOf = (prefix: string) => Array.from({ length: 20 }, (_, i) => `/${prefix}${i}.jpg`);
  const OK = { "trending/movie/day": listOf("t"), "movie/popular": listOf("p"), "movie/top_rated": listOf("r"), "movie/now_playing": listOf("n") };

  function setup(impl?: (list: PosterList) => Promise<string[] | null>) {
    let t = 1_000_000;
    const fetchList = vi.fn(impl ?? (async (list: PosterList) => OK[list]));
    const load = createPosterPoolLoader({ fetchList, now: () => t });
    return { load, fetchList, advance: (ms: number) => (t += ms) };
  }

  it("builds the pool from all four lists, with no duplicates and at most 80 posters", async () => {
    const { load, fetchList } = setup();
    const pool = await load();
    expect(fetchList.mock.calls.map((c) => c[0])).toEqual([...LISTS]);
    expect(pool).toHaveLength(80);
    expect(new Set(pool).size).toBe(80);
  });

  it("the second call within the hour does not hit TMDB; after an hour it refreshes", async () => {
    const { load, fetchList, advance } = setup();
    const first = await load();
    advance(POSTER_POOL_TTL_MS - 1);
    expect(await load()).toBe(first);
    expect(fetchList).toHaveBeenCalledTimes(4); // one call per list, once

    advance(1);
    await load();
    expect(fetchList).toHaveBeenCalledTimes(8);
  });

  it("concurrent calls share one refresh (one request per list)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { load, fetchList } = setup(async (list) => {
      await gate;
      return OK[list];
    });
    const calls = Array.from({ length: 10 }, () => load());
    release();
    const pools = await Promise.all(calls);
    expect(fetchList).toHaveBeenCalledTimes(4);
    for (const p of pools) expect(p).toBe(pools[0]);
  });

  it("stale on error: when every list fails after expiry, the last good pool is served", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let failing = false;
    const { load, fetchList, advance } = setup(async (list) => (failing ? null : OK[list]));
    const good = await load();

    failing = true;
    advance(POSTER_POOL_TTL_MS);
    expect(await load()).toBe(good);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("last good pool"));

    // The failure isn't cached as success: once the retry pause is over, TMDB is tried again.
    const callsAfterFailure = fetchList.mock.calls.length;
    advance(POSTER_POOL_RETRY_MS - 1);
    expect(await load()).toBe(good);
    expect(fetchList).toHaveBeenCalledTimes(callsAfterFailure); // pausing, no hammering
    failing = false;
    advance(1);
    const fresh = await load();
    expect(fetchList).toHaveBeenCalledTimes(callsAfterFailure + 4);
    expect(fresh).toEqual(good);
    expect(fresh).not.toBe(good); // a new pool object: the refresh really happened
  });

  it("thrown errors and timeouts count as failures too", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { load } = setup(async () => {
      throw new Error("The operation was aborted due to timeout");
    });
    await expect(load()).resolves.toEqual([]);
  });

  it("existing fallback: no good pool yet and TMDB down → [] (the pages show no wall), and it retries later", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let failing = true;
    const { load, fetchList, advance } = setup(async (list) => (failing ? null : OK[list]));
    await expect(load()).resolves.toEqual([]);
    failing = false;
    advance(POSTER_POOL_RETRY_MS);
    await expect(load()).resolves.toHaveLength(80);
    expect(fetchList).toHaveBeenCalledTimes(8);
  });

  it("a partial refresh is used, but only for 5 minutes, and never shrinks a bigger pool", async () => {
    let down: PosterList[] = ["movie/top_rated", "movie/now_playing"];
    const { load, fetchList, advance } = setup(async (list) => (down.includes(list) ? null : OK[list]));
    expect(await load()).toHaveLength(40); // two lists of 20

    advance(POSTER_POOL_PARTIAL_TTL_MS - 1);
    await load();
    expect(fetchList).toHaveBeenCalledTimes(4);
    down = [];
    advance(1);
    const full = await load();
    expect(full).toHaveLength(80);

    down = ["movie/popular"];
    advance(POSTER_POOL_TTL_MS);
    expect(await load()).toBe(full); // the partial (60) pool doesn't replace the full one
    advance(POSTER_POOL_PARTIAL_TTL_MS);
    await load();
    expect(fetchList).toHaveBeenCalledTimes(16); // retried after 5 minutes, not an hour
  });

  it("all lists empty (nothing usable) is treated as a failure, not cached", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { load, fetchList, advance } = setup(async () => []);
    await expect(load()).resolves.toEqual([]);
    advance(POSTER_POOL_RETRY_MS);
    await load();
    expect(fetchList).toHaveBeenCalledTimes(8);
  });
});

describe("getPosterPool", () => {
  it("returns [] with no fetch when TMDB_API_KEY is not set", async () => {
    delete process.env.TMDB_API_KEY;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(getPosterPool()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── searchMovies ────────────────────────────────────────────────────────────

describe("searchMovies", () => {
  const item = (over: Record<string, unknown> = {}) => ({
    id: 949,
    title: "Heat",
    release_date: "1995-12-15",
    poster_path: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg",
    ...over,
  });

  it("calls TMDB search server-side with the Bearer token, encoded query and a timeout", async () => {
    stubFetch({ results: [] });

    await searchMovies("heat & dust");

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toContain("/3/search/movie?");
    expect(url.searchParams.get("query")).toBe("heat & dust");
    expect(url.searchParams.get("include_adult")).toBe("false");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-bearer-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps results to {tmdbId, title, year, posterPath}", async () => {
    stubFetch({ results: [item()] });

    await expect(searchMovies("heat")).resolves.toEqual({
      degraded: false,
      results: [{ tmdbId: 949, title: "Heat", year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" }],
    });
  });

  it("returns at most 6 results", async () => {
    stubFetch({ results: Array.from({ length: 20 }, (_, i) => item({ id: i + 1 })) });

    const { results } = await searchMovies("heat");

    expect(results.map((r) => r.tmdbId)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("uses null for a missing or empty release date and poster", async () => {
    stubFetch({
      results: [
        item({ id: 1, release_date: "", poster_path: null }),
        item({ id: 2, release_date: undefined, poster_path: undefined }),
      ],
    });

    const { results } = await searchMovies("heat");

    expect(results).toEqual([
      { tmdbId: 1, title: "Heat", year: null, posterPath: null },
      { tmdbId: 2, title: "Heat", year: null, posterPath: null },
    ]);
  });

  it("drops only the bad field when a poster path looks unsafe", async () => {
    stubFetch({ results: [item({ poster_path: "https://evil.example/x.jpg" })] });

    const { results } = await searchMovies("heat");

    expect(results).toEqual([{ tmdbId: 949, title: "Heat", year: 1995, posterPath: null }]);
  });

  it("skips malformed items but keeps the valid ones", async () => {
    stubFetch({ results: [{ id: "nope" }, item({ title: "" }), item({ id: 7, title: "Heat 2" })] });

    const { results, degraded } = await searchMovies("heat");

    expect(degraded).toBe(false);
    expect(results.map((r) => r.tmdbId)).toEqual([7]);
  });

  it("returns degraded with no fetch when TMDB_API_KEY is missing", async () => {
    delete process.env.TMDB_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(searchMovies("heat")).resolves.toEqual({ results: [], degraded: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns degraded on a non-OK status", async () => {
    stubFetch({}, false);
    await expect(searchMovies("heat")).resolves.toEqual({ results: [], degraded: true });
  });

  it("returns degraded when fetch throws (network error or 3s timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    await expect(searchMovies("heat")).resolves.toEqual({ results: [], degraded: true });
  });

  it("returns degraded on an unexpected body", async () => {
    stubFetch({ page: 1 });
    await expect(searchMovies("heat")).resolves.toEqual({ results: [], degraded: true });
  });
});

// ── Movie details (fact grounding) ──────────────────────────────────────────

describe("fetchMovieDetails", () => {
  const RAW = {
    id: 1003596,
    title: "Avengers: Doomsday",
    tagline: "  ",
    overview: "The Avengers face their greatest threat yet.",
    release_date: "2026-12-18",
    status: "Post Production",
    runtime: 0,
    genres: [{ id: 28, name: "Action" }, { id: 878, name: "Science Fiction" }],
    production_companies: [{ name: "Marvel Studios" }, { name: "Marvel Studios" }],
    credits: {
      cast: [
        { name: "Chris Hemsworth", character: "Thor", order: 1 },
        { name: "Robert Downey Jr.", character: "Victor von Doom", order: 0 },
        { name: "Anthony Mackie", character: "Sam Wilson", order: 2 },
        { name: "Letitia Wright", character: "Shuri", order: 3 },
        { name: "Paul Rudd", character: "", order: 4 },
        { name: "Sixth Person", character: "Extra", order: 5 },
      ],
      crew: [
        { name: "Anthony Russo", job: "Director" },
        { name: "Joe Russo", job: "Director" },
        { name: "Kevin Feige", job: "Producer" },
      ],
    },
    keywords: { keywords: [{ name: "superhero" }, { name: "sequel" }, { name: "superhero" }, { name: "based on comic" }] },
  };

  it("calls /movie/{id} with credits, the Bearer token and a timeout", async () => {
    stubFetch(RAW);

    await fetchMovieDetails(1003596);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/3/movie/1003596");
    expect(url.searchParams.get("append_to_response")).toBe("credits,keywords");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-bearer-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps to compact grounding data", async () => {
    stubFetch(RAW);

    await expect(fetchMovieDetails(1003596)).resolves.toEqual({
      title: "Avengers: Doomsday",
      tagline: null, // blank → null
      overview: "The Avengers face their greatest threat yet.",
      releaseDate: "2026-12-18",
      status: "Post Production",
      runtimeMinutes: null, // 0 = unknown for unreleased films
      genres: ["Action", "Science Fiction"],
      directors: ["Anthony Russo", "Joe Russo"],
      cast: [
        { name: "Robert Downey Jr.", character: "Victor von Doom" },
        { name: "Chris Hemsworth", character: "Thor" },
        { name: "Anthony Mackie", character: "Sam Wilson" },
        { name: "Letitia Wright", character: "Shuri" },
        { name: "Paul Rudd", character: null },
      ],
      productionCompanies: ["Marvel Studios"],
      keywords: ["superhero", "sequel", "based on comic"], // de-duplicated
    });
  });

  it("handles a film with no credits block", async () => {
    stubFetch({ id: 1, title: "Tiny Film" });
    await expect(fetchMovieDetails(1)).resolves.toMatchObject({
      title: "Tiny Film",
      directors: [],
      cast: [],
      genres: [],
      keywords: [],
    });
  });

  it("returns null without calling TMDB when the key is missing", async () => {
    delete process.env.TMDB_API_KEY;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(fetchMovieDetails(1)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-OK status", () => stubFetch({}, false)],
    ["an unexpected body", () => stubFetch({ status_message: "nope" })],
    ["a timeout", () => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("t", "TimeoutError")))],
  ])("returns null on %s", async (_label, setup) => {
    setup();
    await expect(fetchMovieDetails(1)).resolves.toBeNull();
  });
});

describe("createMovieDetailsLoader (24h cache)", () => {
  const DETAILS = { title: "Heat" } as unknown as MovieDetails;

  it("caches per tmdbId for 24 hours", async () => {
    let t = 0;
    const fetchDetails = vi.fn(async () => DETAILS);
    const load = createMovieDetailsLoader({ now: () => t, fetchDetails });

    await load(949);
    t = MOVIE_DETAILS_TTL_MS - 1;
    await load(949);
    expect(fetchDetails).toHaveBeenCalledTimes(1);

    t = MOVIE_DETAILS_TTL_MS + 1;
    await load(949);
    expect(fetchDetails).toHaveBeenCalledTimes(2);

    await load(11);
    expect(fetchDetails).toHaveBeenCalledTimes(3);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const fetchDetails = vi.fn(async () => DETAILS);
    const load = createMovieDetailsLoader({ fetchDetails });

    const results = await Promise.all(Array.from({ length: 10 }, () => load(949)));

    expect(fetchDetails).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === DETAILS)).toBe(true);
  });

  it("does not cache failures", async () => {
    const fetchDetails = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("x")).mockResolvedValue(DETAILS);
    const load = createMovieDetailsLoader({ fetchDetails });

    await expect(load(949)).resolves.toBeNull();
    await expect(load(949)).resolves.toBeNull();
    await expect(load(949)).resolves.toBe(DETAILS);
    await load(949);
    expect(fetchDetails).toHaveBeenCalledTimes(3);
  });

  it("evicts the oldest entry past maxEntries", async () => {
    const fetchDetails = vi.fn(async () => DETAILS);
    const load = createMovieDetailsLoader({ fetchDetails, maxEntries: 2 });

    await load(1);
    await load(2);
    await load(3); // evicts 1
    await load(2);
    await load(1);
    expect(fetchDetails.mock.calls.map((c) => (c as unknown[])[0])).toEqual([1, 2, 3, 1]);
  });
});

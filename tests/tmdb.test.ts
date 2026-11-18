import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTrendingPosters,
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
  delete process.env.TMDB_API_KEY;
});

describe("getTrendingPosters", () => {
  it("returns poster paths from a successful response", async () => {
    stubFetch({
      results: [
        { poster_path: "/abc123.jpg" },
        { poster_path: "/def456.jpg" },
        { poster_path: null },
        { poster_path: "/ghi789.jpg" },
      ],
    });

    const paths = await getTrendingPosters();

    expect(paths).toEqual(["/abc123.jpg", "/def456.jpg", "/ghi789.jpg"]);
  });

  it("returns empty array when response shape is unexpected", async () => {
    stubFetch({ page: 1, total_results: 0 }); // missing 'results' key

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
  });

  it("returns empty array when TMDB_API_KEY is not set", async () => {
    delete process.env.TMDB_API_KEY;

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false); // fetch never called
  });

  it("returns empty array on non-OK HTTP status", async () => {
    stubFetch({}, false); // ok: false, status: 500

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
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

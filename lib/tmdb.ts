import { z } from "zod";
import {
  MovieSearchResult,
  SEARCH_MAX_RESULTS,
  posterPathSchema,
  yearSchema,
  type MovieSearchResponse,
} from "./validation";

export { TMDB_IMAGE_BASE, posterUrl } from "./tmdb-image";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_TIMEOUT_MS = 3_000;

// ── Movie details (grounding data for facts) ──────────────────────────────────

/** What we pass to OpenAI as context. Plain data only. */
export type MovieDetails = {
  title: string;
  tagline: string | null;
  overview: string | null;
  releaseDate: string | null; // YYYY-MM-DD
  status: string | null; // "Released", "In Production", "Post Production", "Planned", …
  runtimeMinutes: number | null;
  genres: string[];
  directors: string[];
  cast: Array<{ name: string; character: string | null }>;
  productionCompanies: string[];
  keywords: string[]; // TMDB tags, e.g. "superhero", "based on comic", "sequel"
};

const MAX_CAST = 5;
const MAX_COMPANIES = 5;
const MAX_KEYWORDS = 10;
const MAX_OVERVIEW_CHARS = 1_000;

const nonEmpty = z
  .string()
  .nullish()
  .transform((s) => (s && s.trim() ? s.trim() : null));

const RawMovieDetails = z.object({
  id: z.number(),
  title: z.string().min(1),
  tagline: nonEmpty,
  overview: nonEmpty,
  release_date: nonEmpty,
  status: nonEmpty,
  runtime: z.number().nullish(), // 0 for unreleased films; mapped to null below
  genres: z.array(z.object({ name: z.string() })).nullish(),
  production_companies: z.array(z.object({ name: z.string() })).nullish(),
  credits: z
    .object({
      cast: z
        .array(z.object({ name: z.string(), character: nonEmpty, order: z.number().nullish() }))
        .nullish(),
      crew: z.array(z.object({ name: z.string(), job: z.string().nullish() })).nullish(),
    })
    .nullish(),
  keywords: z.object({ keywords: z.array(z.object({ name: z.string() })).nullish() }).nullish(),
});

/**
 * One TMDB `/movie/{id}?append_to_response=credits,keywords` call. Never throws:
 * a missing key, timeout (3s), HTTP error or unexpected body returns null.
 */
export async function fetchMovieDetails(tmdbId: number): Promise<MovieDetails | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;

  const url = new URL(`${TMDB_API_BASE}/movie/${tmdbId}`);
  url.search = new URLSearchParams({ append_to_response: "credits,keywords", language: "en-US" }).toString();

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[tmdb] Details failed: HTTP ${res.status}`);
      return null;
    }
    const parsed = RawMovieDetails.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[tmdb] Unexpected details response shape");
      return null;
    }
    return toMovieDetails(parsed.data);
  } catch (err) {
    console.warn("[tmdb] Details error:", err instanceof Error ? err.name : err);
    return null;
  }
}

function toMovieDetails(raw: z.infer<typeof RawMovieDetails>): MovieDetails {
  const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
  const cast = [...(raw.credits?.cast ?? [])]
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
    .slice(0, MAX_CAST)
    .map((c) => ({ name: c.name, character: c.character }));

  return {
    title: raw.title,
    tagline: raw.tagline,
    overview: raw.overview ? raw.overview.slice(0, MAX_OVERVIEW_CHARS) : null,
    releaseDate: raw.release_date,
    status: raw.status,
    runtimeMinutes: raw.runtime && raw.runtime > 0 ? Math.round(raw.runtime) : null,
    genres: unique((raw.genres ?? []).map((g) => g.name)),
    directors: unique((raw.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name)),
    cast,
    productionCompanies: unique((raw.production_companies ?? []).map((p) => p.name)).slice(0, MAX_COMPANIES),
    keywords: unique((raw.keywords?.keywords ?? []).map((k) => k.name)).slice(0, MAX_KEYWORDS),
  };
}

export const MOVIE_DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
const MOVIE_DETAILS_MAX_ENTRIES = 1_000;

export type MovieDetailsLoader = (tmdbId: number) => Promise<MovieDetails | null>;

/**
 * In-memory, per-process cache of movie details for 24h per tmdbId.
 * Concurrent callers share one in-flight request. Failures (null) are not
 * cached, so the next request tries again.
 */
export function createMovieDetailsLoader(opts: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  fetchDetails?: (tmdbId: number) => Promise<MovieDetails | null>;
} = {}): MovieDetailsLoader {
  const ttlMs = opts.ttlMs ?? MOVIE_DETAILS_TTL_MS;
  const maxEntries = opts.maxEntries ?? MOVIE_DETAILS_MAX_ENTRIES;
  const now = opts.now ?? Date.now;
  const fetchDetails = opts.fetchDetails ?? fetchMovieDetails;
  type Entry = { value: Promise<MovieDetails | null>; expiresAt: number };
  const cache = new Map<number, Entry>();

  return (tmdbId) => {
    const hit = cache.get(tmdbId);
    if (hit && hit.expiresAt > now()) return hit.value;

    const value = fetchDetails(tmdbId).catch(() => null);
    const entry: Entry = { value, expiresAt: now() + ttlMs };
    // Don't keep failures: drop this entry (if it's still the current one) once it resolves to null.
    void value.then((details) => {
      if (!details && cache.get(tmdbId) === entry) cache.delete(tmdbId);
    });

    cache.delete(tmdbId); // re-insert so Map order tracks insertion time for eviction
    cache.set(tmdbId, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
    return entry.value;
  };
}

export const getMovieDetails: MovieDetailsLoader = createMovieDetailsLoader();

// ── Movie search (server-only: uses the Bearer token) ─────────────────────────

const SearchResponse = z.object({ results: z.array(z.unknown()) });

const RawSearchItem = z.object({
  id: z.number(),
  title: z.string(),
  release_date: z.string().nullish(),
  poster_path: z.string().nullish(),
});

const DEGRADED: MovieSearchResponse = { results: [], degraded: true };

/**
 * Up to 6 TMDB matches for `query`. Never throws: a missing key, timeout, HTTP
 * error or unexpected body returns `{ results: [], degraded: true }`.
 * Individual malformed results are dropped rather than failing the whole list.
 */
export async function searchMovies(query: string): Promise<MovieSearchResponse> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return DEGRADED;

  const url = new URL(`${TMDB_API_BASE}/search/movie`);
  url.search = new URLSearchParams({
    query,
    include_adult: "false",
    language: "en-US",
    page: "1",
  }).toString();

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[tmdb] Search failed: HTTP ${res.status}`);
      return DEGRADED;
    }

    const parsed = SearchResponse.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("[tmdb] Unexpected search response shape");
      return DEGRADED;
    }

    const results: MovieSearchResult[] = [];
    for (const item of parsed.data.results) {
      const result = toSearchResult(item);
      if (result) results.push(result);
      if (results.length === SEARCH_MAX_RESULTS) break;
    }
    return { results, degraded: false };
  } catch (err) {
    console.warn("[tmdb] Search error:", err instanceof Error ? err.name : err);
    return DEGRADED;
  }
}

function toSearchResult(item: unknown): MovieSearchResult | null {
  const raw = RawSearchItem.safeParse(item);
  if (!raw.success) return null;

  // An odd poster path or year shouldn't hide the movie; drop just that field.
  const year = yearSchema.safeParse(Number.parseInt(raw.data.release_date?.slice(0, 4) ?? "", 10));
  const poster = posterPathSchema.safeParse(raw.data.poster_path);

  const result = MovieSearchResult.safeParse({
    tmdbId: raw.data.id,
    title: raw.data.title,
    year: year.success ? year.data : null,
    posterPath: poster.success ? poster.data : null,
  });
  return result.success ? result.data : null;
}

// ── Poster pool (landing + onboarding wall) ─────────────────────────────────
//
// The pages call auth(), so they render per request; the TMDB data behind the wall is
// cached here instead, in memory, shared by every visitor of this server process.

/** TMDB lists the wall draws from: about 80 posters before de-duplication. */
export const POSTER_LISTS = ["trending/movie/day", "movie/popular", "movie/top_rated", "movie/now_playing"] as const;
export type PosterList = (typeof POSTER_LISTS)[number];

export const POSTER_POOL_TTL_MS = 60 * 60 * 1000; // a full pool is reused for 1 hour
export const POSTER_POOL_PARTIAL_TTL_MS = 5 * 60 * 1000; // some lists failed: try again sooner
export const POSTER_POOL_RETRY_MS = 60 * 1000; // every list failed: don't retry for 1 minute
export const POSTER_POOL_MAX = 80;

const PosterListResponse = z.object({
  results: z.array(z.object({ poster_path: z.string().nullable().optional() })),
});

/**
 * One TMDB list's poster paths. `null` means the list FAILED (no key, HTTP error, timeout,
 * odd body); `[]` means it succeeded with nothing usable. Posters without an image, or with
 * a path that isn't a plain TMDB image path, are skipped.
 */
export async function fetchPosterList(list: PosterList): Promise<string[] | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;

  try {
    const res = await fetch(`${TMDB_API_BASE}/${list}?language=en-US&page=1`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TMDB_TIMEOUT_MS),
      cache: "no-store", // cached by the pool loader below, not by Next's fetch cache
    });
    if (!res.ok) {
      console.warn(`[tmdb] Poster list ${list} failed: HTTP ${res.status}`);
      return null;
    }
    const parsed = PosterListResponse.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(`[tmdb] Unexpected response shape for ${list}`);
      return null;
    }
    return parsed.data.results
      .map((r) => r.poster_path)
      .filter((p): p is string => posterPathSchema.safeParse(p).success);
  } catch (err) {
    console.warn(`[tmdb] Error fetching poster list ${list}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Merges the lists round-robin (so no single list dominates the start of the pool),
 * drops duplicates (a film is often both popular and trending), and caps the size.
 */
export function mergePosterLists(lists: string[][], max = POSTER_POOL_MAX): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest && pool.length < max; i++) {
    for (const list of lists) {
      const p = list[i];
      if (p === undefined || seen.has(p)) continue;
      seen.add(p);
      pool.push(p);
      if (pool.length >= max) break;
    }
  }
  return pool;
}

export type PosterPoolLoader = () => Promise<string[]>;

/**
 * In-memory poster pool, per server process:
 * - Fresh pool (1 hour, or 5 minutes if some lists failed) → returned with no TMDB call.
 * - Concurrent callers while refreshing share ONE refresh (one request per list).
 * - Every list failed → NOT cached as success: the last good pool is served (stale on
 *   error) if there is one, otherwise [] (the pages' existing no-poster fallback), and
 *   TMDB isn't retried for a minute.
 */
export function createPosterPoolLoader(opts: {
  lists?: readonly PosterList[];
  fetchList?: (list: PosterList) => Promise<string[] | null>;
  now?: () => number;
  ttlMs?: number;
  partialTtlMs?: number;
  retryMs?: number;
} = {}): PosterPoolLoader {
  const lists = opts.lists ?? POSTER_LISTS;
  const fetchList = opts.fetchList ?? fetchPosterList;
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? POSTER_POOL_TTL_MS;
  const partialTtlMs = opts.partialTtlMs ?? POSTER_POOL_PARTIAL_TTL_MS;
  const retryMs = opts.retryMs ?? POSTER_POOL_RETRY_MS;

  let good: { posters: string[]; expiresAt: number } | null = null;
  let retryAfter = 0;
  let inFlight: Promise<string[]> | null = null;

  async function refresh(): Promise<string[]> {
    const results = await Promise.all(lists.map((l) => fetchList(l).catch(() => null)));
    const succeeded = results.filter((r): r is string[] => r !== null);
    const pool = mergePosterLists(succeeded);

    if (pool.length === 0) {
      // Total failure (or nothing usable): never cached as success.
      retryAfter = now() + retryMs;
      console.warn(`[tmdb] Poster pool refresh failed; serving ${good ? "the last good pool" : "no posters"}`);
      return good?.posters ?? [];
    }

    const partial = succeeded.length < lists.length;
    // A partial refresh doesn't replace a bigger pool we already have; either way, retry soon.
    const posters = partial && good && good.posters.length > pool.length ? good.posters : pool;
    good = { posters, expiresAt: now() + (partial ? partialTtlMs : ttlMs) };
    return posters;
  }

  return async function loadPosterPool() {
    const t = now();
    if (good && t < good.expiresAt) return good.posters;
    if (t < retryAfter) return good?.posters ?? [];
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

const defaultPosterPool = createPosterPoolLoader();

/** The shared poster pool for the landing and onboarding walls. [] when TMDB isn't configured. */
export async function getPosterPool(): Promise<string[]> {
  if (!process.env.TMDB_API_KEY) {
    console.warn("[tmdb] TMDB_API_KEY not set; skipping poster fetch");
    return [];
  }
  return defaultPosterPool();
}

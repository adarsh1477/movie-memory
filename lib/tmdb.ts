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

const TrendingResponse = z.object({
  results: z.array(z.object({ poster_path: z.string().nullable() })),
});

export async function getTrendingPosters(): Promise<string[]> {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    console.warn("[tmdb] TMDB_API_KEY not set — skipping poster fetch");
    return [];
  }

  try {
    const res = await fetch(
      "https://api.themoviedb.org/3/trending/movie/day?language=en-US",
      {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(3000),
        next: { revalidate: 86400 },
      },
    );

    if (!res.ok) {
      console.warn(`[tmdb] Trending fetch failed: HTTP ${res.status}`);
      return [];
    }

    const json = await res.json();
    const parsed = TrendingResponse.safeParse(json);

    if (!parsed.success) {
      console.warn("[tmdb] Unexpected response shape:", parsed.error.message);
      return [];
    }

    return parsed.data.results
      .map((r) => r.poster_path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
  } catch (err) {
    console.warn("[tmdb] Error fetching trending posters:", err);
    return [];
  }
}

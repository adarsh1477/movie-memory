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

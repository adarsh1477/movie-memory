import { z } from "zod";

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export function posterUrl(
  path: string,
  size: "w342" | "w500" | "original" = "w342",
): string {
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
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

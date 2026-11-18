// Client-safe: no API key, no fetch. Server-side TMDB calls live in lib/tmdb.ts.

export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export function posterUrl(
  path: string,
  size: "w92" | "w342" | "w500" | "original" = "w342",
): string {
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

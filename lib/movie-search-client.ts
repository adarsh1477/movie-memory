import { z } from "zod";
import { MovieSearchResponse } from "./validation";

export type MovieSearchFn = (query: string, signal: AbortSignal) => Promise<MovieSearchResponse>;

const OkEnvelope = z.object({ ok: z.literal(true), data: MovieSearchResponse });

/** Browser call to GET /api/movies/search. Throws on non-2xx or a malformed body. */
export const fetchMovieSearch: MovieSearchFn = async (query, signal) => {
  const res = await fetch(`/api/movies/search?q=${encodeURIComponent(query)}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body = OkEnvelope.safeParse(await res.json().catch(() => null));
  if (!res.ok || !body.success) throw new Error(`Movie search failed (HTTP ${res.status})`);
  return body.data.data;
};

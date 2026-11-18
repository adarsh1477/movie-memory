import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { logger } from "@/lib/logger";
import { movieSearchRateLimiter } from "@/lib/rate-limit";
import { searchMovies } from "@/lib/tmdb";
import { MovieSearchResponse, movieSearchQuerySchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return jsonError({ code: "UNAUTHORIZED", message: "Sign in required" });

  const query = movieSearchQuerySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!query.success) {
    return jsonError({ code: "VALIDATION", message: query.error.errors[0].message });
  }

  const limit = movieSearchRateLimiter.consume(userId);
  if (!limit.ok) {
    logger.info({ event: "movie_search.rate_limited", userId, retryAfterMs: limit.retryAfterMs });
    return jsonError({ code: "RATE_LIMITED", message: "Too many searches", retryAfterMs: limit.retryAfterMs });
  }

  const started = Date.now();
  const result = MovieSearchResponse.parse(await searchMovies(query.data));
  logger.info({
    event: "movie_search",
    userId,
    results: result.results.length,
    degraded: result.degraded,
    durationMs: Date.now() - started,
  });
  return jsonOk(result);
}

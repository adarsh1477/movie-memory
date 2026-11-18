import type { NextRequest } from "next/server";
import { AppErrorException } from "@/lib/errors";
import { handle, jsonOk, requireUserId } from "@/lib/http";
import { logger } from "@/lib/logger";
import { movieSearchRateLimiter } from "@/lib/rate-limit";
import { searchMovies } from "@/lib/tmdb";
import { MovieSearchResponse, movieSearchQuerySchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  return handle("GET /api/movies/search", async () => {
    const userId = await requireUserId();

    const query = movieSearchQuerySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
    if (!query.success) {
      throw new AppErrorException({ code: "VALIDATION", message: query.error.errors[0].message });
    }

    const limit = movieSearchRateLimiter.consume(userId);
    if (!limit.ok) {
      logger.info({ event: "movie_search.rate_limited", userId, retryAfterMs: limit.retryAfterMs });
      throw new AppErrorException({
        code: "RATE_LIMITED",
        message: "Too many searches",
        retryAfterMs: limit.retryAfterMs,
      });
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
  });
}

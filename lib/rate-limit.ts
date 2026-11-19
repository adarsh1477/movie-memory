// In-process sliding window. Per-instance only: swap for Redis (e.g. Upstash)
// when running more than one server. The DB advisory lock still bounds
// OpenAI cost across instances; this limiter only caps request volume.

export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export interface RateLimiter {
  consume(key: string, now?: number): RateLimitResult;
  reset(): void;
}

export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    consume(key, now = Date.now()) {
      const windowStart = now - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (recent.length >= opts.limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: recent[0] + opts.windowMs - now };
      }

      recent.push(now);
      hits.set(key, recent);
      return { ok: true };
    },
    reset() {
      hits.clear();
    },
  };
}

export const FACT_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

export const factRateLimiter = createRateLimiter(FACT_RATE_LIMIT);

// Same per-user policy, separate bucket: typing in the search box must not
// use up the user's fact budget (and vice versa).
export const movieSearchRateLimiter = createRateLimiter(FACT_RATE_LIMIT);

// Movie saves (PUT /api/me/movie): writes plus a possible TMDB search each, so a
// tighter budget, again in its own bucket.
export const MOVIE_EDIT_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;
export const movieEditRateLimiter = createRateLimiter(MOVIE_EDIT_RATE_LIMIT);

export function consume(userId: string, now?: number): RateLimitResult {
  return factRateLimiter.consume(userId, now);
}

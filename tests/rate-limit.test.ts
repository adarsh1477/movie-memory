// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

const WINDOW = 60_000;

function fill(limiter: ReturnType<typeof createRateLimiter>, key: string, count: number, at: number) {
  for (let i = 0; i < count; i++) {
    expect(limiter.consume(key, at)).toEqual({ ok: true });
  }
}

describe("rate limiter (30 req / 60s)", () => {
  it("allows exactly 30 requests in the window", () => {
    const limiter = createRateLimiter({ limit: 30, windowMs: WINDOW });
    fill(limiter, "u1", 30, 1_000);
  });

  it("blocks the 31st request with retryAfterMs", () => {
    const limiter = createRateLimiter({ limit: 30, windowMs: WINDOW });
    fill(limiter, "u1", 30, 1_000);

    const result = limiter.consume("u1", 11_000);
    expect(result).toEqual({ ok: false, retryAfterMs: 50_000 });
  });

  it("allows again once the window has moved past the old requests", () => {
    const limiter = createRateLimiter({ limit: 30, windowMs: WINDOW });
    fill(limiter, "u1", 30, 1_000);
    expect(limiter.consume("u1", 60_999).ok).toBe(false);

    expect(limiter.consume("u1", 61_001)).toEqual({ ok: true });
  });

  it("slides: only requests older than the window expire", () => {
    const limiter = createRateLimiter({ limit: 30, windowMs: WINDOW });
    fill(limiter, "u1", 10, 0);
    fill(limiter, "u1", 20, 30_000);

    // At 60_001 the first 10 have expired; the 20 from t=30s still count.
    fill(limiter, "u1", 10, 60_001);
    const blocked = limiter.consume("u1", 60_002);
    expect(blocked).toEqual({ ok: false, retryAfterMs: 29_998 });
  });

  it("tracks each user separately", () => {
    const limiter = createRateLimiter({ limit: 30, windowMs: WINDOW });
    fill(limiter, "a", 30, 1_000);
    expect(limiter.consume("a", 1_000).ok).toBe(false);
    expect(limiter.consume("b", 1_000)).toEqual({ ok: true });
  });

  it("blocked requests do not extend the wait", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW });
    limiter.consume("u1", 0);
    limiter.consume("u1", 0);
    for (let t = 1; t < 50; t++) limiter.consume("u1", t * 1_000);
    expect(limiter.consume("u1", 60_001)).toEqual({ ok: true });
  });
});

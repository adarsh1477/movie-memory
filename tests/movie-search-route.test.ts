// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.fn();
const searchMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/tmdb", () => ({ searchMovies: (q: string) => searchMock(q) }));

const { GET } = await import("@/app/api/movies/search/route");
const { movieSearchRateLimiter } = await import("@/lib/rate-limit");

const HEAT = { tmdbId: 949, title: "Heat", year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" };

function call(q?: string) {
  const url = new URL("http://localhost/api/movies/search");
  if (q !== undefined) url.searchParams.set("q", q);
  return GET(new NextRequest(url));
}

beforeEach(() => {
  movieSearchRateLimiter.reset();
  authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  searchMock.mockReset().mockResolvedValue({ results: [HEAT], degraded: false });
});

describe("GET /api/movies/search", () => {
  it("returns results with Cache-Control: no-store", async () => {
    const res = await call("heat");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { results: [HEAT], degraded: false } });
  });

  it("requires a session", async () => {
    authMock.mockResolvedValue(null);

    const res = await call("heat");

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("trims the query before searching", async () => {
    await call("   heat  ");
    expect(searchMock).toHaveBeenCalledWith("heat");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["one character", "a"],
    ["whitespace only", "     "],
    ["one char after trim", "  a  "],
    ["over 100 characters", "x".repeat(101)],
  ])("rejects a %s query with 400 VALIDATION", async (_label, q) => {
    const res = await call(q);

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error.code).toBe("VALIDATION");
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("accepts exactly 2 and exactly 100 characters", async () => {
    expect((await call("ab")).status).toBe(200);
    expect((await call("x".repeat(100))).status).toBe(200);
  });

  it("passes through a degraded TMDB response as 200 with an empty list", async () => {
    searchMock.mockResolvedValue({ results: [], degraded: true });

    const res = await call("heat");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { results: [], degraded: true } });
  });

  it("rate limits per user at 30 requests per minute", async () => {
    for (let i = 0; i < 30; i++) expect((await call("heat")).status).toBe(200);

    const blocked = await call("heat");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked.json()).error).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: expect.any(Number) });

    authMock.mockResolvedValue({ user: { id: "user-2" } });
    expect((await call("heat")).status).toBe(200);
  });

  it("does not count invalid queries against the limit", async () => {
    for (let i = 0; i < 40; i++) await call("a");
    expect((await call("heat")).status).toBe(200);
  });
});

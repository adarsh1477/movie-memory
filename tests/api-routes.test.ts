// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppErrorException } from "@/lib/errors";

const authMock = vi.fn();
const findUnique = vi.fn();
const saveMovieMock = vi.fn();
const getFactMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: (a: unknown) => findUnique(a) } } }));
vi.mock("@/lib/movie-service", () => ({
  saveMovieForUser: (...args: unknown[]) => saveMovieMock(...args),
}));
vi.mock("@/lib/fact-service", () => ({ getFactForUser: (...args: unknown[]) => getFactMock(...args) }));

const meRoute = await import("@/app/api/me/route");
const movieRoute = await import("@/app/api/me/movie/route");
const factRoute = await import("@/app/api/fact/route");
const { movieEditRateLimiter, movieSearchRateLimiter, factRateLimiter, MOVIE_EDIT_RATE_LIMIT } = await import(
  "@/lib/rate-limit"
);

const UPDATED = new Date("2026-11-18T12:00:00Z");
const DB_USER = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  movie: { title: "Heat", tmdbId: 949, year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg", updatedAt: UPDATED },
};
const ME = {
  user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
  movie: { ...DB_USER.movie, updatedAt: UPDATED.toISOString() },
};

const put = (body: unknown, raw = false) =>
  movieRoute.PUT(
    new Request("http://localhost/api/me/movie", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
  );

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error.code).toBe(code);
  return body.error;
}

beforeEach(() => {
  movieEditRateLimiter.reset();
  movieSearchRateLimiter.reset();
  factRateLimiter.reset();
  authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  findUnique.mockReset().mockResolvedValue(DB_USER);
  saveMovieMock.mockReset().mockResolvedValue({});
  getFactMock.mockReset();
});

// ── GET /api/me ───────────────────────────────────────────────────────────────

describe("GET /api/me", () => {
  it("returns the session user's profile and movie", async () => {
    const res = await meRoute.GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: ME });
    expect(findUnique.mock.calls[0][0]).toMatchObject({ where: { id: "user-1" } });
  });

  it("returns movie: null before onboarding", async () => {
    findUnique.mockResolvedValue({ ...DB_USER, movie: null });
    const body = await (await meRoute.GET()).json();
    expect(body.data.movie).toBeNull();
  });

  it("401 without a session", async () => {
    authMock.mockResolvedValue(null);
    await expectError(await meRoute.GET(), 401, "UNAUTHORIZED");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("401 when the session's user row no longer exists", async () => {
    findUnique.mockResolvedValue(null);
    await expectError(await meRoute.GET(), 401, "UNAUTHORIZED");
  });

  it("500 INTERNAL without leaking the underlying error", async () => {
    findUnique.mockRejectedValue(new Error("connection to 10.0.0.5 refused"));
    const error = await expectError(await meRoute.GET(), 500, "INTERNAL");
    expect(JSON.stringify(error)).not.toContain("10.0.0.5");
  });
});

// ── PUT /api/me/movie ─────────────────────────────────────────────────────────

describe("PUT /api/me/movie", () => {
  it("saves a selection for the session user and returns MeResponse", async () => {
    const res = await put({ title: " Heat ", tmdbId: 949, year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: ME });
    expect(saveMovieMock).toHaveBeenCalledWith("user-1", {
      title: "Heat",
      tmdbId: 949,
      year: 1995,
      posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg",
    });
  });

  it("accepts free text with nulls for the TMDB fields", async () => {
    await put({ title: "My Indie Film", tmdbId: null, year: null, posterPath: null });
    expect(saveMovieMock).toHaveBeenCalledWith("user-1", {
      title: "My Indie Film",
      tmdbId: undefined,
      year: undefined,
      posterPath: undefined,
    });
  });

  it("ignores a client-supplied userId", async () => {
    await put({ title: "Heat", tmdbId: 949, userId: "someone-else" });
    expect(saveMovieMock.mock.calls[0][0]).toBe("user-1");
    expect(saveMovieMock.mock.calls[0][1]).not.toHaveProperty("userId");
  });

  it("401 without a session", async () => {
    authMock.mockResolvedValue(null);
    await expectError(await put({ title: "Heat" }), 401, "UNAUTHORIZED");
    expect(saveMovieMock).not.toHaveBeenCalled();
  });

  it("400 on a non-JSON body", async () => {
    await expectError(await put("title=Heat", true), 400, "VALIDATION");
    expect(saveMovieMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty title", { title: "   " }, "title"],
    ["missing title", {}, "title"],
    ["title over 120 chars", { title: "x".repeat(121) }, "title"],
    ["forged poster path", { title: "Heat", tmdbId: 949, posterPath: "https://evil.example/x.jpg" }, "posterPath"],
    ["string tmdbId", { title: "Heat", tmdbId: "949" }, "tmdbId"],
  ])("400 VALIDATION with fieldErrors for %s", async (_label, body, field) => {
    const error = await expectError(await put(body), 400, "VALIDATION");
    expect(error.fieldErrors).toHaveProperty(field);
    expect(saveMovieMock).not.toHaveBeenCalled();
  });

  describe("rate limit (20 per minute per user, own counter)", () => {
    it("allows 20 saves, then 429 RATE_LIMITED with Retry-After", async () => {
      expect(MOVIE_EDIT_RATE_LIMIT).toEqual({ limit: 20, windowMs: 60_000 });
      for (let i = 0; i < 20; i++) expect((await put({ title: "Heat", tmdbId: 949 })).status).toBe(200);

      const res = await put({ title: "Heat", tmdbId: 949 });
      const error = await expectError(res, 429, "RATE_LIMITED");
      expect(error.retryAfterMs).toBeGreaterThan(0);
      expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(saveMovieMock).toHaveBeenCalledTimes(20);
    });

    it("counts invalid requests too, so junk can't be sent in bulk", async () => {
      for (let i = 0; i < 20; i++) await put("not json", true);
      await expectError(await put({ title: "Heat", tmdbId: 949 }), 429, "RATE_LIMITED");
      expect(saveMovieMock).not.toHaveBeenCalled();
    });

    it("is per user", async () => {
      for (let i = 0; i < 20; i++) await put({ title: "Heat", tmdbId: 949 });
      authMock.mockResolvedValue({ user: { id: "user-2" } });
      expect((await put({ title: "Heat", tmdbId: 949 })).status).toBe(200);
    });

    it("doesn't use up the search or fact budgets", async () => {
      for (let i = 0; i < 21; i++) await put({ title: "Heat", tmdbId: 949 });
      expect(movieSearchRateLimiter.consume("user-1").ok).toBe(true);
      expect(factRateLimiter.consume("user-1").ok).toBe(true);
    });

    it("doesn't count unauthenticated requests against anyone", async () => {
      authMock.mockResolvedValue(null);
      for (let i = 0; i < 25; i++) await put({ title: "Heat" });
      authMock.mockResolvedValue({ user: { id: "user-1" } });
      expect((await put({ title: "Heat", tmdbId: 949 })).status).toBe(200);
    });
  });

  it("passes through the service's 'pick from suggestions' error", async () => {
    saveMovieMock.mockRejectedValue(
      new AppErrorException({ code: "VALIDATION", message: "Pick your movie", fieldErrors: { title: "Pick your movie" } }),
    );
    const error = await expectError(await put({ title: "Heat" }), 400, "VALIDATION");
    expect(error.fieldErrors).toEqual({ title: "Pick your movie" });
  });
});

// ── GET /api/fact ─────────────────────────────────────────────────────────────

describe("GET /api/fact", () => {
  const FACT = {
    id: "f1",
    userId: "user-1",
    movieTitle: "Heat",
    content: "The diner scene was shot in one afternoon.",
    createdAt: new Date("2026-11-18T12:00:00Z"),
  };

  it("returns the fact for the session user", async () => {
    getFactMock.mockResolvedValue({ fact: FACT, stale: false });

    const res = await factRoute.GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        content: FACT.content,
        movieTitle: "Heat",
        generatedAt: "2026-11-18T12:00:00.000Z",
        serverNow: expect.any(String),
        stale: false,
      },
    });
    expect(getFactMock).toHaveBeenCalledWith("user-1");
  });

  it("includes serverNow (the server's clock at response time) for client clock correction", async () => {
    getFactMock.mockResolvedValue({ fact: FACT, stale: false });

    const before = Date.now();
    const body = await (await factRoute.GET()).json();
    const after = Date.now();

    const serverNow = Date.parse(body.data.serverNow);
    expect(body.data.serverNow).toBe(new Date(serverNow).toISOString());
    expect(serverNow).toBeGreaterThanOrEqual(before);
    expect(serverNow).toBeLessThanOrEqual(after);
  });

  it("passes stale: true through", async () => {
    getFactMock.mockResolvedValue({ fact: FACT, stale: true });
    expect((await (await factRoute.GET()).json()).data.stale).toBe(true);
  });

  it("takes no query params, so ?force cannot bypass the server cache", async () => {
    expect(factRoute.GET.length).toBe(0);
  });

  it("401 without a session", async () => {
    authMock.mockResolvedValue(null);
    await expectError(await factRoute.GET(), 401, "UNAUTHORIZED");
    expect(getFactMock).not.toHaveBeenCalled();
  });

  it("400 NO_MOVIE", async () => {
    getFactMock.mockRejectedValue(new AppErrorException({ code: "NO_MOVIE", message: "Pick a favorite movie first" }));
    await expectError(await factRoute.GET(), 400, "NO_MOVIE");
  });

  it("429 RATE_LIMITED with Retry-After", async () => {
    getFactMock.mockRejectedValue(
      new AppErrorException({ code: "RATE_LIMITED", message: "Too many requests", retryAfterMs: 12_300 }),
    );
    const res = await factRoute.GET();
    const error = await expectError(res, 429, "RATE_LIMITED");
    expect(error.retryAfterMs).toBe(12_300);
    expect(res.headers.get("Retry-After")).toBe("13");
  });

  it("502 UPSTREAM_FAILED", async () => {
    getFactMock.mockRejectedValue(new AppErrorException({ code: "UPSTREAM_FAILED", message: "Couldn't fetch a fact" }));
    await expectError(await factRoute.GET(), 502, "UPSTREAM_FAILED");
  });

  it("500 INTERNAL for unexpected errors, without the message", async () => {
    getFactMock.mockRejectedValue(new Error("tx timeout: secret details"));
    const error = await expectError(await factRoute.GET(), 500, "INTERNAL");
    expect(error.message).not.toContain("secret");
  });
});

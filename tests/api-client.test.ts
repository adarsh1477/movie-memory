// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { getFact, getMe, putMovie, searchMovies, NETWORK_ERROR_MESSAGE } from "@/lib/api";
import { AppErrorException } from "@/lib/errors";

const FACT = {
  content: "A fact.",
  movieTitle: "Heat",
  generatedAt: "2026-11-18T12:00:00.000Z",
  serverNow: "2026-11-18T12:00:05.000Z",
  stale: false,
};

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { status, headers })));
}

async function appError(p: Promise<unknown>) {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(AppErrorException);
  return (err as AppErrorException).error;
}

afterEach(() => vi.unstubAllGlobals());

describe("lib/api", () => {
  it("returns parsed data on success", async () => {
    respond(200, { ok: true, data: FACT });
    await expect(getFact()).resolves.toEqual(FACT);
  });

  it("sends no-store, Accept JSON, and the abort signal", async () => {
    respond(200, { ok: true, data: FACT });
    const controller = new AbortController();
    await getFact(controller.signal);

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/fact");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
    expect(init.signal).toBe(controller.signal);
  });

  it("PUTs JSON for putMovie", async () => {
    respond(200, { ok: true, data: { user: { id: "u", name: null, email: "e@x.io", image: null }, movie: null } });
    await putMovie({ title: "Heat", tmdbId: 949 });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/movie");
    expect(init.method).toBe("PUT");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Heat", tmdbId: 949 });
  });

  it("encodes the search query", async () => {
    respond(200, { ok: true, data: { results: [], degraded: false } });
    await searchMovies("heat & dust", new AbortController().signal);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/movies/search?q=heat%20%26%20dust");
  });

  // ── Error normalization ────────────────────────────────────────────────────

  it("401 → UNAUTHORIZED (with the server's envelope)", async () => {
    respond(401, { ok: false, error: { code: "UNAUTHORIZED", message: "Sign in required" } });
    expect(await appError(getMe())).toEqual({ code: "UNAUTHORIZED", message: "Sign in required" });
  });

  it("401 → UNAUTHORIZED even with an empty body", async () => {
    respond(401, "");
    expect((await appError(getMe())).code).toBe("UNAUTHORIZED");
  });

  it("500 with an envelope → INTERNAL with the server's safe message", async () => {
    respond(500, { ok: false, error: { code: "INTERNAL", message: "Something went wrong. Please try again." } });
    expect(await appError(getFact())).toEqual({ code: "INTERNAL", message: "Something went wrong. Please try again." });
  });

  it("500 with an HTML body → INTERNAL", async () => {
    respond(500, "<html>Internal Server Error</html>");
    expect((await appError(getFact())).code).toBe("INTERNAL");
  });

  it("200 with a malformed body → INTERNAL", async () => {
    respond(200, { ok: true, data: { content: 42 } });
    expect((await appError(getFact())).code).toBe("INTERNAL");
  });

  it("200 that isn't an envelope → INTERNAL", async () => {
    respond(200, FACT);
    expect((await appError(getFact())).code).toBe("INTERNAL");
  });

  it("429 → RATE_LIMITED with retryAfterMs from the body", async () => {
    respond(429, { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests", retryAfterMs: 12_300 } });
    expect(await appError(getFact())).toEqual({ code: "RATE_LIMITED", message: "Too many requests", retryAfterMs: 12_300 });
  });

  it("429 without a body → RATE_LIMITED using Retry-After", async () => {
    respond(429, "", { "Retry-After": "7" });
    expect(await appError(getFact())).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 7_000 });
  });

  it.each([
    [400, "NO_MOVIE"],
    [502, "UPSTREAM_FAILED"],
  ])("%i %s keeps its code and message", async (status, code) => {
    respond(status, { ok: false, error: { code, message: "msg" } });
    expect(await appError(getFact())).toEqual({ code, message: "msg" });
  });

  it("400 VALIDATION keeps fieldErrors", async () => {
    respond(400, { ok: false, error: { code: "VALIDATION", message: "Bad", fieldErrors: { title: "Required" } } });
    expect(await appError(putMovie({ title: "" }))).toEqual({
      code: "VALIDATION",
      message: "Bad",
      fieldErrors: { title: "Required" },
    });
  });

  it("network failure → INTERNAL with a friendly message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    expect(await appError(getFact())).toEqual({ code: "INTERNAL", message: NETWORK_ERROR_MESSAGE });
  });

  it("rethrows aborts untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    const err = await getFact().catch((e) => e);
    expect(err).not.toBeInstanceOf(AppErrorException);
    expect((err as Error).name).toBe("AbortError");
  });
});

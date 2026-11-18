import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTrendingPosters } from "@/lib/tmdb";

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }),
  );
}

beforeEach(() => {
  process.env.TMDB_API_KEY = "test-bearer-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TMDB_API_KEY;
});

describe("getTrendingPosters", () => {
  it("returns poster paths from a successful response", async () => {
    stubFetch({
      results: [
        { poster_path: "/abc123.jpg" },
        { poster_path: "/def456.jpg" },
        { poster_path: null },
        { poster_path: "/ghi789.jpg" },
      ],
    });

    const paths = await getTrendingPosters();

    expect(paths).toEqual(["/abc123.jpg", "/def456.jpg", "/ghi789.jpg"]);
  });

  it("returns empty array when response shape is unexpected", async () => {
    stubFetch({ page: 1, total_results: 0 }); // missing 'results' key

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
  });

  it("returns empty array when TMDB_API_KEY is not set", async () => {
    delete process.env.TMDB_API_KEY;

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false); // fetch never called
  });

  it("returns empty array on non-OK HTTP status", async () => {
    stubFetch({}, false); // ok: false, status: 500

    const paths = await getTrendingPosters();

    expect(paths).toEqual([]);
  });
});

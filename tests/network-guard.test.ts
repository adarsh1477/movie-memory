// @vitest-environment node
// The guard in vitest.setup.ts: tests can never call OpenAI or TMDB for real.
import { describe, it, expect, vi } from "vitest";
import { generateFact } from "@/lib/openai";
import { searchMovies } from "@/lib/tmdb";
import { OpenAiError } from "@/lib/errors";

function causes(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  while (e instanceof Error) {
    parts.push(e.message);
    e = e.cause;
  }
  return parts.join(" <- ");
}

describe("test network guard", () => {
  it.each([
    "https://api.openai.com/v1/chat/completions",
    "https://api.themoviedb.org/3/search/movie?query=heat",
    "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=dune",
  ])(
    "blocks a direct fetch to %s",
    async (url) => {
      await expect(fetch(url)).rejects.toThrow(/Blocked real network call/);
    },
  );

  it("blocks the real OpenAI client when a test forgets to mock it", async () => {
    // No client injected: generateFact uses the real SDK client, whose fetch hits the guard.
    const err = await generateFact({ title: "Heat", year: 1995 }, [], AbortSignal.timeout(8_000)).catch((e) => e);
    expect(err).toBeInstanceOf(OpenAiError);
    expect(causes(err)).toMatch(/Blocked real network call to api\.openai\.com/);
  });

  it("blocks the real Wikipedia lookup when a test forgets to mock it (a transient failure, never a throw)", async () => {
    const { fetchWikipediaNotes } = await import("@/lib/wikipedia");
    await expect(fetchWikipediaNotes({ title: "Dune: Part Two", year: 2024, director: "Denis Villeneuve" })).resolves.toEqual({
      ok: false,
      notes: null,
    });
  });

  it("blocks the real TMDB poster lists (each reports a failure, so the wall falls back)", async () => {
    process.env.TMDB_API_KEY = "dummy";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { fetchPosterList, createPosterPoolLoader } = await import("@/lib/tmdb");
      await expect(fetchPosterList("trending/movie/day")).resolves.toBeNull();
      await expect(createPosterPoolLoader()()).resolves.toEqual([]);
    } finally {
      warn.mockRestore();
      delete process.env.TMDB_API_KEY;
    }
  });

  it("blocks the real TMDB search (which then reports degraded, as it would on any failure)", async () => {
    process.env.TMDB_API_KEY = "dummy";
    try {
      await expect(searchMovies("heat")).resolves.toEqual({ results: [], degraded: true });
    } finally {
      delete process.env.TMDB_API_KEY;
    }
  });
});

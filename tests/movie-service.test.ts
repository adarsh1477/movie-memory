// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { saveMovieForUser, PICK_FROM_SUGGESTIONS } from "@/lib/movie-service";
import { AppErrorException } from "@/lib/errors";

const HEAT = { tmdbId: 949, title: "Heat", year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" };

let upsert: ReturnType<typeof vi.fn>;
let search: ReturnType<typeof vi.fn>;
let deps: Parameters<typeof saveMovieForUser>[2];

beforeEach(() => {
  upsert = vi.fn(async (args: { create: object }) => ({ id: "m1", ...args.create }));
  search = vi.fn(async () => ({ results: [HEAT], degraded: false }));
  deps = { prisma: { movie: { upsert } } as unknown as PrismaClient, search };
});

describe("saveMovieForUser", () => {
  it("stores a selected result with its TMDB fields, scoped to the user", async () => {
    await saveMovieForUser("user-1", { title: "Heat", tmdbId: 949, year: 1995, posterPath: HEAT.posterPath }, deps);

    expect(search).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      create: { userId: "user-1", title: "Heat", tmdbId: 949, year: 1995, posterPath: HEAT.posterPath },
      update: { title: "Heat", tmdbId: 949, year: 1995, posterPath: HEAT.posterPath },
    });
  });

  it("rejects free text when TMDB has matches", async () => {
    const err = await saveMovieForUser("user-1", { title: "Heat" }, deps).catch((e) => e);

    expect(err).toBeInstanceOf(AppErrorException);
    expect((err as AppErrorException).error).toMatchObject({
      code: "VALIDATION",
      message: PICK_FROM_SUGGESTIONS,
      fieldErrors: { title: PICK_FROM_SUGGESTIONS },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["TMDB is degraded", { results: [], degraded: true }],
    ["TMDB has no match", { results: [], degraded: false }],
  ])("accepts free text when %s, clearing TMDB fields", async (_label, response) => {
    search.mockResolvedValueOnce(response);

    await saveMovieForUser("user-1", { title: "My Indie Film" }, deps);

    expect(upsert.mock.calls[0][0].update).toEqual({ title: "My Indie Film", tmdbId: null, year: null, posterPath: null });
  });

  it("skips the search for a 1-character title", async () => {
    await saveMovieForUser("user-1", { title: "M" }, deps);
    expect(search).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalled();
  });

  it("ignores year and posterPath without a tmdbId", async () => {
    search.mockResolvedValueOnce({ results: [], degraded: true });
    await saveMovieForUser("user-1", { title: "Heat", year: 1995, posterPath: HEAT.posterPath }, deps);
    expect(upsert.mock.calls[0][0].update).toMatchObject({ year: null, posterPath: null });
  });
});

// The poster wall: a seeded shuffle of the cached pool, so the order changes per visit
// but one render is fully determined by its seed.
import { describe, it, expect, vi, beforeEach } from "vitest";

const pool = Array.from({ length: 70 }, (_, i) => `/p${i}.jpg`);
const getPosterPool = vi.fn(async () => pool);
vi.mock("@/lib/tmdb", () => ({ getPosterPool: () => getPosterPool() }));

const { seededShuffle, getPosterWall, POSTER_WALL_SIZE } = await import("@/lib/poster-wall");

beforeEach(() => getPosterPool.mockClear());

describe("seededShuffle", () => {
  it("keeps exactly the same set of posters (a permutation, no loss, no duplicates)", () => {
    for (const seed of [0, 1, 42, 2 ** 32 - 1]) {
      const out = seededShuffle(pool, seed);
      expect(out).toHaveLength(pool.length);
      expect([...out].sort()).toEqual([...pool].sort());
    }
  });

  it("is deterministic for a seed (server markup is reproducible) and differs across seeds", () => {
    expect(seededShuffle(pool, 1234)).toEqual(seededShuffle(pool, 1234));
    expect(seededShuffle(pool, 1234)).not.toEqual(seededShuffle(pool, 5678));
    expect(seededShuffle(pool, 1234)).not.toEqual(pool);
  });

  it("doesn't mutate its input, and handles tiny inputs", () => {
    const copy = [...pool];
    seededShuffle(pool, 7);
    expect(pool).toEqual(copy);
    expect(seededShuffle([], 7)).toEqual([]);
    expect(seededShuffle(["/a.jpg"], 7)).toEqual(["/a.jpg"]);
  });

  it("spreads items: over many seeds, each poster leads the wall at least once", () => {
    const leaders = new Set(Array.from({ length: 2000 }, (_, seed) => seededShuffle(pool, seed)[0]));
    expect(leaders.size).toBe(pool.length);
  });
});

describe("getPosterWall", () => {
  it("renders 40 distinct posters from the pool, in a seed-determined order", async () => {
    const wall = await getPosterWall(99);
    expect(wall).toHaveLength(POSTER_WALL_SIZE);
    expect(POSTER_WALL_SIZE).toBe(40);
    expect(new Set(wall).size).toBe(40);
    for (const p of wall) expect(pool).toContain(p);
    expect(await getPosterWall(99)).toEqual(wall);
  });

  it("without a seed, picks a fresh one per render (the order changes per visit)", async () => {
    const walls = await Promise.all(Array.from({ length: 5 }, () => getPosterWall()));
    expect(new Set(walls.map((w) => w.join())).size).toBeGreaterThan(1);
  });

  it("uses the shared cached pool (one lookup per render) and keeps the empty fallback", async () => {
    await getPosterWall(1);
    expect(getPosterPool).toHaveBeenCalledTimes(1);
    getPosterPool.mockResolvedValueOnce([]);
    await expect(getPosterWall(1)).resolves.toEqual([]);
  });

  it("a small pool is shown whole", async () => {
    getPosterPool.mockResolvedValueOnce(["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/e.jpg"]);
    const wall = await getPosterWall(3);
    expect([...wall].sort()).toEqual(["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/e.jpg"]);
  });
});

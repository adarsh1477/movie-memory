// The poster wall for the landing and onboarding pages: a different order per visit,
// drawn from the cached TMDB pool (lib/tmdb.ts getPosterPool).

import { randomInt } from "node:crypto";
import { getPosterPool } from "./tmdb";

/** Posters rendered per wall: the same count PosterBackground tiled before (MIN_TILE_ITEMS). */
export const POSTER_WALL_SIZE = 40;

/** mulberry32: a tiny deterministic PRNG. Same seed → same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded PRNG. Pure: returns a new array with the same items. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The posters for one page render: the cached pool, shuffled with a per-render seed, then
 * the first POSTER_WALL_SIZE. The seed is picked once on the server and the markup is built
 * from it there (PosterBackground is a server component), so the HTML the client receives is
 * the only rendering: nothing is re-shuffled in the browser and nothing can mismatch.
 */
export async function getPosterWall(seed: number = randomInt(0, 2 ** 32)): Promise<string[]> {
  const pool = await getPosterPool();
  return seededShuffle(pool, seed).slice(0, POSTER_WALL_SIZE);
}

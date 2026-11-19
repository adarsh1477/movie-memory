import Image from "next/image";
import { posterUrl } from "@/lib/tmdb-image";

type Props = {
  posters: string[];
  /**
   * "landing" (default): lighter overlay with a left gradient behind the hero text.
   * "focus": darker, centred vignette so a single card in the middle stands out.
   */
  variant?: "landing" | "focus";
};

// At max poster height (210px): poster width = 140px, slot = 152px.
//   40 slots × 152px = 6080px — covers any screen up to 3840px wide.
// At min poster height (120px, seen at ~1091px viewport): width = 80px, slot = 92px.
//   40 slots × 92px = 3680px — covers up to 3440px (1 tile > viewport).
// 3-copy track → animate by exactly -33.333% = one tile width, seamless at all sizes.
const MIN_TILE_ITEMS = 40;

/** Posters per row visible on first paint at common widths (~1366–1600px). */
export const EAGER_PER_ROW = 10;

/**
 * Loading strategy for one poster slot. Only the slots on screen at first paint load
 * eagerly; the very first one (top-left, the likeliest LCP image) is also preloaded.
 * Everything off screen stays lazy. A reverse row starts at translateX(-33.333%), so its
 * visible slots at first paint are the SECOND copy of the tile (indices n…n+9), not the first.
 */
export function posterLoading(
  rowIndex: number,
  itemIndex: number,
  reverse: boolean,
  tileLength: number,
): { loading: "eager" | "lazy"; preload: boolean } {
  const firstVisible = reverse ? tileLength : 0;
  const visible = itemIndex >= firstVisible && itemIndex < firstVisible + EAGER_PER_ROW;
  return { loading: visible ? "eager" : "lazy", preload: rowIndex === 0 && itemIndex === 0 };
}

export default function PosterBackground({ posters, variant = "landing" }: Props) {
  const focus = variant === "focus";
  if (posters.length < 4) return null;

  // Repeat the base list until we have MIN_TILE_ITEMS per tile.
  const reps = Math.ceil(MIN_TILE_ITEMS / posters.length);
  const tile = Array.from(
    { length: reps * posters.length },
    (_, i) => posters[i % posters.length],
  );
  const n = tile.length;

  // Three rows, each starting at a different offset for visual variety.
  const rows = [
    { offset: 0,                    reverse: false, duration: 36 },
    { offset: Math.floor(n * 0.33), reverse: true,  duration: 50 },
    { offset: Math.floor(n * 0.66), reverse: false, duration: 42 },
  ].map(({ offset, reverse, duration }) => {
    const rotated = [...tile.slice(offset), ...tile.slice(0, offset)];
    return {
      // 3 copies → -33.333% translation = exactly one tile, no seam at any viewport width
      items: [...rotated, ...rotated, ...rotated],
      reverse,
      duration,
    };
  });

  // Poster dimensions — shared between row container and each poster slot.
  // height: clamp(120px, 11vw, 210px)  →  width auto via aspect-ratio 2/3
  //   1366px → ~150px tall, ~100px wide
  //   1920px → 210px tall (capped), 140px wide
  //   2560px → 210px tall (capped), 140px wide
  const posterH = "clamp(120px, 11vw, 210px)";

  return (
    <div
      className="pointer-events-none fixed inset-0 -z-20 overflow-hidden"
      aria-hidden="true"
    >
      {/* Rows — centred vertically; py-16 keeps posters clear of the sticky nav */}
      <div className="absolute inset-0 flex flex-col items-stretch justify-center gap-3 py-16">
        {rows.map((row, i) => (
          <div
            key={i}
            // 3rd row hidden on mobile; shown on sm+ (all three rows = ~3×poster height)
            className={i === 2 ? "hidden overflow-hidden sm:block" : "overflow-hidden"}
            style={{ height: posterH }}
          >
            {/* Track — 3 identical copies; CSS percentage resolves against track width */}
            <div
              className={
                row.reverse
                  ? "motion-safe:animate-marquee-reverse flex h-full"
                  : "motion-safe:animate-marquee flex h-full"
              }
              style={{ animationDuration: `${row.duration}s` }}
            >
              {row.items.map((path, j) => {
                const { loading, preload } = posterLoading(i, j, row.reverse, n);
                return (
                  <div
                    key={j}
                    // mr-3 = 12px gap; width derived from height via aspect-ratio 2/3
                    className="relative mr-3 shrink-0 aspect-[2/3]"
                    style={{ height: posterH }}
                  >
                    <Image
                      src={posterUrl(path, "w342")}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="(max-width: 1920px) 140px, 140px"
                      // A preloaded image already loads eagerly, so it gets `preload` alone.
                      {...(preload ? { preload: true } : { loading })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Layer 1: uniform dark base */}
      <div className={`absolute inset-0 ${focus ? "bg-background/[0.80]" : "bg-background/[0.70]"}`} />

      {/* Layer 2: radial vignette — softens edges without hard patches */}
      <div
        className="absolute inset-0"
        style={{
          background: focus
            ? "radial-gradient(ellipse 70% 75% at 50% 40%, transparent 20%, rgba(11,11,15,0.75) 100%)"
            : "radial-gradient(ellipse 85% 85% at 50% 50%, transparent 30%, rgba(11,11,15,0.5) 100%)",
        }}
      />

      {/* Layer 3 (landing): soft left gradient behind the hero text column.
          Layer 3 (focus): faint amber bloom behind the centred card. */}
      {focus ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 45% 40% at 50% 38%, rgba(245,184,65,0.07) 0%, transparent 70%)",
          }}
        />
      ) : (
        <div
          className="absolute inset-0 hidden lg:block"
          style={{
            background:
              "linear-gradient(to right, rgba(11,11,15,0.6) 0%, rgba(11,11,15,0.2) 40%, transparent 62%)",
          }}
        />
      )}

      {/* Layer 4: top and bottom fades */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

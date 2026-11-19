// Above-the-fold posters load eagerly (the LCP one is preloaded); the rest stay lazy.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import PosterBackground, { EAGER_PER_ROW, posterLoading } from "@/components/PosterBackground";

type Captured = { src: string; loading?: string; preload?: boolean };
const captured: Captured[] = [];

vi.mock("next/image", () => ({
  default: (props: { src: string; loading?: string; preload?: boolean; priority?: boolean }) => {
    captured.push({ src: props.src, loading: props.loading, preload: props.preload });
    if (props.priority !== undefined) throw new Error("`priority` is deprecated in Next 16: use `preload`");
    return null;
  },
}));

afterEach(() => {
  cleanup();
  captured.length = 0;
});

const POSTERS = Array.from({ length: 20 }, (_, i) => `/p${i}.jpg`);

describe("posterLoading", () => {
  it("preloads only the first poster of the first row (the likeliest LCP image)", () => {
    expect(posterLoading(0, 0, false, 40)).toEqual({ loading: "eager", preload: true });
    expect(posterLoading(0, 1, false, 40).preload).toBe(false);
    expect(posterLoading(1, 0, true, 40).preload).toBe(false);
  });

  it("forward rows: the first EAGER_PER_ROW slots are eager, the rest lazy", () => {
    expect(EAGER_PER_ROW).toBe(10);
    expect(posterLoading(0, EAGER_PER_ROW - 1, false, 40).loading).toBe("eager");
    expect(posterLoading(0, EAGER_PER_ROW, false, 40).loading).toBe("lazy");
    expect(posterLoading(2, 100, false, 40).loading).toBe("lazy");
  });

  it("reverse rows start at -33.333%, so the visible slots are the second copy", () => {
    expect(posterLoading(1, 0, true, 40).loading).toBe("lazy"); // first copy: off screen at first paint
    expect(posterLoading(1, 40, true, 40).loading).toBe("eager");
    expect(posterLoading(1, 40 + EAGER_PER_ROW - 1, true, 40).loading).toBe("eager");
    expect(posterLoading(1, 40 + EAGER_PER_ROW, true, 40).loading).toBe("lazy");
  });
});

describe("PosterBackground", () => {
  it("renders exactly one preloaded poster, a first screen of eager ones, and the rest lazy", () => {
    render(<PosterBackground posters={POSTERS} />);

    const preloaded = captured.filter((c) => c.preload);
    const eager = captured.filter((c) => c.loading === "eager");
    const lazy = captured.filter((c) => c.loading === "lazy");

    expect(preloaded).toHaveLength(1);
    expect(preloaded[0].src).toContain("/p0.jpg");
    expect(preloaded[0].loading).toBeUndefined(); // preload only, no loading prop
    expect(eager).toHaveLength(3 * EAGER_PER_ROW - 1); // 3 rows, minus the preloaded one
    expect(lazy.length).toBe(captured.length - 3 * EAGER_PER_ROW);
    expect(lazy.length).toBeGreaterThan(eager.length * 5); // most of the wall stays lazy
  });

  it("renders nothing with fewer than 4 posters", () => {
    render(<PosterBackground posters={["/a.jpg", "/b.jpg", "/c.jpg"]} />);
    expect(captured).toHaveLength(0);
  });
});

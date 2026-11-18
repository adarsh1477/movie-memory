// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseMovieForm } from "@/lib/validation";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseMovieForm", () => {
  it("parses a selected TMDB result", () => {
    const result = parseMovieForm(
      form({ title: "  Heat ", tmdbId: "949", year: "1995", posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" }),
    );
    expect(result).toEqual({
      success: true,
      data: { title: "Heat", tmdbId: 949, year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" },
    });
  });

  it("accepts free text with empty hidden fields", () => {
    const result = parseMovieForm(form({ title: "My Indie Film", tmdbId: "", year: "", posterPath: "" }));
    expect(result).toEqual({ success: true, data: { title: "My Indie Film" } });
  });

  it("still trims and length-checks the title", () => {
    expect(parseMovieForm(form({ title: "   " })).success).toBe(false);
    expect(parseMovieForm(form({ title: "x".repeat(121) })).success).toBe(false);
    expect(parseMovieForm(form({})).success).toBe(false);
  });

  it.each([
    ["non-numeric tmdbId", { tmdbId: "abc" }],
    ["negative tmdbId", { tmdbId: "-5" }],
    ["fractional tmdbId", { tmdbId: "1.5" }],
    ["implausible year", { tmdbId: "949", year: "3020" }],
    ["absolute poster URL", { tmdbId: "949", posterPath: "https://evil.example/x.jpg" }],
    ["path traversal in poster", { tmdbId: "949", posterPath: "/../../x.jpg" }],
  ])("rejects a %s", (_label, extra) => {
    expect(parseMovieForm(form({ title: "Heat", ...extra })).success).toBe(false);
  });
});

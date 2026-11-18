import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import MovieSearchCombobox from "@/components/MovieSearchCombobox";
import type { MovieSearchResponse } from "@/lib/validation";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

const RESULTS: MovieSearchResponse = {
  degraded: false,
  results: [
    { tmdbId: 949, title: "Heat", year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" },
    { tmdbId: 11, title: "Heat", year: 1986, posterPath: null },
  ],
};

let searchFn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  searchFn = vi.fn(async () => RESULTS);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(onSelectionChange = vi.fn()) {
  const { container } = render(
    <form>
      <MovieSearchCombobox id="movie" name="title" searchFn={searchFn} onSelectionChange={onSelectionChange} />
    </form>,
  );
  const input = screen.getByRole("combobox") as HTMLInputElement;
  const hidden = (n: string) => container.querySelector<HTMLInputElement>(`input[type=hidden][name=${n}]`)!.value;
  return { input, hidden, onSelectionChange };
}

async function type(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe("MovieSearchCombobox", () => {
  it("has combobox ARIA wiring", () => {
    const { input } = setup();
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-controls")).toBeTruthy();
  });

  it("debounces: one request 300ms after the last keystroke", async () => {
    const { input } = setup();
    await type(input, "he");
    await act(async () => void (await vi.advanceTimersByTimeAsync(200)));
    await type(input, "hea");
    await act(async () => void (await vi.advanceTimersByTimeAsync(299)));
    expect(searchFn).not.toHaveBeenCalled();

    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(searchFn).toHaveBeenCalledTimes(1);
    expect(searchFn.mock.calls[0][0]).toBe("hea");
  });

  it("does not search under 2 characters", async () => {
    const { input } = setup();
    await type(input, "h");
    await flushDebounce();
    expect(searchFn).not.toHaveBeenCalled();
  });

  it("aborts the in-flight request when the query changes", async () => {
    let firstSignal: AbortSignal | undefined;
    searchFn.mockImplementationOnce((_q: string, signal: AbortSignal) => {
      firstSignal = signal;
      return new Promise(() => {});
    });
    const { input } = setup();

    await type(input, "he");
    await flushDebounce();
    expect(firstSignal?.aborted).toBe(false);

    await type(input, "heat");
    expect(firstSignal?.aborted).toBe(true);
  });

  it("shows options with title and year, and selects with arrows + Enter", async () => {
    const { input, hidden, onSelectionChange } = setup();
    await type(input, "heat");
    await flushDebounce();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[1].textContent).toContain("1986");
    expect(input.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1].id);
    expect(options[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0].id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("Heat");
    expect(hidden("tmdbId")).toBe("949");
    expect(hidden("year")).toBe("1995");
    expect(hidden("posterPath")).toBe("/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg");
    expect(onSelectionChange).toHaveBeenLastCalledWith(RESULTS.results[0]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears the selection when the text is edited", async () => {
    const { input, hidden, onSelectionChange } = setup();
    await type(input, "heat");
    await flushDebounce();
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(hidden("tmdbId")).toBe("949");

    await type(input, "heat 2");
    expect(hidden("tmdbId")).toBe("");
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it("closes on Escape", async () => {
    const { input } = setup();
    await type(input, "heat");
    await flushDebounce();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a no-results state", async () => {
    searchFn.mockResolvedValueOnce({ results: [], degraded: false });
    const { input } = setup();
    await type(input, "zzqx");
    await flushDebounce();
    expect(screen.getByText(/No matches for/)).toBeTruthy();
  });

  it("shows a degraded state that allows typing freely", async () => {
    searchFn.mockResolvedValueOnce({ results: [], degraded: true });
    const { input } = setup();
    await type(input, "heat");
    await flushDebounce();
    expect(screen.getByText(/search is unavailable right now/i)).toBeTruthy();
  });

  it("treats a failed request like degraded", async () => {
    searchFn.mockRejectedValueOnce(new Error("HTTP 500"));
    const { input } = setup();
    await type(input, "heat");
    await flushDebounce();
    expect(screen.getByText(/search is unavailable right now/i)).toBeTruthy();
  });
});

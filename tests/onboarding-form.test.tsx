import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import type { MovieSearchResponse } from "@/lib/validation";

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const rest = { ...props };
    delete rest.fill;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} />;
  },
}));
vi.mock("@/app/onboarding/actions", () => ({ saveMovie: vi.fn(async () => ({})) }));

const RESULTS: MovieSearchResponse = {
  degraded: false,
  results: [
    { tmdbId: 949, title: "Heat", year: 1995, posterPath: "/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg" },
    { tmdbId: 11, title: "Heat", year: 1986, posterPath: null },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data: RESULTS }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderForm() {
  const { default: OnboardingForm } = await import("@/components/OnboardingForm");
  render(<OnboardingForm />);
  return {
    input: screen.getByRole("combobox") as HTMLInputElement,
    continueButton: screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement,
  };
}

async function search(input: HTMLInputElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
}

describe("OnboardingForm", () => {
  it("disables Continue until a title is typed", async () => {
    const { input, continueButton } = await renderForm();
    expect(continueButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "   " } });
    expect(continueButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "My Indie Film" } });
    expect(continueButton.disabled).toBe(false);
  });

  it("shows the selected movie preview with poster, title and year", async () => {
    const { input } = await renderForm();
    await search(input, "heat");

    expect(screen.getByText("Powered by TMDB")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("option")[0]);

    const preview = screen.getByRole("group", { name: "Selected movie" });
    expect(preview.textContent).toContain("Heat");
    expect(preview.textContent).toContain("1995");
    expect(preview.querySelector("img")?.getAttribute("src")).toContain("/obpPQskaVpSbbbF4vS2wLnhtvEX.jpg");
  });

  it("Change clears the selection and shows the alternatives again", async () => {
    const { input } = await renderForm();
    await search(input, "heat");
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(screen.queryByRole("group", { name: "Selected movie" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.queryByRole("group", { name: "Selected movie" })).toBeNull();
    expect(document.querySelector<HTMLInputElement>("input[name=tmdbId]")!.value).toBe("");
    expect(input.value).toBe("Heat");

    await act(async () => void (await vi.advanceTimersByTimeAsync(300)));
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });
});

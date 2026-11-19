// @vitest-environment node
// The onboarding server action: session check, validation, service errors, redirect.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppErrorException } from "@/lib/errors";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

const authMock = vi.fn();
const saveMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/movie-service", () => ({ saveMovieForUser: (...args: unknown[]) => saveMock(...args) }));

const { saveMovie } = await import("@/app/onboarding/actions");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Runs the action; returns { redirect } or { state }. */
async function submit(fields: Record<string, string>) {
  try {
    return { state: await saveMovie({}, form(fields)) };
  } catch (err) {
    if (err instanceof RedirectSignal) return { redirect: err.url };
    throw err;
  }
}

const HEAT = { title: "Heat", tmdbId: "949", year: "1995", posterPath: "/heat.jpg" };

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "user-1" } });
  saveMock.mockReset().mockResolvedValue({});
});

describe("saveMovie (onboarding server action)", () => {
  it("redirects to / without a session and saves nothing", async () => {
    authMock.mockResolvedValue(null);
    expect(await submit(HEAT)).toEqual({ redirect: "/" });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("saves a selected movie for the session user and redirects to the dashboard", async () => {
    expect(await submit({ ...HEAT, title: "  Heat  " })).toEqual({ redirect: "/dashboard" });
    expect(saveMock).toHaveBeenCalledWith("user-1", { title: "Heat", tmdbId: 949, year: 1995, posterPath: "/heat.jpg" });
  });

  it("takes the user id from the session, never from the form", async () => {
    await submit({ ...HEAT, userId: "someone-else" });
    expect(saveMock.mock.calls[0][0]).toBe("user-1");
    expect(saveMock.mock.calls[0][1]).not.toHaveProperty("userId");
  });

  it.each([
    ["empty", "   ", "Movie title is required"],
    ["too long", "x".repeat(121), "Movie title must be 120 characters or fewer"],
  ])("returns the validation message for a %s title (server-side)", async (_label, title, message) => {
    expect(await submit({ title })).toEqual({ state: { error: message } });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("rejects a forged selection with a friendly message", async () => {
    expect(await submit({ ...HEAT, posterPath: "https://evil.example/x.jpg" })).toEqual({
      state: { error: "That selection looks invalid. Please pick the movie again." },
    });
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("passes through the service's 'pick from the suggestions' message", async () => {
    saveMock.mockRejectedValue(
      new AppErrorException({ code: "VALIDATION", message: "Pick your movie from the suggestions so we get the right film." }),
    );
    expect(await submit({ title: "Heat" })).toEqual({
      state: { error: "Pick your movie from the suggestions so we get the right film." },
    });
  });

  it("hides unexpected errors behind a friendly message", async () => {
    saveMock.mockRejectedValue(new Error("connection to 10.0.0.5 refused"));
    const result = await submit(HEAT);
    expect(result).toEqual({ state: { error: "Could not save your movie. Please try again." } });
  });
});

// @vitest-environment node
// Auth flow (evaluation criterion #1): who lands where, decided server-side by auth().
// Pages are called directly as async server components; redirect() is mocked to throw.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

const authMock = vi.fn();
const userFindUnique = vi.fn();
const movieFindUnique = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (a: unknown) => userFindUnique(a) },
    movie: { findUnique: (a: unknown) => movieFindUnique(a) },
  },
}));
vi.mock("@/lib/tmdb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tmdb")>()),
  getTrendingPosters: async () => [],
}));

const { default: LandingPage } = await import("@/app/page");
const { default: OnboardingPage } = await import("@/app/onboarding/page");
const { default: DashboardPage } = await import("@/app/dashboard/page");
const { proxy, config } = await import("@/proxy");

const signedIn = (id = "user-1") => authMock.mockResolvedValue({ user: { id } });
const signedOut = () => authMock.mockResolvedValue(null);

/** Runs a page; returns the redirect target, or null if it rendered. */
async function outcome(page: () => Promise<unknown>): Promise<string | null> {
  try {
    await page();
    return null;
  } catch (err) {
    if (err instanceof RedirectSignal) return err.url;
    throw err;
  }
}

const USER = { id: "user-1", name: "Ada", email: "ada@example.com", image: null };
const MOVIE = { id: "m1", title: "Heat", tmdbId: 949, year: 1995, posterPath: "/heat.jpg" };

beforeEach(() => {
  authMock.mockReset();
  userFindUnique.mockReset();
  movieFindUnique.mockReset();
});

// ── Landing ───────────────────────────────────────────────────────────────────

describe("/ (landing)", () => {
  it("shows the landing page (with Sign in with Google) when signed out", async () => {
    signedOut();
    expect(await outcome(LandingPage)).toBeNull();
    expect(movieFindUnique).not.toHaveBeenCalled();
  });

  it("sends a first-time user (no movie yet) to onboarding", async () => {
    signedIn();
    movieFindUnique.mockResolvedValue(null);
    expect(await outcome(LandingPage)).toBe("/onboarding");
  });

  it("sends a returning user (has a movie) to the dashboard", async () => {
    signedIn();
    movieFindUnique.mockResolvedValue({ id: "m1" });
    expect(await outcome(LandingPage)).toBe("/dashboard");
  });

  it("looks up the movie for the session's user only", async () => {
    signedIn("user-42");
    movieFindUnique.mockResolvedValue(null);
    await outcome(LandingPage);
    expect(movieFindUnique.mock.calls[0][0]).toMatchObject({ where: { userId: "user-42" } });
  });
});

// ── Onboarding ────────────────────────────────────────────────────────────────

describe("/onboarding", () => {
  it("redirects to / when signed out", async () => {
    signedOut();
    expect(await outcome(OnboardingPage)).toBe("/");
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("renders for a signed-in user without a movie", async () => {
    signedIn();
    userFindUnique.mockResolvedValue({ ...USER, movie: null });
    expect(await outcome(OnboardingPage)).toBeNull();
  });

  it("sends a user who already has a movie to the dashboard (first-time only)", async () => {
    signedIn();
    userFindUnique.mockResolvedValue({ ...USER, movie: { id: "m1" } });
    expect(await outcome(OnboardingPage)).toBe("/dashboard");
  });

  it("redirects to / when the session's user row is gone", async () => {
    signedIn();
    userFindUnique.mockResolvedValue(null);
    expect(await outcome(OnboardingPage)).toBe("/");
  });
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

describe("/dashboard", () => {
  it("redirects to / (login) when signed out", async () => {
    signedOut();
    expect(await outcome(DashboardPage)).toBe("/");
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("sends a signed-in user without a movie to onboarding", async () => {
    signedIn();
    userFindUnique.mockResolvedValue({ ...USER, movie: null });
    expect(await outcome(DashboardPage)).toBe("/onboarding");
  });

  it("renders for a signed-in user with a movie, reading only their own row", async () => {
    signedIn("user-7");
    userFindUnique.mockResolvedValue({ ...USER, id: "user-7", movie: MOVIE });
    expect(await outcome(DashboardPage)).toBeNull();
    expect(userFindUnique.mock.calls[0][0]).toMatchObject({ where: { id: "user-7" } });
  });
});

// ── proxy.ts (UX-only cookie check; the real guard is auth() above) ───────────

describe("proxy.ts", () => {
  const request = (path: string, cookie?: string) =>
    new NextRequest(new URL(path, "http://localhost:3000"), cookie ? { headers: { cookie } } : undefined);

  it("only runs on /dashboard and /onboarding", () => {
    expect(config.matcher).toEqual(["/dashboard/:path*", "/onboarding/:path*"]);
  });

  it("redirects to / when there is no session cookie", () => {
    const res = proxy(request("/dashboard"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });

  it.each(["authjs.session-token=abc", "__Secure-authjs.session-token=abc"])(
    "lets the request through with %s (verification happens in auth())",
    (cookie) => {
      const res = proxy(request("/dashboard", cookie));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    },
  );

  it("ignores unrelated cookies", () => {
    const res = proxy(request("/onboarding", "theme=dark"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
  });
});

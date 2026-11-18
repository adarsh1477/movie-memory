# Architecture

Short: a Next.js 16 App Router app, server-rendered dashboard, one fact-generation service behind a typed API, Postgres-backed auth and data.

## Component tree (dashboard)

```
app/layout.tsx (RootLayout)
└── app/dashboard/page.tsx (server component — calls auth(), loads user + movie)
    ├── Sidebar (desktop)  /  TopBar (mobile)
    │   └── Avatar (initials fallback) + name + email + SignOutButton
    ├── MovieHeroCard (client — inline edit form)
    └── FactCard (client — fetch via lib/api.ts, 30s client cache, countdown)
        └── <ErrorBoundary> wrapping the card body with a retry CTA
```

The `onboarding` segment composes `OnboardingForm` (client — Save button, Zod-mirrored validation hints). Landing (`/`) is a server component that calls `auth()` and, for authenticated users, `redirect()`s before the page paints; for unauthenticated users it renders a full-page premium landing composed of:

```
app/page.tsx (server — auth(), getTrendingPosters())
├── PosterBackground (server — 3 marquee rows, TMDB trending posters, 4-layer overlay)
├── header: Logo + SignInButton (nav variant)
├── section 1: Hero — headline + SignInButton (CTA) | MockCardPreview (client)
├── section 2: How it works — HowStep × 3, ScrollFade (client)
├── section 3: See it in action — FactCarousel (client), ScrollFade
├── section 4: Built with care — FeatureCard × 4, ScrollFade
├── section 5: Final CTA — SignInButton, ScrollFade
└── footer: Logo + TMDB credit (shown only when posters.length > 0)
```

`MovieHeroCard` contains `PosterImage` (client — renders `next/image` from `posterPath`, or a gradient film-frame fallback when the path is null).

## Request flows (as boxes + arrows for a diagram)

### A. Landing page poster wall

```
Browser ──GET /──▶ app/page.tsx
  │                   ├── auth() → has session → redirect(/dashboard or /onboarding)
  │                   └── getTrendingPosters()
  │                         ├── TMDB_API_KEY absent → [] immediately (no fetch)
  │                         └── fetch("https://api.themoviedb.org/3/trending/movie/day", {
  │                               headers: { Authorization: "Bearer <TMDB_API_KEY>" },
  │                               next: { revalidate: 86400 },   // 24 h Next.js data cache
  │                               signal: AbortSignal.timeout(3000)
  │                             })
  │                               ├── ok → Zod parse → filter null poster_path → string[]
  │                               └── any failure (network, non-OK, timeout, bad shape) → []
  │
  └── render PosterBackground (server, no hydration) + 5 landing sections
      posters.length < 4 → PosterBackground renders nothing; page still loads normally
```

### B. Login (first-time user)

```
Browser ──GET /──▶ app/page.tsx ──auth()──▶ Auth.js
   │                                          │
   │             no session                   │
   │◀── render SignInButton ──────────────────┘

Click "Sign in with Google"
Browser ──▶ /api/auth/signin/google ──▶ Google OAuth ──▶ /api/auth/callback/google
   │                                                           │
   │                                                           ▼
   │                                              Prisma adapter upserts User + Account + Session
   │                                                           │
   │◀── Set-Cookie: authjs.session-token ──────────────────────┘

Browser ──GET /──▶ app/page.tsx ──auth() returns user──▶ Prisma: does user.movie exist?
   │                                                       │
   │                                                     no (first-time)
   │◀── redirect(/onboarding) ─────────────────────────────┘
```

### B. Onboarding

```
Browser ──GET /onboarding──▶ OnboardingPage (server component)
   │                             └── auth() required, else redirect(/)
   │
   │ Submit form
   ▼
Server Action saveFavoriteMovie(formData)
   ├── zod.parse({ title: trimmed, 1..120 })
   ├── lib/tmdb.ts fetchPosterPath(title)   ← server-only, 3s timeout
   │     ├── success → posterPath string (e.g. "/abc123.jpg")
   │     └── failure / no match / TMDB_API_KEY absent → null (silent fallback)
   ├── prisma.movie.upsert({ where: { userId }, data: { title, posterPath } })
   └── redirect(/dashboard)
```

### C. Dashboard load

```
Browser ──GET /dashboard──▶ DashboardPage (server component)
   │                             ├── auth() → session or redirect(/)
   │                             ├── prisma.user.findUnique({ include: { movie: true }})
   │                             └── render Sidebar + MovieHeroCard + <FactCard />
   │
   │ FactCard mounts (client)
   ▼
useFact() checks in-memory cache for `${userId}:${movieTitle}`
   ├── fresh (< 30s) → render cached, start countdown
   └── stale/miss   → api.getFact() → GET /api/fact (see flow D)
```

### D. Fact generation (`GET /api/fact`)

```
Request
  │
  ▼
auth()  ──no session──▶ 401
  │ session
  ▼
rateLimit.consume(userId)  ──exceeded──▶ 429 { RATE_LIMITED, retryAfterMs }
  │ ok
  ▼
loadMovie(userId)  ──missing──▶ 400 { NO_MOVIE }
  │ title
  ▼
findLatestFact(userId, title)  ──age < 60s──▶ 200 fact (cache_hit)
  │ miss or stale
  ▼
prisma.$transaction(timeout: 20s, maxWait: 5s) {
  SET LOCAL lock_timeout = '10s'
  pg_advisory_xact_lock(hashtext('fact:'||userId))
  │
  ├──acquired──▶ re-check findLatestFact
  │               ├── fresh (writer just filled it) ──▶ 200 fact (cache_hit post-lock)
  │               └── still stale
  │                    └── openai.generate(movie, avoid=last3)   (8s AbortSignal)
  │                           ├── ok    ──▶ INSERT Fact ──▶ 200 fact
  │                           └── error ──▶ findLatestFact(any-age)
  │                                           ├── present ──▶ 200 fact {stale:true}
  │                                           └── absent  ──▶ 502 UPSTREAM_FAILED
  │
  └──55P03 lock_not_available (10s)──▶ findLatestFact(any-age)
                                        ├── present ──▶ 200 fact {stale:true}
                                        └── absent  ──▶ 502 UPSTREAM_FAILED
}
```

Every branch logs a `fact.*` event with `durationMs`. Response always sent with `Cache-Control: no-store`.

## Server-only vs client-only boundaries

- Server-only: `lib/env.ts`, `lib/prisma.ts`, `lib/openai.ts`, `lib/tmdb.ts`, `lib/fact-service.ts`, `lib/lock.ts`, `lib/rate-limit.ts`, `lib/logger.ts`, `lib/auth.ts`, all route handlers, all `page.tsx` by default, `components/PosterBackground.tsx` (server component — fetches and renders TMDB poster paths without exposing them to the client bundle). `TMDB_API_KEY` never appears in any `NEXT_PUBLIC_*` var or client bundle.
- Client-only: `components/MovieHeroCard.tsx` (inline edit), `components/PosterImage.tsx` (renders stored path via `next/image`), `components/FactCard.tsx` (hook), `components/SignInButton.tsx`, `components/SignOutButton.tsx`, `lib/api.ts`, `lib/client-cache.ts`.
- `lib/validation.ts` and `lib/errors.ts` are shared — no server-only imports, so they're safe on both sides.

## Image hosting

TMDB poster paths are relative (e.g. `/abc123.jpg`). `next.config.ts` includes `images.remotePatterns` with `hostname: 'image.tmdb.org'` for all TMDB images.

- **Landing page poster wall** (`PosterBackground`): uses `posterUrl(path, 'w342')` — the smaller `w342` size is sufficient for marquee thumbnails and costs less bandwidth. Paths are fetched on each server render (cached 24 h by Next.js), never stored in the database.
- **Dashboard hero card** (`PosterImage`): assembles `https://image.tmdb.org/t/p/w500{posterPath}` for the larger dashboard display. `posterPath` is stored once in `Movie.posterPath` at save/edit time (Stage 6) — `PosterImage` only does URL construction, not API calls.

## Proxy (UX only)

`proxy.ts` matches `/dashboard/:path*` and `/onboarding/:path*`. If the Auth.js session cookie is absent → 307 to `/`. It never touches the DB and never verifies the token; the real guard is `auth()` inside each page/route.

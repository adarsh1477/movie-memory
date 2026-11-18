# Low-Level Design

## File tree

```
app/
  layout.tsx                     RootLayout: fonts, global styles, Providers
  page.tsx                       Landing (server) — auth() → redirect or SignIn
  global-error.tsx               Last-resort error UI
  onboarding/page.tsx            Server component + saveFavoriteMovie action
  onboarding/error.tsx           Segment error boundary
  dashboard/page.tsx             Server component composing Sidebar + Hero + Fact
  dashboard/error.tsx            Segment error boundary
  api/
    auth/[...nextauth]/route.ts  Auth.js handlers
    me/route.ts                  GET  → MeResponse
    me/movie/route.ts            PUT  ← MoviePutBody → MeResponse
    fact/route.ts                GET  → FactResponse  (Cache-Control: no-store)
components/
  Sidebar.tsx  TopBar.tsx
  Avatar.tsx                     Initials fallback when image missing or 404s
  MovieHeroCard.tsx              Inline edit (view/edit modes, optimistic Save); contains PosterImage
  PosterImage.tsx                next/image from posterPath or gradient film-frame fallback
  FactCard.tsx                   useFact() hook, skeleton, countdown, retry
  SignInButton.tsx  SignOutButton.tsx
  Skeleton.tsx                   Shared shimmer primitive
  PosterBackground.tsx           Server component; landing page 3-row marquee poster wall
  ScrollFade.tsx                 IntersectionObserver fade-in wrapper (client); 3-phase SSR-safe state
  FactCarousel.tsx               Landing page sample fact carousel; arrow/swipe/keyboard/dot nav
  MockCardPreview.tsx            Landing page animated dashboard preview card (client)
lib/
  env.ts                         Zod-validated process.env, throws at import; TMDB_API_KEY optional
  auth.ts                        Auth.js v5 config + auth() + handlers export
  prisma.ts                      PrismaClient singleton (globalThis in dev)
  openai.ts                      generateFact(movie, avoid[], signal)
  tmdb.ts                        Server-only. getTrendingPosters(): landing wall, 24 h revalidate, [] on failure; searchMovies(q): ≤6 results, 3s timeout, { results, degraded }, never throws
  tmdb-image.ts                  Client-safe posterUrl(path, size)
  movie-search-client.ts         Browser fetch for /api/movies/search, Zod-validated
  http.ts                        jsonOk / jsonError envelopes, Cache-Control: no-store
  fact-service.ts                getFactForUser(userId) — the main service
  lock.ts                        withAdvisoryLock(tx, key, fn)
  rate-limit.ts                  consume(userId): { ok, retryAfterMs }
  logger.ts                      pino instance, PII redaction, child({event})
  clock.ts                       Clock interface, default implementation
  validation.ts                  Zod schemas (MovieInput, API bodies)
  api.ts                         Typed client (getMe, putMovie, getFact)
  errors.ts                      AppError discriminated union
  client-cache.ts                In-memory Map + React context for facts
prisma/
  schema.prisma
  migrations/
tests/
  fact-service.test.ts
  fact-lock.test.ts              Real docker Postgres
  fact-authz.test.ts
  rate-limit.test.ts
  env.test.ts
  api-client.test.ts
  movie-edit.test.tsx
  tmdb.test.ts                   getTrendingPosters: success path, missing 'results' key → [], fetch throws → [], absent TMDB_API_KEY → [] (fetch never called), non-OK HTTP status → []
proxy.ts                         Cookie-presence redirect only
vitest.setup.ts                  Dummy env vars for test imports
eslint.config.js                 ESLint 9 flat config
.github/workflows/ci.yml
docker-compose.yml
.env.example
CLAUDE.md
README.md
```

## Key function signatures

```ts
// lib/env.ts
export const env: {
  DATABASE_URL: string
  AUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  OPENAI_API_KEY: string
  TMDB_API_KEY: string | undefined   // optional — absent → poster lookup silently skipped
  NODE_ENV: 'development' | 'production' | 'test'
}

// lib/clock.ts
export interface Clock { now(): number }
export const systemClock: Clock

// lib/openai.ts
export async function generateFact(
  movie: { title: string; year: number | null },
  avoid: string[],
  signal: AbortSignal,
): Promise<string>            // throws OpenAiError on failure or empty reply

// lib/tmdb.ts
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"

export function posterUrl(
  path: string,
  size?: "w342" | "w500" | "original",   // default "w342"
): string

export async function getTrendingPosters(): Promise<string[]>
// Returns trending poster paths. TMDB_API_KEY absent or any error → [].
// Uses next: { revalidate: 86400 } and AbortSignal.timeout(3000).

export async function searchMovies(
  query: string,
): Promise<{ results: MovieSearchResult[]; degraded: boolean }>
// ≤6 results of { tmdbId, title, year, posterPath }. Missing key, timeout, HTTP
// error or bad body → { results: [], degraded: true }. Bad items are skipped.

// lib/lock.ts
export async function withAdvisoryLock<T>(
  tx: Prisma.TransactionClient,
  key: string,
  fn: () => Promise<T>,
): Promise<T>                 // throws LockTimeoutError on 55P03

// lib/rate-limit.ts
export function consume(userId: string, now?: number):
  { ok: true } | { ok: false; retryAfterMs: number }

// lib/fact-service.ts
export async function getFactForUser(
  userId: string,
  deps?: { clock?: Clock; openai?: typeof generateFact; prisma?: PrismaClient },
): Promise<{ fact: Fact; stale: boolean }>
                              // throws NoMovieError | UpstreamFailedError
```

## AppError discriminated union

```ts
// lib/errors.ts
export type AppError =
  | { code: 'UNAUTHORIZED';     message: string }
  | { code: 'VALIDATION';       message: string; fieldErrors?: Record<string, string> }
  | { code: 'NOT_FOUND';        message: string }
  | { code: 'NO_MOVIE';         message: string }
  | { code: 'RATE_LIMITED';     message: string; retryAfterMs: number }
  | { code: 'UPSTREAM_FAILED';  message: string }
  | { code: 'INTERNAL';         message: string }

export class AppErrorException extends Error {
  constructor(public readonly error: AppError, public readonly status: number) { super(error.message) }
}

export const HTTP_STATUS: Record<AppError['code'], number> = {
  UNAUTHORIZED: 401, VALIDATION: 400, NOT_FOUND: 404, NO_MOVIE: 400,
  RATE_LIMITED: 429, UPSTREAM_FAILED: 502, INTERNAL: 500,
}
```

## API contracts (shared Zod schemas)

```ts
// lib/validation.ts
export const MovieInput = z.object({
  title: z.string().trim().min(1, 'required').max(120, 'too long'),
})
export type MovieInput = z.infer<typeof MovieInput>

export const MeResponse = z.object({
  user:  z.object({ id: z.string(), name: z.string().nullable(), email: z.string(), image: z.string().nullable() }),
  movie: z.object({ title: z.string(), posterPath: z.string().nullable(), updatedAt: z.string() }).nullable(),
})
export type MeResponse = z.infer<typeof MeResponse>

export const FactResponse = z.object({
  content:     z.string(),
  generatedAt: z.string(),          // ISO
  stale:       z.boolean(),
})
export type FactResponse = z.infer<typeof FactResponse>

export const ApiError = z.object({
  code:          z.enum(['UNAUTHORIZED','VALIDATION','NOT_FOUND','NO_MOVIE','RATE_LIMITED','UPSTREAM_FAILED','INTERNAL']),
  message:       z.string(),
  retryAfterMs:  z.number().optional(),
  fieldErrors:   z.record(z.string(), z.string()).optional(),
})
export type ApiError = z.infer<typeof ApiError>

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError }
```

### Route contracts

| Method | Path            | Request                   | Success                                 | Errors                                      |
|-------:|-----------------|---------------------------|-----------------------------------------|---------------------------------------------|
| GET    | `/api/me`       | (none)                    | `Envelope<MeResponse>`                  | 401                                         |
| PUT    | `/api/me/movie` | `MovieInput`              | `Envelope<MeResponse>`                  | 401, 400 (VALIDATION)                       |
| GET    | `/api/fact`     | (none)                    | `Envelope<FactResponse>`                | 401, 400 (NO_MOVIE), 429, 502               |
| GET    | `/api/movies/search` | `?q=` (trim, 2–100)  | `Envelope<MovieSearchResponse>` (`degraded: true` when TMDB fails) | 401, 400 (VALIDATION), 429 |

All authed responses: `Cache-Control: no-store`.

## Module responsibilities (one line each)

- `lib/env.ts` — fail-fast env check at import; exports typed `env` object.
- `lib/auth.ts` — Auth.js v5 config with Google provider + Prisma adapter + DB sessions; exports `auth`, `handlers`, `signIn`, `signOut`.
- `lib/prisma.ts` — single `PrismaClient` across hot reloads.
- `lib/openai.ts` — one function: `generateFact(movie, avoid, signal)`. Retries once on 429/5xx. No business logic.
- `lib/tmdb.ts` — server-only (Bearer token). `getTrendingPosters()`: TMDB `/trending/movie/day`, `next: { revalidate: 86400 }`, `AbortSignal.timeout(3000)`; `string[]` of poster paths, `[]` on any failure. `searchMovies(q)`: `/search/movie`, same auth/timeout, `cache: "no-store"`, ≤6 Zod-validated results, `{ degraded: true }` on any failure. Re-exports `posterUrl` from `lib/tmdb-image.ts`, which client components import instead.
- `components/MovieSearchCombobox.tsx` — WAI-ARIA combobox: 300ms debounce, `AbortController` per request, arrows/Enter/Escape, loading/no-results/degraded states. With `name`, renders hidden `tmdbId`/`year`/`posterPath` inputs for a server action; without it, reports via `onSelectionChange` (Stage 7 inline edit).
- `lib/lock.ts` — `withAdvisoryLock(tx, key, fn)`: sets `lock_timeout`, calls `pg_advisory_xact_lock`, runs `fn`, maps `55P03` → `LockTimeoutError`.
- `lib/rate-limit.ts` — in-memory sliding window; pure function with injectable `now`.
- `lib/logger.ts` — `pino` with `redact: ['email', 'user.email']`; `log.child({ event, userId, movieTitle, durationMs })`.
- `lib/clock.ts` — one-method interface so tests can advance time.
- `lib/fact-service.ts` — orchestrates: rate check → pre-check → tx+lock → re-check → openai → persist → fallback. Only file that knows the full flow.
- `lib/validation.ts` — Zod schemas used by both routes and the client wrapper.
- `lib/api.ts` — typed `fetch` wrapper; parses `Envelope<T>`; throws `AppErrorException` on `ok: false`.
- `lib/errors.ts` — the union above.
- `lib/client-cache.ts` — React context with a `Map<string, { fact, generatedAt, stale }>`; `useFact()` hook reads/writes the map, exposes `refresh()`.

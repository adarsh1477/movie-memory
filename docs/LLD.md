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
  MovieHeroCard.tsx              Client hero: backdrop, poster, title + inline edit (optimistic), FactCard
  PosterImage.tsx                next/image from posterPath or gradient film-frame fallback
  FactHistory.tsx                Dashboard-only timeline of past facts: Load more, refresh on new fact
  FactCard.tsx                   useFact(): skeleton, countdown, auto-swap, New fact, stale / error / saving
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
  openai.ts                      generateFact(movie, avoid[], signal) + refusal guard; looksLikeRefusal()
  fact-prompt.ts                 Pure: chooseFactMode, pickAngle, system prompts per mode, user message
  tmdb.ts                        Server-only. getTrendingPosters(): landing wall, 24 h revalidate, [] on failure; searchMovies(q): ≤6 results, 3s timeout, { results, degraded }, never throws; getMovieDetails(tmdbId): fact grounding, 3s timeout, 24 h in-memory cache, null on failure
  tmdb-image.ts                  Client-safe posterUrl(path, size)
  me.ts                          loadMe(userId) → MeResponse
  movie-service.ts               saveMovieForUser(userId, input) — shared by onboarding + PUT
  use-fact.ts                    useFact(): client cache, scheduling, auto-load, New fact
  use-page-visible.ts            usePageVisible(), useNow()
  http.ts                        jsonOk / jsonError envelopes, Cache-Control: no-store
  fact-service.ts                getFactForUser(userId) — the main service
  fact-history.ts                getFactHistory(userId, { limit, cursor }) — keyset page of the user's facts
  lock.ts                        withAdvisoryLock(tx, key, fn)
  rate-limit.ts                  createRateLimiter(); fact 30/min, search 30/min, movie edit 20/min — separate buckets
  logger.ts                      pino instance, PII redaction, child({event})
  clock.ts                       Clock interface, default implementation
  validation.ts                  Zod schemas (form + API bodies, responses, ApiError)
  api.ts                         Typed client (getMe, putMovie, getFact, searchMovies)
  errors.ts                      AppError discriminated union
  client-cache.ts                30s in-memory fact cache keyed by userId:movieTitle
prisma/
  schema.prisma
  migrations/
tests/
  fact-service.test.ts
  fact-lock.test.ts              Real docker Postgres
  fact-authz.test.ts             Service level, real Postgres
  fact-route-authz.test.ts       Route level (GET /api/fact), real Postgres
  api-routes.test.ts             /api/me, /api/me/movie, /api/fact
  movie-service.test.ts
  fact-card.test.tsx
  rate-limit.test.ts
  env.test.ts
  api-client.test.ts
  movie-edit.test.tsx            Inline edit: optimistic, revert, cancel, keyboard, free text
  client-cache.test.ts
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
  OPENAI_MODEL: string                // optional — blank/unset → "gpt-4.1-mini"; non-reasoning chat model
  MODEL_KNOWLEDGE_CUTOFF: string      // optional — YYYY-MM-DD, blank/unset → "2024-01-01"
  TMDB_API_KEY: string | undefined   // optional — absent → search degraded, no TMDB fact context
  NODE_ENV: 'development' | 'production' | 'test'
}

// lib/clock.ts
export interface Clock { now(): number }
export const systemClock: Clock

// lib/fact-prompt.ts (pure: no network, no env)
export type FactMode = 'knowledge' | 'grounded'
export function chooseFactMode(details: MovieDetails | null | undefined, knowledgeCutoff: string, today: string): FactMode
// knowledge: no details, or status "Released" AND releaseDate ≤ today AND releaseDate < cutoff.
// grounded: everything else (unreleased, in production, no date, released on/after cutoff).
export const FACT_ANGLES  // per mode. Both: behind the scenes, music or score, effects or filming,
                          // cultural impact or awards, little-known trivia, source material or franchise
                          // knowledge adds "filming techniques and sets"; grounded adds "casting"
export function pickAngle(existingFactCount: number, mode: FactMode): FactAngle   // FACT_ANGLES[mode][count % 7]
export const KNOWLEDGE_ACCURACY_RULE: string  // in both knowledge prompts: widely documented facts only; no casting
                                              // alternatives / exact quotes / exact numbers or dates / motivations
                                              // unless fully certain; else a safer well-documented fact
export function systemPrompt(mode: FactMode): string        // intro + mode block + what-to-write + never-list + 2 good / 2 bad examples (per mode)
export function strictSystemPrompt(mode: FactMode): string  // retry prompt for the same mode
export const GROUNDED_SOURCE_RULE: string   // in both grounded prompts: every claim from the TMDB data; no locations /
                                            // effects / CGI / budgets / BTS / production troubles unless stated;
                                            // thin data → premise, cast or franchise tie-in, upcoming if unreleased
export function buildUserMessage(mode: FactMode, input: { title; year; today; angle; details; avoid }): string
// JSON data: { movie, year, today, angle, tmdb, avoid }. tmdb = full details (grounded),
// { title, releaseDate, directors } (knowledge), or null.

// lib/openai.ts
export async function generateFact(
  movie: {
    title: string
    year: number | null
    details?: MovieDetails | null   // TMDB data; null for free text or when TMDB failed
    today?: string                  // YYYY-MM-DD, so "upcoming" can be judged
    mode?: FactMode                 // chosen by the caller; default chooseFactMode(…, MODEL_KNOWLEDGE_CUTOFF, today)
    angle?: FactAngle               // suggested topic; default FACT_ANGLES[mode][0]
  },
  avoid: string[],                  // last 10 usable facts for this user + title
  signal: AbortSignal,              // the whole 8s deadline, covering every retry below
): Promise<{ content: string; mode: FactMode }>   // mode = the prompt that produced content
// Model: env.OPENAI_MODEL. max_tokens 200; reply cleaned (trim, quotes, "Fun fact:" preamble)
// and capped at 450 chars (at a sentence end when close, else word boundary + "…").
// Transport: one retry on 429/5xx with 200–500ms jitter, at most once per call.
// Content: empty / < 20 chars / looksLikeRefusal() → one retry: grounded mode if a knowledge
// reply failed and details exist, else strictSystemPrompt(mode).
// Throws OpenAiError if both replies are unusable — a refusal is never returned.

export function looksLikeRefusal(text: string): boolean
// "I'm sorry", "I can't"/"I cannot", "I'm unable to", "as an AI", "language model",
// "training data", "knowledge cutoff", "as of my last update", "I don't have information",
// "beyond my knowledge/training", or the NO_FACT sentinel. Also used to skip stored refusals.

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

export type MovieDetails = {
  title: string; tagline: string | null; overview: string | null   // overview ≤ 1000 chars
  releaseDate: string | null; status: string | null                // "Released", "In Production", …
  runtimeMinutes: number | null; genres: string[]; directors: string[]
  cast: { name: string; character: string | null }[]               // top 5 by billing order
  productionCompanies: string[]                                    // ≤ 5
  keywords: string[]                                               // ≤ 10 TMDB tags, de-duplicated
}

export async function fetchMovieDetails(tmdbId: number): Promise<MovieDetails | null>
// /movie/{id}?append_to_response=credits,keywords, Bearer token, 3s timeout, Zod-validated.
// Never throws: missing key / timeout / HTTP error / bad body → null.

export function createMovieDetailsLoader(opts?: { ttlMs?; maxEntries?; now?; fetchDetails? }):
  (tmdbId: number) => Promise<MovieDetails | null>
// Per-process cache, 24h per tmdbId, max 1000 entries (oldest evicted).
// Concurrent callers share one in-flight request; null results are not cached.
export const getMovieDetails  // the default loader used by the fact service

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
  deps?: {
    clock?: Clock; openai?: typeof generateFact; prisma?: PrismaClient
    rateLimiter?: RateLimiter; movieDetails?: (tmdbId: number) => Promise<MovieDetails | null>
    knowledgeCutoff?: string        // default env.MODEL_KNOWLEDGE_CUTOFF
  },
): Promise<{ fact: Fact; stale: boolean }>
// On a cache miss, loads TMDB details (if tmdbId) BEFORE the advisory lock.
// Cache, avoid list and fallback all skip stored rows where looksLikeRefusal(content).
                              // throws AppErrorException: RATE_LIMITED | NO_MOVIE | UPSTREAM_FAILED

// lib/movie-service.ts
export async function saveMovieForUser(
  userId: string,             // from the session, never the request
  input: MovieSaveInput,      // { title, tmdbId?, year?, posterPath? }, already Zod-validated
  deps?: { prisma?: PrismaClient; search?: typeof searchMovies },
): Promise<Movie>             // throws AppErrorException(VALIDATION) when free text should be a pick

// lib/me.ts
export async function loadMe(userId: string, db?: PrismaClient): Promise<MeResponse | null>

// lib/http.ts (server)
export async function requireUserId(): Promise<string>   // auth(); throws UNAUTHORIZED
export async function handle(route: string, fn: () => Promise<NextResponse>): Promise<NextResponse>
                              // AppErrorException → its envelope; anything else → logged, 500 INTERNAL
export function jsonOk<T>(data: T): NextResponse         // { ok: true, data }, no-store
export function jsonError(error: AppError): NextResponse // { ok: false, error }, no-store, Retry-After on 429

// lib/api.ts (browser)
export async function apiFetch<S extends ZodTypeAny>(path: string, schema: S, init?: RequestInit): Promise<z.infer<S>>
export function getMe(signal?): Promise<MeResponse>
export function putMovie(body: MoviePutBody, signal?): Promise<MeResponse>
export function getFact(signal?): Promise<FactResponse>
export const searchMovies: (q: string, signal: AbortSignal) => Promise<MovieSearchResponse>
// Failures → AppErrorException:
//   401 → UNAUTHORIZED (even with no body)    429 → RATE_LIMITED (retryAfterMs from body or Retry-After)
//   server envelope → its code + message      500/HTML/malformed/schema mismatch/network → INTERNAL
//   AbortError → rethrown untouched

// lib/client-cache.ts (browser)
export const CLIENT_CACHE_TTL_MS = 30_000
export type CachedFact = { fact: FactResponse; fetchedAt: number; clockOffsetMs: number }
export const FACT_WINDOW_MS = 60_000                     // must match the server's CACHE_WINDOW_MS
export function windowEndsAt(fact, clockOffsetMs): number // generatedAt + 60s, in browser time
export function cacheExpiresAt(entry, ttlMs?): number     // min(fetchedAt + 30s, windowEndsAt(...))
export const STORAGE_PREFIX = "movie-memory:fact:v1:"
export function storageKeyOf(userId, movieTitle): string   // prefix + encodeURIComponent(userId) + ":" + encodeURIComponent(title)
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">
export function browserSessionStorage(): StorageLike | null   // null on the server or when access throws
export function createFactCache(opts?: { ttlMs?; storage?: () => StorageLike | null }): {
  get(userId, movieTitle, now?): CachedFact | null    // memory, then storage (Zod-validated); null and dropped
                                                      // once now ≥ cacheExpiresAt(entry) or if malformed
  set(userId, movieTitle, entry: CachedFact): void    // memory + storage
  deleteMovie(userId, movieTitle): void                // after a movie edit (memory + storage)
  clear(): void                                        // sign-out / 401: memory + all prefixed storage keys
}
// Stored value: { v: 1, userId, movieTitle, fact: FactResponse, fetchedAt, clockOffsetMs }.
// All storage access is try/catch → memory-only fallback; nothing is logged.
export const factCache   // the per-tab instance, backed by sessionStorage

// lib/use-fact.ts (browser)
export function useFact(options: {
  userId: string; movieTitle: string          // exact stored title: cache key
  onUnauthorized: () => void
  paused?: boolean                            // hold loads while a movie edit is saving
  cache?: FactCache; now?: () => number       // injectable for tests
}): {
  status: 'loading' | 'ready' | 'error'       // error = no fact and the last load failed
  fact: FactResponse | null                   // kept on screen while refreshing / after a failed refresh
  error: AppError | null                      // with a fact present: "showing the last fact"
  refreshing: boolean                         // auto or "New fact" load in flight
  nextAt: number | null                       // browser ms of the next automatic load
  sameFactWaitMs: number | null               // "New fact" got the same fact: ms until a fresh one
  clockOffsetMs: number                       // serverNow − browser time at receipt
  fallback: FactResponse | null               // expired fact held off screen during a late load
  manual: boolean                             // the load in flight was user-started
  newFact(): void                             // skips the client cache; replaces a slow auto load
  retry(): void                               // same as newFact
// The cache is read in a layout effect on mount (hydration-safe, before paint).
}
// nextAt = generatedAt + 60s − clockOffsetMs + 250ms; stale or failed → now + 30s
// (429 → now + retryAfterMs); same fact on an auto-load → at least now + 5s.
// The timer runs only while the tab is visible; becoming visible resyncs. One timer at a
// time, cleared and rescheduled on every new fact; auto-loads never read the client cache.
// A load more than LATE_LOAD_MS (1s) overdue hides an expired, unlabelled fact (skeleton)
// and keeps it as `fallback`, shown again with the stale hint only if that load fails.

// lib/use-page-visible.ts (browser)
export function usePageVisible(): boolean
export function useNow(active: boolean, intervalMs?: number, resyncKey?: unknown): number

// components/FactCard.tsx
export default function FactCard(props: {
  userId: string; movieTitle: string; displayTitle?: string; pending?: boolean
})
export function formatCountdown(ms: number): string   // 47_000 → "0:47"
export const OVERDUE_GRACE_MS = 2_000                  // "New fact" appears this long after 0:00 with no new fact
// Action button: "Try again" after a failed load; "New fact" on a stale fallback or when
// overdue; otherwise none.

// components/MovieHeroCard.tsx (client)
export default function MovieHeroCard(props: {
  userId: string
  movie: { title: string; tmdbId: number | null; year: number | null; posterPath: string | null }
})
// committed (server-confirmed) vs optimistic movie; FactCard keyed by committed.title.
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
  readonly status: number        // derived: HTTP_STATUS[error.code]
  constructor(public readonly error: AppError) { super(error.message) }
}

export const HTTP_STATUS: Record<AppError['code'], number> = {
  UNAUTHORIZED: 401, VALIDATION: 400, NOT_FOUND: 404, NO_MOVIE: 400,
  RATE_LIMITED: 429, UPSTREAM_FAILED: 502, INTERNAL: 500,
}
```

## API contracts (shared Zod schemas)

```ts
// lib/validation.ts
export const movieTitleSchema = z.string().trim().min(1).max(120)

// PUT /api/me/movie. Unknown keys (e.g. a client-sent userId) are stripped.
export const MoviePutBody = z.object({
  title:      movieTitleSchema,
  tmdbId:     tmdbIdSchema.nullish(),       // null/undefined = free text
  year:       yearSchema.nullish(),         // 1870–2100
  posterPath: posterPathSchema.nullish(),   // ^/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$
})

export const MeResponse = z.object({
  user:  z.object({ id: z.string(), name: z.string().nullable(), email: z.string(), image: z.string().nullable() }),
  movie: z.object({
    title: z.string(), tmdbId: z.number().nullable(), year: z.number().nullable(),
    posterPath: z.string().nullable(), updatedAt: z.string(),   // ISO
  }).nullable(),
})
export type MeResponse = z.infer<typeof MeResponse>

export const FactResponse = z.object({
  content:     z.string(),
  movieTitle:  z.string(),          // the title this fact was generated for
  generatedAt: z.string(),          // ISO
  serverNow:   z.string(),          // ISO server time at response; client clock correction
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
| PUT    | `/api/me/movie` | `MoviePutBody` (JSON)     | `Envelope<MeResponse>`                  | 401, 429 + `Retry-After` (20/min per user, counted before the body is read), 400 (VALIDATION + `fieldErrors`; non-JSON body; free text when TMDB has matches) |
| GET    | `/api/fact`     | (none — no `?force`)      | `Envelope<FactResponse>`                | 401, 400 (NO_MOVIE), 429 + `Retry-After`, 502 |
| GET    | `/api/facts/history` | `?limit=` (1–50, default 10; the dashboard always sends 5), `?cursor=` (a fact id) | `Envelope<FactHistoryResponse>` = `{ items: [{ id, movieTitle, content, createdAt }], nextCursor: string \| null }` | 401, 400 (VALIDATION: bad limit, malformed cursor, or a cursor that isn't one of the user's own facts), 429 + `Retry-After` |
| GET    | `/api/movies/search` | `?q=` (trim, 2–100)  | `Envelope<MovieSearchResponse>` (`degraded: true` when TMDB fails) | 401, 400 (VALIDATION), 429 |

All authed responses: `Cache-Control: no-store`.

## Module responsibilities (one line each)

- `lib/env.ts` — fail-fast env check at import; exports typed `env` object.
- `lib/auth.ts` — Auth.js v5 config with Google provider + Prisma adapter + DB sessions; exports `auth`, `handlers`, `signIn`, `signOut`.
- `lib/prisma.ts` — single `PrismaClient` across hot reloads.
- `lib/fact-prompt.ts` — pure prompt building: `chooseFactMode` (the knowledge vs grounded decision), `pickAngle` (per-mode angle lists), `systemPrompt` / `strictSystemPrompt` per mode (with the good/bad examples, `KNOWLEDGE_ACCURACY_RULE` and `GROUNDED_SOURCE_RULE`), `buildUserMessage`. No network or env, so it is unit-tested directly.
- `lib/openai.ts` constants: `FACT_TEMPERATURE = 0.4`, `MAX_TOKENS = 200`, `MAX_FACT_CHARS = 450`, `MIN_FACT_CHARS = 20`, `OPENAI_DEADLINE_MS = 8000`.
- `lib/openai.ts` — `generateFact(movie, avoid, signal)`: sends `systemPrompt(mode)` + `buildUserMessage(mode, …)` to `env.OPENAI_MODEL`, retries once on 429/5xx, retries once on an unusable reply (grounded fallback or strict prompt), never returns a refusal, and reports which mode produced the fact. Also exports `looksLikeRefusal` and `cleanFact`. No database access.
- `lib/tmdb.ts` — server-only (Bearer token). `getTrendingPosters()`: TMDB `/trending/movie/day`, `next: { revalidate: 86400 }`, `AbortSignal.timeout(3000)`; `string[]` of poster paths, `[]` on any failure. `searchMovies(q)`: `/search/movie`, same auth/timeout, `cache: "no-store"`, ≤6 Zod-validated results, `{ degraded: true }` on any failure. `getMovieDetails(tmdbId)`: `/movie/{id}?append_to_response=credits,keywords`, same auth/timeout, compact `MovieDetails` (overview, tagline, release date, status, runtime, genres, directors, top 5 cast, studios, up to 10 keywords), 24h in-memory cache per id with shared in-flight requests, `null` on any failure. Re-exports `posterUrl` from `lib/tmdb-image.ts`, which client components import instead.
- `components/MovieSearchCombobox.tsx` — WAI-ARIA combobox: 300ms debounce, `AbortController` per request, arrows/Enter/Escape, loading/no-results/degraded states. With `name`, renders hidden `tmdbId`/`year`/`posterPath` inputs for a server action; without it, reports via `onSelectionChange` (Stage 7 inline edit).
- `lib/lock.ts` — `withAdvisoryLock(tx, key, fn)`: sets `lock_timeout`, calls `pg_advisory_xact_lock`, runs `fn`, maps `55P03` → `LockTimeoutError`.
- `lib/rate-limit.ts` — in-memory sliding window; pure function with injectable `now`.
- `lib/logger.ts` — `pino` with `redact: ['email', 'user.email']`; `log.child({ event, userId, movieTitle, durationMs })`.
- `lib/clock.ts` — one-method interface so tests can advance time.
- `lib/fact-service.ts` — orchestrates: rate check → pre-check → tx+lock → re-check → openai → persist → fallback. Only file that knows the full flow.
- `lib/validation.ts` — Zod schemas used by both routes and the client wrapper.
- `lib/http.ts` — server-side route plumbing: `requireUserId()` (the auth guard), `handle()` (error → envelope, unknown → 500 `INTERNAL` without details), `jsonOk`/`jsonError` (always `no-store`). All authed routes are written as `handle(route, async () => { const userId = await requireUserId(); … })`. Any 500 in the JSON is a generic message; the real error is in the pino log (`api.unhandled_error`).
- `lib/me.ts` — `loadMe(userId)`: the one place that shapes `MeResponse`.
- `lib/fact-history.ts` — `getFactHistory(userId, { limit, cursor }, db?)`: resolves the cursor *scoped to the user* (unknown or foreign id → `VALIDATION` "Invalid cursor"), then reads `where userId [and (createdAt, id) < cursor]` ordered by `createdAt desc, id desc`, `take limit + 1`, in up to 5 batches, skipping `looksLikeRefusal` rows so pages stay full. `nextCursor` = the last returned id when more exist (or the last scanned row if the scan cap is hit), else `null`. Served by the `(userId, createdAt desc, id desc)` index.
- `components/FactHistory.tsx` — props `{ latestFactAt, pageSize? }` (`pageSize` defaults to `HISTORY_PAGE_SIZE` = 5, sent as `?limit=` on every request). Page 1 on mount; `Load more` appends with `cursor = nextCursor`; when `latestFactAt` changes and isn't already the newest item, refreshes page 1 and merges (dedupe by id; a non-overlapping page replaces the list). Router and callbacks are read through refs so identities never trigger refetches. 401 → clear fact cache, `/`. State lives only in the component (keyed by user in `MovieHeroCard`), never in storage.
- `FactCard` `onFactShown?(generatedAt)` — fired when the fact on screen changes; observe-only, used by `MovieHeroCard` to drive the history refresh.
- `lib/movie-service.ts` — `saveMovieForUser`: the save rules shared by the onboarding server action and `PUT /api/me/movie`.
- `lib/api.ts` — typed `fetch` wrapper; validates the `Envelope<T>` with the route's Zod schema; turns every failure into `AppErrorException` with a stable `code`; lets aborts through.
- `lib/use-fact.ts` — `useFact()`: renders a client-cache hit with no request; otherwise loads `/api/fact`. Schedules the next load at the end of the server's 60s window using `serverNow` for clock correction, only while the tab is visible; keeps the last fact on failure and retries after 30s; `newFact()` skips only the client cache. Calls `onUnauthorized` on 401. Remount (`MovieHeroCard` keys `FactCard` by the confirmed movie title) to switch movies.
- `lib/use-page-visible.ts` — `usePageVisible()` (Page Visibility API as state) and `useNow()` (a 1s clock that only ticks while active and resyncs on a new target).
- `components/MovieHeroCard.tsx` — the dashboard hero as a client component, so an edit can update title, year, poster and backdrop optimistically. Saves via `putMovie`; reverts and shows the server message on failure; drops the old title's cache entry on success; returns focus to the pencil.
- `lib/errors.ts` — the union above.
- `lib/client-cache.ts` — `Map<string, { fact, fetchedAt, clockOffsetMs }>` keyed by `userId:movieTitle`; a hit only while `now < min(fetchedAt + 30s, generatedAt + 60s)` with server-clock correction, so it can never return a fact past its server window (and never a `stale: true` one); mirrored to sessionStorage (Zod-validated on read, all access try/catch, memory-only fallback, no logging) so it survives a reload in the same tab; read and written by `useFact()`, cleared on sign-out (`DashboardNav`) and on a 401 (`FactCard`), and per movie on edit.

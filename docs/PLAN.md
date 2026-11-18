# Movie Memory — Plan (Base + Variant A + Variant B)

## Context

Take-home spec (`plan.pdf`) asks for a small Next.js + Postgres + Prisma + Google OAuth + OpenAI app with a required Base implementation and ONE of two variants. You've asked to implement **both** variants on top of Base, matching your stated preferences: Auth.js v5, Vitest + RTL, local dev with optional Vercel deploy (so the per-user lock must be DB-backed by default, with in-memory noted as a single-instance fallback). The product is "Movie Memory": sign in with Google → pick a favorite movie → view a fun fact about it that refreshes on a 60s server cadence.

The deliverable is a **plan only**, plus seven short decision-focused docs under `/docs` written **before any code** once you approve, a short `CLAUDE.md` at the repo root for future sessions, and two post-code docs (`docs/AI_USAGE.md`, `docs/DECISIONS.md`) you'll edit before submission. The plan file (this file) is also copied to `docs/PLAN.md` at the end.

## Stack decisions (locked)

- Next.js 16 App Router (current stable as of Nov 2026 — note `middleware.ts` is now `proxy.ts`), TypeScript strict, Tailwind v3 (v4 config changes are too churny for a 3-hour build)
- Auth.js v5 (`next-auth@beta`), Google provider, Prisma adapter, database sessions
- Postgres 16 via `docker-compose.yml` for local; `DATABASE_URL` env swappable to Neon/Supabase for Vercel
- Prisma 5, `prisma migrate dev` for schema evolution
- OpenAI SDK, `gpt-4o-mini`, **8s total deadline (AbortSignal covering the one retry)** — deliberately set **below** the Postgres `lock_timeout` so a waiting request never times out before the lock holder finishes; retry only on 429 and 5xx (max 1 retry with jitter), `max_tokens` capped (~120), fixed prompt template with movie title passed as **data** (not interpolated instructions) plus a list of recent fact snippets so the model is asked for something different
- Vitest + React Testing Library, `node` env for service tests, `jsdom` for component tests, **injectable clock** (`Clock` interface defaulted to `Date.now`) so the 60s window can be advanced in tests without timers
- **Minimal `proxy.ts` (formerly `middleware.ts`) — UX only, not security** — `proxy.ts` matches `/dashboard/:path*` and `/onboarding/:path*` and redirects to `/` if the Auth.js session cookie is absent. It **does not verify the session** (DB session lookups aren't available in Edge anyway); it only avoids rendering a protected page just to bounce. The real protection stays in server components and route handlers via `auth()`. Auth.js v5 docs explicitly endorse this split: "verify the session as close to your data fetching as possible."
- **Structured logging via `pino`** — JSON output, redact PII (email), include `userId`, `movieTitle`, request id, and a stable `event` key. Fact-generation events: `fact.cache_hit`, `fact.cache_miss`, `fact.lock_wait_start`, `fact.lock_acquired`, `fact.lock_wait_timeout`, `fact.openai_call`, `fact.openai_fallback`, `fact.stale_served`, `fact.rate_limited`. Each includes `durationMs`.
- **Zod-validated env at startup** — `lib/env.ts` parses `process.env` once with a Zod schema (`DATABASE_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OPENAI_API_KEY`, `NODE_ENV`). `TMDB_API_KEY` is **optional** (`.optional()`) — when absent, poster lookup is silently skipped and the gradient fallback is shown. Any required missing or malformed var throws at import time. Only `NEXT_PUBLIC_*` keys are allowed on the client side; the schema whitelist enforces this.
- **Per-user rate limit on `/api/fact`** — in-process sliding window (`Map<userId, number[]>`) with the same honest single-instance caveat as the in-memory lock fallback: swap for Upstash Redis in production. Default: **30 requests per 60s per user**. Exceeded → `429` with `{ ok: false, error: { code: 'RATE_LIMITED', retryAfterMs } }` and `Retry-After` header.
- **React error boundaries** — route-level `error.tsx` per segment (`app/dashboard/error.tsx`, `app/onboarding/error.tsx`) plus a `app/global-error.tsx`. A FactCard failure should not take down the sidebar or hero card — the FactCard sits in its own `<ErrorBoundary>` with a retry CTA.
- **CI via GitHub Actions** — `.github/workflows/ci.yml`: Node 20, pnpm, Postgres service container, `prisma generate`, `tsc --noEmit`, `vitest run`, `eslint .` (Next.js 16 removed the `next lint` wrapper; ESLint 9 flat config is now the direct path). Runs on PR and `main`. The lock test runs against the service container so CI exercises the real concurrency path.
- Zod for input validation at every route boundary
- Font: Inter via `next/font` (Geist is fine too; Inter is one less install)

## Requirements checklist (spec → implementation)

**Base**
- [ ] `/` landing with "Sign in with Google" when unauth; redirects elsewhere when auth
- [ ] First-time Google users → `/onboarding`; returning users → `/dashboard`
- [ ] Onboarding: server-trimmed, length-validated favorite movie, stored per-user
- [ ] Dashboard shows name, email, photo (with initials fallback), favorite movie, logout
- [ ] `/dashboard` unauthenticated → redirect to `/`
- [ ] Fact card calls OpenAI, stores each generated fact
- [ ] Movie poster fetched from TMDB on save/edit, path stored in `Movie.posterPath`; shown on dashboard hero card; gradient fallback when TMDB is unavailable or finds no match

**Variant A (backend)**
- [ ] 60s server cache: return latest fact if `createdAt > now - 60s`, else regenerate (injectable clock, not `Date.now` directly in the service)
- [ ] Burst protection via blocking `pg_advisory_xact_lock`, **10s `lock_timeout` (> OpenAI deadline)**, 20s Prisma transaction timeout, cache re-check after lock acquire; in-memory `Map` fallback documented for single-instance
- [ ] OpenAI failure → return most recent stored fact, else `UPSTREAM_FAILED` error
- [ ] Vitest tests: cache window (clock-advanced), lock behavior (real docker Postgres + mocked OpenAI), authorization scoping

**Variant B (frontend)**
- [ ] `GET /api/me`, `PUT /api/me/movie`, `GET /api/fact` with shared typed contracts, all `Cache-Control: no-store`
- [ ] `lib/api.ts` typed fetch wrapper, normalized error shape
- [ ] Inline movie edit: Save/Cancel, optimistic update, revert on failure
- [ ] 30s **in-memory** client cache keyed by `${userId}:${movieTitle}`, cleared on logout and movie change, bypassed by the explicit "New fact" action (which simply skips the client cache — the server still enforces its own 60s window)
- [ ] Vitest tests: client 401/500 normalization, edit flow optimistic + revert

**Security (all)**
- [ ] Server-side validation for every mutation
- [ ] Every query scoped by `userId` from the session (never trust client-supplied ids)
- [ ] Secrets (Google, OpenAI, DB) server-only; no `NEXT_PUBLIC_` leaks (enforced by Zod env schema)
- [ ] Graceful fallback for missing Google name/photo
- [ ] Per-user rate limit (30 req / 60s) on `/api/fact`
- [ ] Zod env validation on startup
- [ ] Route-level error boundaries + `global-error.tsx`
- [ ] Structured logging (`pino`) with PII redaction
- [ ] GitHub Actions CI: typecheck + lint + unit/component tests + lock test against Postgres service

## Build order (stages)

1. **Scaffold** — Next.js 16 app, Tailwind tokens, `prisma init`, docker-compose Postgres, `.env.example`, `lib/env.ts` (Zod), `lib/logger.ts` (`pino`)
2. **Auth** — Auth.js v5 with Google + Prisma adapter + DB sessions; root `/` router logic; `auth()` in server components / handlers as the real guard; minimal `proxy.ts` for cookie-presence redirect on `/dashboard` and `/onboarding`
3. **Data model + onboarding** — Prisma schema, migration, `/onboarding` server action with Zod
4. **Dashboard shell** — layout, Sidebar/TopBar, Avatar with initials, MovieHeroCard with poster slot (`PosterImage` — `next/image` from stored path, or gradient film-frame fallback; read-only first), FactCard skeleton, `app/dashboard/error.tsx` + `app/global-error.tsx`
5. **Fact service (Base)** — `lib/fact-service.ts` with generate-on-request + DB persist, structured log events wired
6. **Variant A upgrade + TMDB dashboard poster** — layer 60s cache check + blocking advisory lock + OpenAI fallback + per-user rate limit into the same service; extend `lib/tmdb.ts` with `fetchPosterPath(title)` (TMDB `/search/movie` endpoint, same `TMDB_API_KEY` Bearer token, 3s `AbortSignal.timeout`, returns `null` on any failure); call `fetchPosterPath` inside the onboarding and movie-edit server actions, write result into `Movie.posterPath`; note: `lib/tmdb.ts` is already created (with `getTrendingPosters()` and `posterUrl()`) from Stage 10 — Stage 6 only adds the search function
7. **Typed API layer (Variant B)** — `/api/me`, `/api/me/movie`, `/api/fact` with shared Zod schemas and `lib/api.ts` client, `Cache-Control: no-store` on all authed responses
8. **Inline edit + client cache (Variant B)** — optimistic edit, 30s in-memory client cache, countdown, FactCard error boundary with retry
9. **Tests + CI** — Vitest suites + `.github/workflows/ci.yml` (typecheck + lint + tests + Postgres service for lock test)
10. **Polish + README** — states, focus rings, docs, screenshots, AI-usage note; premium landing page: animated TMDB trending poster wall (`PosterBackground` — 3 marquee rows, `clamp(120px, 11vw, 210px)` poster height, 4-layer overlay, `getTrendingPosters()` with 24 h revalidate), multi-section layout with `ScrollFade` scroll animations, `FactCarousel` (swipe/keyboard/arrow nav), `MockCardPreview`; "Data from TMDB" footer credit on the landing page (conditional on poster data)

## Key design decisions

**Why both server 60s cache *and* client 30s cache**
The server cache is the **cost and correctness** guarantee (one OpenAI call per user per minute, at most). The client cache is a **UX** guarantee (don't refetch on every mount/navigation within 30s). They do not conflict: the client cache sits in front of a request that would have hit a warm server cache anyway. The explicit "New fact" action **only bypasses the client cache** — it makes a normal `GET /api/fact` call. The server always makes its own 60s decision, so clicking "New fact" within the server window returns the same fact; the UI shows the countdown so the user understands when a truly new fact becomes available. No `?force` query param — fewer footguns, and the server always has the last word on cost.

**Why DB advisory lock, not in-memory Map**
In-memory only protects a single process. Vercel's serverless runtime and any multi-instance deploy break it silently. **Blocking** `pg_advisory_xact_lock(hashtext('fact:' || $userId))` inside a Prisma `$transaction` is correct and simpler than try-lock polling: a concurrent request waits on Postgres, then re-checks the 60s cache after acquiring the lock and almost always serves the just-written row with zero additional OpenAI calls. **The three timeouts are intentionally layered** (`OpenAI 8s < lock_timeout 10s < tx timeout 20s`) so a waiting request never times out before the lock holder finishes writing — if it did, the waiter would miss the just-written row and either generate a redundant fact or 500 for no reason. `SET LOCAL lock_timeout = '10s'` surfaces a truly stuck lock as a Postgres error we can catch; `$transaction({ timeout: 20000, maxWait: 5000 })` is the final ceiling. The lock auto-releases on commit/rollback. In-memory stays documented as the single-instance fallback for completeness.

**Why `movieTitle` snapshot on Fact (not FK to Movie)**
The 60s cache lookup is "latest fact for this user **and this movie title**." If a user edits their movie, past facts shouldn't be served for the new title. Snapshotting the title on Fact makes that invariant automatic — index is `(userId, movieTitle, createdAt desc)` — and makes Variant B's "invalidate on movie change" a natural consequence of the query, not a separate cleanup step.

**Why Auth.js database sessions (not JWT)**
`auth()` in server components needs a cheap session lookup. DB sessions give instant revocation (logout kills the row) and no secret handling for session encoding. The Prisma adapter wires the User/Account/Session tables automatically.

## OpenAI invocation (fixed-shape prompt)

- System: "You write one-sentence fun facts about a given movie. Keep it factual, PG, under 240 chars. Do not repeat any of the avoid list."
- User message is a JSON object (data, not instructions) so the title cannot hijack the prompt:
  ```json
  { "movie": "<title>", "avoid": ["<recent fact 1>", "<recent fact 2>", "<recent fact 3>"] }
  ```
- `max_tokens: 120`, `temperature: 0.8`, single `AbortSignal` with an **8s total deadline** that covers the retry too. **Invariant: OpenAI deadline < Postgres `lock_timeout`** so a waiter always outlasts the holder's OpenAI call.
- Retry **once**, with jitter (200–500ms), only on HTTP 429 or any 5xx; any other error short-circuits to the fallback.
- "Avoid" list is the last N (=3) stored facts for `(userId, movieTitle)` — this nudges variety without a hard uniqueness check.

## Tests (concrete)

- `fact-service.test.ts` — **cache window** with a `Clock` fake: generate at t=0, call again at t=59s → no OpenAI call, same content; advance to t=61s → OpenAI called, new row written.
- `fact-service.test.ts` — **fallback** with OpenAI mock throwing and a prior fact present → returns the prior; with no prior fact → `UPSTREAM_FAILED` error.
- `fact-lock.test.ts` — **real docker Postgres** (CI boots via `docker compose up -d` or a `pg` test container), mocked OpenAI with a 200ms delay; fire 10 concurrent `Promise.all` requests → exactly one OpenAI call, all requests return the same fact id. This is the only test that touches a real DB; the rest mock Prisma.
- `fact-authz.test.ts` — seed facts for user A; call the fact route handler with a session for user B → cannot read A's content (query is scoped by `userId` from session, not body/query).
- `api-client.test.ts` — `fetch` mocked to return 401, 500, and a malformed body → typed `AppError` with correct `code` surfaces in each case.
- `movie-edit.test.tsx` — RTL: click edit → type → Save; assert optimistic UI change before the mock resolves; make the mock reject → assert revert to previous title and error toast.
- `rate-limit.test.ts` — 31st request within 60s returns 429 with `retryAfterMs`; after clock advance beyond window, allowed again.
- `env.test.ts` — missing `OPENAI_API_KEY` → import of `lib/env.ts` throws with a readable message naming the missing key.
- `tmdb.test.ts` — covers `getTrendingPosters` (the landing page wall function): (a) successful response with mixed null/non-null `poster_path` → returns only the non-null strings; (b) unexpected response shape (missing `results` key) → returns `[]`; (c) `fetch` rejects (network error) → returns `[]`; (d) `TMDB_API_KEY` absent → returns `[]` and `fetch` is never called; (e) non-OK HTTP status (500) → returns `[]`. All cases use `vi.stubGlobal('fetch', ...)`; none hit the real TMDB API. Future: add parallel cases for `fetchPosterPath` (Stage 6 dashboard poster).

**`vitest.setup.ts`** sets dummy values for every required env var (`DATABASE_URL=postgres://test`, `AUTH_SECRET=test`, `GOOGLE_CLIENT_ID=test`, `GOOGLE_CLIENT_SECRET=test`, `OPENAI_API_KEY=test`, `NODE_ENV=test`) before any test module is imported, so `lib/env.ts` doesn't throw during normal test runs. `env.test.ts` is the one suite that deliberately deletes a key via `vi.resetModules()` + `delete process.env.X` and re-imports to prove the startup check works.

## Risks

- **Auth.js v5 release state** — pin the exact version at build time (stable or latest beta as of install date); callback shapes have shifted across releases. Link the matching docs in the README.
- **OpenAI rate/latency** — 8s total deadline (AbortSignal covering the one retry) + fallback to the most recent stored fact covers most cases; the "no prior fact + OpenAI down" path is the user-friendly error state.
- **Timeout ordering is a correctness invariant.** `OpenAI 8s < lock_timeout 10s < tx timeout 20s` — if anyone reorders these during maintenance so `lock_timeout ≤ OpenAI deadline`, waiters will start erroring just before the holder would have served them. This is called out in a comment in `lib/fact-service.ts` and tested implicitly by `fact-lock.test.ts`.
- **Vercel cold start + advisory lock** — lock is held only for the OpenAI call duration (up to 8s); cold start adds latency but not correctness risk. Document.
- **Tailwind v3 vs v4** — pinning v3 avoids the v4 CSS-first config migration mid-build.
- **Two variants in a 3-hour budget** — the overlap (service layer serves both) keeps scope manageable, but testing both surfaces is where time can slip. Prioritize the four highest-signal tests (cache, lock, authz, edit-revert) and add more only if time remains.

## Docs to produce (after approval, before any code)

All under `/docs`, short and decision-focused:

1. **PLAN.md** — copy of this plan
2. **ARCHITECTURE.md** — component tree + request flows (login, onboarding, dashboard load, fact generation with cache/lock/fallback), written as prose with an explicit box-and-arrow list so you can draw a diagram
3. **DATA_MODEL.md** — the Prisma schema below with indexes and the reasoning per table/column
4. **LLD.md** — file tree, module responsibilities, key function signatures, `AppError` discriminated union, request/response Zod schemas for the three API routes
5. **CONCURRENCY.md** — step-by-step of a fact request: client cache check → server cache check → advisory lock → double-check → OpenAI → persist → release; failure branches and how the explicit "New fact" button threads through
6. **TEST_PLAN.md** — one row per test: name, what it proves, spec line it covers
7. **UI_SPEC.md** — pages, component inventory, loading/error/empty/missing-photo states, the design tokens you provided, interaction timings

After the seven docs land, write a short **`CLAUDE.md`** at the repo root (< 40 lines) so future sessions can skip re-exploring the code:
- Stack line (Next.js 16 App Router, TS, Prisma 5 + Postgres, Auth.js v5, OpenAI, Vitest, Tailwind v3)
- Commands: `pnpm dev`, `pnpm test`, `pnpm prisma migrate dev`, `pnpm lint`, `docker compose up -d`
- Folder structure, one line each (`app/`, `components/`, `lib/`, `prisma/`, `tests/`, `docs/`)
- Key rules: OpenAI is server-side only; fact generation uses a blocking Postgres advisory lock + 60s cache; every mutation has server-side Zod validation; every query is scoped to the session's `userId`; no secrets in client code; `auth()` is the real guard (proxy.ts is UX only)
- UI tokens: one-line pointer to `docs/UI_SPEC.md` for the dark palette and typography
- Working rules: build in the stages listed in `docs/PLAN.md`; keep answers brief; read `docs/` instead of re-exploring the repo; run `pnpm test` after each stage

After `CLAUDE.md`, write two more docs for the submission (both **first-person**, both **under one page**, both authored as **stubs you'll edit before submitting**):

**`docs/AI_USAGE.md`** — bullets only, first person. Template to populate:
- I used Claude Code for planning, writing the docs under `docs/`, and implementing the app in stages.
- I used a separate Claude chat to review the plan and challenge the design before any code was written.
- I set the scope (Base + both variants), chose the stack specifics (Auth.js v5, Vitest, Next.js 16), and picked the deployment posture (local-first, Vercel-ready).
- I pushed back on the initial design in several places — see `docs/DECISIONS.md` — and decided what to keep, what to simplify, and what to defer.
- I reviewed the generated schema, the fact-service concurrency logic, and the API contracts by hand before accepting.
- I verified behavior by running `pnpm test` (all seven suites) and by exercising the app manually per the verification plan in `docs/PLAN.md`.

**`docs/DECISIONS.md`** — one short entry per decision: *decision*, *why*, *what I considered*. Items to cover (pre-populated from this planning session):
- **Database sessions over JWT** — chose DB sessions for instant revocation and simpler callbacks; accepted the per-request `Session` lookup; documented a cache / short-JWT upgrade path.
- **`auth()` at the data boundary; `proxy.ts` is UX-only** — the proxy does cookie-presence redirects without verifying the session; the real guard is `auth()` in server components and route handlers. Matches the current Auth.js v5 recommendation.
- **Layered timeouts: OpenAI 8s < lock_timeout 10s < tx timeout 20s** — each outer layer must be strictly greater than the inner, so a waiting request always outlasts the lock holder's OpenAI call. If this ordering is broken (e.g. `lock_timeout` ≤ OpenAI deadline), waiters time out just before the holder would have served them a fresh row — defeating the lock. Called out as a correctness invariant in both the code and `docs/CONCURRENCY.md`.
- **Dropped `?force` from `GET /api/fact`** — the server always decides freshness via the 60s window. The explicit "New fact" action only skips the 30s client cache. Fewer footguns, server has the final word on cost.
- **Client cache is in-memory only, keyed by `userId:movieTitle`** — no `localStorage`; cleared on logout and on movie change. Keeps shared-device staleness/privacy issues out of scope.
- **Lock-wait timeout serves stale rather than 500-ing** — on `55P03` we return the most recent stored fact with `stale: true`; we only error when there's no prior fact at all.
- **Blocking advisory lock, not try-lock polling** — simpler, correct, and avoids the thundering-herd pattern on cache miss.
- **Both variants implemented** — the service layer naturally serves both; the overlap kept scope manageable.

## Data model (preview — full reasoning in DATA_MODEL.md)

```prisma
// Auth.js standard tables (User, Account, Session, VerificationToken) via Prisma adapter.
// Augmentations below.

model User {
  id        String   @id @default(cuid())
  name      String?
  email     String   @unique
  image     String?
  createdAt DateTime @default(now())
  movie     Movie?
  facts     Fact[]
  accounts  Account[]
  sessions  Session[]
}

model Movie {
  id         String   @id @default(cuid())
  userId     String   @unique            // one-to-one; simpler than list
  title      String                      // trimmed, 1..120
  posterPath String?                     // TMDB poster path e.g. /abc123.jpg; null = use gradient fallback
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Fact {
  id         String   @id @default(cuid())
  userId     String
  movieTitle String                      // snapshot — survives title edits
  content    String
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, movieTitle, createdAt(sort: Desc)])
}
```

## File tree (preview — full in LLD.md)

```
app/
  layout.tsx
  page.tsx                     // landing + session-based redirect
  global-error.tsx             // last-resort error UI
  onboarding/page.tsx          // server component + server action
  onboarding/error.tsx
  dashboard/page.tsx           // server component composition
  dashboard/error.tsx          // FactCard failures stay local to this segment
  api/
    auth/[...nextauth]/route.ts
    me/route.ts                // GET
    me/movie/route.ts          // PUT
    fact/route.ts              // GET (server always decides freshness)
components/
  Sidebar.tsx  TopBar.tsx
  Avatar.tsx                   // initials fallback
  MovieHeroCard.tsx            // inline edit
  PosterImage.tsx              // next/image from posterPath or gradient film-frame fallback
  FactCard.tsx                 // countdown + New fact
  Skeleton.tsx  SignInButton.tsx
  PosterBackground.tsx         // server — landing page 3-row marquee poster wall
  ScrollFade.tsx               // client — IntersectionObserver fade-in wrapper
  FactCarousel.tsx             // client — landing page sample fact carousel
  MockCardPreview.tsx          // client — landing page animated dashboard preview
lib/
  env.ts                       // Zod-validated process.env, throws at import; TMDB_API_KEY optional
  auth.ts                      // Auth.js v5 config, auth() export
  prisma.ts                    // singleton
  openai.ts                    // client + 8s AbortSignal + retry-on-429/5xx
  tmdb.ts                      // getTrendingPosters(): landing wall, Bearer token, 24 h revalidate, returns []; posterUrl(path, size): URL helper; fetchPosterPath(title): dashboard search, returns null (Stage 6)
  fact-service.ts              // cache check + lock + generate + fallback + logs
  lock.ts                      // blocking pg_advisory_xact_lock + in-mem fallback
  rate-limit.ts                // per-user sliding window (in-mem; swap for Redis)
  logger.ts                    // pino instance with PII redaction
  clock.ts                     // Clock interface (default Date.now, overridable in tests)
  validation.ts                // Zod schemas shared by routes and client
  api.ts                       // typed fetch wrapper (Variant B)
  errors.ts                    // AppError discriminated union
  client-cache.ts              // 30s in-memory fact cache (React context)
prisma/
  schema.prisma
  migrations/
tests/
  fact-service.test.ts         // cache window (clock fake) + fallback
  fact-lock.test.ts            // concurrency test against docker Postgres
  fact-authz.test.ts           // user A cannot read user B's fact
  rate-limit.test.ts           // sliding window boundaries
  env.test.ts                  // missing env var throws at import
  api-client.test.ts           // 401/500 normalization
  movie-edit.test.tsx          // optimistic + revert
  tmdb.test.ts                 // TMDB success, no result, fetch failure, timeout fallback
proxy.ts                       // UX-only cookie-presence redirect (no session verify)
vitest.setup.ts                // dummy env vars so tests can import lib/env.ts
eslint.config.js               // ESLint 9 flat config (Next 16 has no `next lint`)
.github/workflows/ci.yml       // typecheck + lint + tests + Postgres service
docker-compose.yml
.env.example
CLAUDE.md                      // written last; see "Project memory" below
README.md
```

## Concurrency flow (preview — full in CONCURRENCY.md)

GET `/api/fact` (response always sent with `Cache-Control: no-store`):
1. `auth()` in the route handler → 401 if no session.
2. **Rate limit check**: `rateLimit.consume(userId)` — if exceeded, log `fact.rate_limited`, return 429 with `retryAfterMs`.
3. Load user's current movie title → 400 if none (frontend should have routed to onboarding).
4. **Cheap pre-check (no lock)**: read latest fact for `(userId, movieTitle)`. If `createdAt > now()-60s`, log `fact.cache_hit`, return immediately — the common path never enters a transaction.
5. Log `fact.cache_miss`, log `fact.lock_wait_start`, then begin `prisma.$transaction({ timeout: 20_000, maxWait: 5_000 })`:
   - `SET LOCAL lock_timeout = '10s'` — **must exceed the OpenAI 8s deadline** so a waiter always outlasts the holder.
   - `SELECT pg_advisory_xact_lock(hashtext('fact:' || $userId))` — **blocking**; a concurrent writer makes us wait, not spin. On success log `fact.lock_acquired` with `durationMs` = wait time.
   - **Re-check the cache inside the transaction**: read latest fact again. If now < 60s old, log `fact.cache_hit` (post-lock) and return it (the request we waited on just wrote it) — this is the critical correctness step and the main reason burst protection works.
   - Else log `fact.openai_call`, call OpenAI with the 8s `AbortSignal` deadline and the fixed prompt (movie title + last 3 fact snippets as "avoid these"), retry once on 429/5xx with jitter.
   - INSERT new Fact, return it.
6. **OpenAI error branch** (inside the locked path): log `fact.openai_fallback`; return the most recent stored fact for `(userId, movieTitle)` if any; else `UPSTREAM_FAILED` (502-shape). Advisory lock auto-releases at transaction end.
7. **Lock-wait timeout branch** (`55P03 lock_not_available` from Postgres — holder is genuinely stuck or an upstream backpressure event): log `fact.lock_wait_timeout`, exit the transaction, then return the most recent stored fact for `(userId, movieTitle)` even if it is older than 60s. Only if no fact exists at all do we return `UPSTREAM_FAILED`. Serving stale is far better than 500-ing a real user because the guy ahead of them timed out.
8. Response body includes `generatedAt` ISO timestamp so the client can compute its own 30s TTL and the next-refresh countdown. When a stale fact is served (step 7), the response sets a boolean flag `stale: true` so the FactCard can show a subtle "showing last available fact" hint — but the countdown still runs from `generatedAt`.

Client (Variant B): `useFact()` hook keeps `{ fact, generatedAt, stale }` in an **in-memory `Map` keyed by `${userId}:${movieTitle}`** (React context, no `localStorage` — the spec doesn't require persistence and keeping it in memory sidesteps staleness/privacy on shared devices). On mount: if `age < 30s` and the key matches → use cached. On successful `PUT /api/me/movie` → delete the entry for the old title. On logout → clear the entire Map. On "New fact" click → skip the client-cache check and `GET /api/fact`; the server returns either a newly-generated fact or the same cached one, and the UI shows the countdown until `generatedAt + 60s` either way.

**FactCard loading UI**: whenever a fetch is in flight and there is no cached fact to show (first mount, after movie change, or after an explicit "New fact" click that will take a visible moment), the card renders a **skeleton loader** — a rounded-2xl surface with two shimmering text lines and a muted countdown placeholder. Transitions respect the 150–200ms tokens. If the server response carries `stale: true`, the card renders the content normally plus a subtle muted line ("showing last available fact") beneath it.

## Verification plan

- `docker compose up -d` + `pnpm prisma migrate dev` + `pnpm dev` → open `http://localhost:3000`
- Manual: sign in with Google → redirected to `/onboarding` on first login → submit movie → dashboard shows name/email/photo/movie + a fact card → wait, click "New fact" within 60s and confirm no new call (countdown visible) → wait 60s and click again → new fact
- Manual: edit movie inline → fact card invalidates and regenerates on next tick
- Manual: sign out → `/dashboard` redirects to `/`
- Manual: open two tabs, click "New fact" simultaneously → single OpenAI call (log inspection)
- Manual: stub `OPENAI_API_KEY=invalid` → see cached fallback, or user-friendly error if no prior fact
- Automated: `pnpm test` runs all Vitest suites — `fact-service`, `fact-lock` (real Postgres), `fact-authz`, `rate-limit`, `env`, `api-client`, `movie-edit`
- Missing-photo check: sign in with a Google account without an image (or null it in DB) → initials avatar renders

## README tradeoffs to call out explicitly

- **`GET /api/fact` writes data.** It's a GET because the client treats it as "give me the current fact," but on cache miss it generates and persists one. Mitigation: `Cache-Control: no-store` on the response (and all authed endpoints) so no browser/CDN caches it, and the 60s server window + advisory lock bound write amplification. An alternative would be `POST /api/fact`, but the ergonomics for the client (and a hypothetical shareable URL later) are worse.
- **Fact table growth.** One row per generation per user. At steady state (60s cadence, active hour) that's ~60 rows/user/hour — fine for a take-home, not forever. Future work: a rolling-window retention job (keep last N per user+movie, or TTL > 30 days).
- **Per-user rate limit is implemented** (30 req / 60s on `/api/fact`) via an in-process sliding window. The honest caveat: it's per-instance, matching the in-memory lock fallback posture — swap in Upstash Redis for a horizontally scaled deployment. The DB-backed advisory lock already bounds OpenAI cost across instances, so the rate limiter's job is primarily protecting the route from abuse volume, not protecting the OpenAI budget.
- **Advisory lock keyspace is `hashtext('fact:' || userId)`.** 32-bit hash → collisions are astronomically unlikely in practice but not impossible; a collision would only cause an unrelated user to briefly wait, never a data integrity issue.
- **Google photo URLs can rotate.** Stored `User.image` can 404 later; the initials fallback handles this at render time without a separate migration.
- **The OpenAI call holds a DB transaction and a connection open.** The advisory lock currently brackets the whole OpenAI call, which means the Postgres connection and the transaction are held for the full 8s deadline on a cache miss. Fine at this scale, but at higher concurrency this would exhaust the connection pool. **Future fix: claim-row approach** — INSERT a `Fact` row with `status = 'pending'` under the lock, commit immediately (releasing the connection + lock), call OpenAI outside any transaction, then `UPDATE` the row with the content. Other requests serve the pending row's stub or wait on a short channel until it's filled. More moving parts, but the connection + lock are held for milliseconds instead of seconds.
- **Lock-wait timeout serves stale rather than erroring.** If Postgres returns `55P03 lock_not_available` after the 10s `lock_timeout` (meaning the holder is genuinely stuck, not just slow — the deadlines are tiered so this shouldn't happen under healthy conditions), we return the most recent stored fact with `stale: true` instead of a 500. The reasoning: a visitor who's done nothing wrong should see *something*. The only time we 500 is when there's no prior fact at all for that `(userId, movieTitle)` — a strictly worse user experience than a slightly stale sentence.
- **Database sessions trade one DB lookup per request for instant revocation.** We pay a cheap `SELECT` on `Session` on every authed request. In return, logging out, deleting a device, or rotating keys takes immediate effect — JWT sessions can't revoke without extra bookkeeping. At scale this cost becomes the single hottest query on the server. **Future options:** add a short-lived in-memory session cache (e.g., 30s LRU) keyed by session token, or move to short-lived JWTs (15 min) backed by a refresh endpoint so revocation latency is capped at the token lifetime.

## What I will NOT do

- No copied branding from `ui.png` (used for mood/layout only)
- No feature flags, no backwards-compat shims (greenfield)
- No comments explaining what well-named code already says
- No README features beyond what the spec asks for
- No e2e tests (Playwright) — out of scope for the chosen test stack

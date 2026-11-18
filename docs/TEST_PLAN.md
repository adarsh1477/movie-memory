# Test Plan

Vitest + React Testing Library. 17 suites today (270 tests), plus 1 still to come. Three suites run against the real Docker Postgres; everything else mocks Prisma, `auth()`, OpenAI, TMDB or `fetch`.

Run: `pnpm test` (about 21s, mostly the 7s and 11s lock tests). Skip the Postgres suites with `SKIP_PG_TESTS=1`; point them elsewhere with `PG_TEST_URL`. They only touch users they create and delete them afterwards.

## `vitest.setup.ts`

Sets dummy values for every required env var **before any test file is imported**, so `lib/env.ts` (which throws at module import if any var is missing) doesn't fail every suite. It also clears `OPENAI_MODEL` so every suite sees the default model. `env.test.ts` is the one place that deliberately resets modules and re-imports with vars changed or removed, to prove the startup check works.

## Test matrix

| # | Suite | What it proves | Spec line |
|---|-------|----------------|-----------|
| 1 | `fact-service.test.ts` | 60s window: t=0 then t=59s → same fact, one OpenAI call | Variant A §1 "60-Second Cache Window" |
| 2 | `fact-service.test.ts` | 60s window: t=61s → new row written | Variant A §1 |
| 3 | `fact-service.test.ts` | Re-check inside the lock serves a row written while waiting; no OpenAI call | Variant A §2 |
| 4 | `fact-service.test.ts` | OpenAI fails + prior fact → prior with `stale: true`; no prior → `UPSTREAM_FAILED` | Variant A §3 "Failure Handling" |
| 5 | `fact-service.test.ts` | Lock timeout (55P03) → stale fact, or `UPSTREAM_FAILED`; other DB errors rethrown | Variant A §2–3 |
| 6 | `fact-service.test.ts` | Avoid list = last 10 facts for this user + exact title; year passed to OpenAI | Variant A; fact quality |
| 6c | `fact-service.test.ts` | Mode chosen in code (knowledge for old released / free text / TMDB down; grounded for unreleased or after the configured cutoff); angle rotates by this user's fact count for this exact title | Fact quality |
| 6d | `fact-prompt.test.ts` | `chooseFactMode` boundaries (cutoff day, missing status/date, future "Released"); 7 angles rotate and wrap; both prompts demand surprising facts, forbid credit lists / plot summaries / refusals, carry 2 good + 2 bad examples; mode-specific instructions; knowledge sends only identifying TMDB fields; **grounded source rule** is in the grounded prompt and its retry (not in knowledge), names every allowed TMDB field, forbids location / effects / CGI / budget / behind-the-scenes / production-trouble claims unless in the data, says what to do with thin data; grounded mode carries no behind-the-scenes examples and ignores unsupported angles | Fact quality |
| 6a | `fact-service.test.ts` | TMDB details fetched by `tmdbId` **before the lock**, passed to OpenAI; skipped for free text and cache hits; TMDB failure still generates | Fact grounding |
| 6b | `fact-service.test.ts` | Stored refusals are never served from the cache, used as avoid text, or used as the fallback | Never show a refusal |
| 7 | `fact-lock.test.ts` (Postgres) | 10 concurrent requests → exactly one OpenAI call, same fact id everywhere | Variant A §2 "Burst / Idempotency Protection" |
| 8 | `fact-lock.test.ts` (Postgres) | Holder takes 7s (< lock_timeout) → waiter gets the new row; holder stuck 11s → waiter gets the stale fact | Timeout invariant |
| 9 | `fact-authz.test.ts` (Postgres) | Same title, two users: A never gets B's facts from the cache, avoid list or fallback | Variant A §4 "Authorization"; Security §2 |
| 10 | `fact-route-authz.test.ts` (Postgres) | Same, through `GET /api/fact` with mocked sessions | Variant A §4; Security §2 |
| 11 | `api-routes.test.ts` | `/api/me`, `/api/me/movie`, `/api/fact`: 401 without session, success shapes, `Cache-Control: no-store` everywhere | Variant B §1; Security |
| 12 | `api-routes.test.ts` | PUT: non-JSON / empty / too long / forged poster / wrong types → 400 with `fieldErrors`; client `userId` ignored | Security §1–2 |
| 13 | `api-routes.test.ts` | Fact: `NO_MOVIE` 400, 429 + `Retry-After`, 502; no `?force`; unexpected errors → 500 `INTERNAL` without internal details | Variant B §1 |
| 14 | `movie-service.test.ts` | Selection stored with TMDB fields; free text only when degraded / no match; TMDB fields cleared on free text | Onboarding; data integrity |
| 15 | `rate-limit.test.ts` | 30 allowed, 31st → `retryAfterMs`; sliding window; per user | Security (per-user rate limit) |
| 16 | `openai.test.ts` | Title, year, today, TMDB details and avoid sent as JSON data; transport retry once on 429/5xx (at most once per call); refusal / empty / too-short / NO_FACT → one retry (knowledge → grounded with full data when details exist, else the strict prompt for the same mode), then OpenAiError (refusal never returned); same abort signal on every call; no retry after the deadline; refusal patterns vs real facts; 2–3 sentence cap at 450 chars with sentence-end cut | Variant A §3; prompt safety |
| 17 | `api-client.test.ts` | 401 (even empty body) → `UNAUTHORIZED`; 429 → `RATE_LIMITED` (body or `Retry-After`); 500 / HTML / malformed / schema mismatch / network → `INTERNAL`; aborts pass through | Variant B §1 "Normalizes error handling" |
| 18 | `fact-card.test.tsx` | Skeleton → fact; stale hint; error + Try again recovers; rate-limit wait; redirect on 401; one request per mount; abort on unmount | Variant B; UI states |
| 19 | `movie-search-route.test.ts` | Search: auth, `q` 2–100 after trim, degraded passthrough, own rate-limit bucket, `no-store` | Movie search |
| 20 | `tmdb.test.ts` | Trending wall failures → `[]`; search parsing, 6-result cap, unsafe poster dropped, every failure → `degraded`; movie details mapping (top 5 cast by order, directors, runtime 0 → null, keywords de-duplicated; one call with `credits,keywords`), failures → `null`; 24h cache, shared in-flight request, failures not cached, eviction | Movie search; posters; fact grounding |
| 21 | `movie-form.test.ts` | Onboarding form parsing; forged `tmdbId` / `year` / `posterPath` rejected | Security §1 |
| 22 | `movie-search-combobox.test.tsx` | 300ms debounce, stale request aborted, arrows/Enter/Escape, empty and degraded states | Movie search UI; a11y |
| 23 | `onboarding-form.test.tsx` | Continue disabled until text; selected-movie preview; Change clears the selection | Onboarding UI |
| 24 | `env.test.ts` | `resetModules()` + `delete process.env.OPENAI_API_KEY` + re-import of `lib/env.ts` → throws a named error; `OPENAI_MODEL` defaults to `gpt-4.1-mini` (unset or blank), is trimmed, accepts dated/fine-tuned ids, rejects malformed values at startup, and is the `model` `generateFact` sends; `MODEL_KNOWLEDGE_CUTOFF` defaults to `2024-06-01`, trims, rejects non-dates and impossible dates | Security §3 (startup validation); config |
| — | `movie-edit.test.tsx` (Stage 8) | Edit → Save shows the new title before the server answers; on failure it reverts and shows an error | Variant B §2 "Edit Movie Flow (Inline)" |

## How each suite is structured

- **Mocked Prisma** — `fact-service` uses a small in-memory fake of the calls the service makes, with an injected `Clock` (`{ now: () => t }`). `movie-service` and `api-routes` mock the Prisma client or the services directly.
- **Real Postgres** — `fact-lock`, `fact-authz`, `fact-route-authz` use `tests/helpers/pg.ts` (`PrismaClient` on port 5433, `connection_limit=20`). OpenAI is a `vi.fn` with a configurable sleep. `fact-route-authz` mocks `@/lib/prisma` to the test client and `@/lib/auth` to switch sessions.
- **Route handlers** — called directly with `Request` / `NextRequest`; `@/lib/auth` mocked per test.
- **Browser client** — `vi.stubGlobal('fetch', …)` returning real `Response` objects.
- **Components** — RTL `render` + `fireEvent`; `next/image` and `next/navigation` mocked; fake timers for the debounce.

## What is NOT tested (and why)

- **End-to-end (Playwright)** — out of scope; the layered service + route + component tests give high confidence without the flakiness tax.
- **OAuth round-trip** — mocking Google reliably is more work than it earns for a take-home; Auth.js owns that boundary.
- **Pino output content** — we test behavior, not log lines.
- **UI snapshot tests** — brittle and low signal for this component surface.
- **Real TMDB / OpenAI** — never called from tests.

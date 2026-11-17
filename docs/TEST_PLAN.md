# Test Plan

Vitest + React Testing Library. Seven suites, one setup file. All suites except `fact-lock` mock Prisma.

## `vitest.setup.ts`

Sets dummy values for every required env var **before any test file is imported**, so `lib/env.ts` (which throws at module import if any var is missing) doesn't fail every suite. `env.test.ts` is the one place that deliberately resets modules and re-imports with a var removed, to prove the startup check works.

## Test matrix

| # | Suite                   | What it proves                                                                                             | Spec line                                                        |
|---|-------------------------|------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| 1 | `fact-service.test.ts`  | 60s cache window: generate at t=0, call again at t=59s → same content, no OpenAI call                      | Variant A §1 "60-Second Cache Window"                            |
| 2 | `fact-service.test.ts`  | 60s cache window: at t=61s a new row is written                                                             | Variant A §1                                                     |
| 3 | `fact-service.test.ts`  | OpenAI fallback: mock throws + prior fact exists → returns prior with `stale: true`                         | Variant A §3 "Failure Handling"                                  |
| 4 | `fact-service.test.ts`  | OpenAI fallback: mock throws + no prior fact → `UPSTREAM_FAILED`                                            | Variant A §3                                                     |
| 5 | `fact-lock.test.ts`     | 10 concurrent requests (real docker Postgres) → exactly one OpenAI call, same fact id in every response    | Variant A §2 "Burst / Idempotency Protection"                    |
| 6 | `fact-lock.test.ts`     | Timeout ordering: holder sleeps 7s (< lock_timeout 10s) → waiter gets the just-written row, not an error   | Variant A §1 + §2 (the timeout invariant)                        |
| 7 | `fact-authz.test.ts`    | User A has facts; a request authed as user B cannot read them (query scoped by session `userId`)            | Variant A §4 "Authorization"; Security §2                        |
| 8 | `rate-limit.test.ts`    | 31st request within 60s → 429 with `retryAfterMs`; after window advance → allowed                           | Security (implemented per-user rate limit)                       |
| 9 | `env.test.ts`           | `resetModules()` + `delete process.env.OPENAI_API_KEY` + re-import of `lib/env.ts` → throws named error    | Security §3 "Avoid exposing secrets" (startup validation side)   |
| 10 | `api-client.test.ts`   | `fetch` returns 401 → `AppErrorException { code: 'UNAUTHORIZED' }`                                         | Variant B §1 "Normalizes error handling"                         |
| 11 | `api-client.test.ts`   | `fetch` returns 500 or malformed body → `AppErrorException { code: 'INTERNAL' }`                           | Variant B §1                                                     |
| 12 | `movie-edit.test.tsx`  | Click edit → Save: assert optimistic UI change before the mock resolves                                    | Variant B §2 "Edit Movie Flow (Inline)" — optimistic UI          |
| 13 | `movie-edit.test.tsx`  | Save mock rejects → UI reverts to previous title, error toast shown                                        | Variant B §2 — revert if server fails                            |

## How each suite is structured

- **`fact-service.test.ts`** — Prisma mocked. `getFactForUser` called with an injected `Clock` fake (`{ now: () => tCurrent }`). OpenAI mocked per test. Tests 1–4.
- **`fact-lock.test.ts`** — Boots a Postgres via `pg` test container or an already-running `docker compose`. Applies migrations once in `beforeAll`. Seeds a user. OpenAI mocked with a configurable sleep. Tests 5–6. Skipped in CI if `SKIP_PG_TESTS=1`; CI sets up the service container so this does run.
- **`fact-authz.test.ts`** — Prisma mocked. Calls the route handler directly with two different mocked sessions. Test 7.
- **`rate-limit.test.ts`** — Pure unit tests against `lib/rate-limit.ts` with an injected `now`. Tests 8 (and a boundary test at exactly 30).
- **`env.test.ts`** — Uses `vi.resetModules()` + `vi.stubEnv` / `delete process.env.X` to force a re-import. Test 9.
- **`api-client.test.ts`** — `vi.stubGlobal('fetch', vi.fn(...))`. Tests 10–11.
- **`movie-edit.test.tsx`** — `@testing-library/react` + `@testing-library/user-event`. Mocks `lib/api.ts`. Tests 12–13.

## What is NOT tested (and why)

- **End-to-end (Playwright)** — out of scope; the layered service tests give high confidence without the flakiness tax.
- **OAuth round-trip** — mocking Google reliably is more work than it earns for a take-home; Auth.js owns that boundary.
- **Pino output content** — we test behavior, not log lines.
- **UI snapshot tests** — brittle and low signal for this component surface.

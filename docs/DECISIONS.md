# Decisions

> Stub — edit before submitting. One short entry per decision: *decision*, *why*, *what I considered*.

### Both variants implemented (not one)

- **Decision:** Base + Variant A + Variant B.
- **Why:** The fact service naturally hosts both the 60s/lock logic (A) and the typed API contracts (B); the 30s client cache sits cleanly on top. The overlap kept scope manageable.
- **Considered:** Single variant per the spec. Chose the broader submission because the service layer is shared.

### Database sessions over JWT

- **Decision:** Auth.js v5 with the Prisma adapter and database sessions.
- **Why:** Instant revocation (deleting the `Session` row ends the session), simpler callbacks, no session-encoding secret to manage. `auth()` in server components becomes a cheap `SELECT`.
- **Considered:** JWT sessions (no DB lookup per request, but revocation requires a denylist or very short lifetimes). Documented JWT + session-cache as the scale-up path.

### `auth()` at the data boundary; `proxy.ts` is UX-only

- **Decision:** The real guard is `auth()` inside each page and route handler. `proxy.ts` only redirects based on cookie presence, without verifying it.
- **Why:** Matches the Auth.js v5 recommendation: "verify the session as close to your data fetching as possible." The proxy can't do DB session lookups on the Edge anyway. Keeping the check at the data boundary makes the rule obvious and uniform.
- **Considered:** Full session verification in the proxy (impossible with DB sessions on Edge). Also considered skipping the proxy entirely — rejected because the UX win (not rendering a protected page to redirect) is real and the cost is ~5 lines.

### Layered timeouts: OpenAI 8s < lock_timeout 10s < tx timeout 20s

- **Decision:** Strict inequality. Each outer layer must exceed the one it wraps.
- **Why:** A waiting request must outlast the lock holder's OpenAI call. If `lock_timeout ≤ OpenAI deadline`, waiters time out just before the holder is about to serve them the just-written row — the lock then causes redundant OpenAI calls or spurious 500s, defeating its own purpose. Called out as a correctness invariant in `lib/fact-service.ts` and tested by `fact-lock.test.ts`.
- **Considered:** 3s / 10s (the reviewer caught this — exactly the inverted ordering that breaks the invariant). Rejected.

### Dropped `?force` from `GET /api/fact`

- **Decision:** No query param. The server always decides freshness via the 60s window; the explicit "New fact" action only skips the 30s client cache.
- **Why:** Fewer footguns. The server has the final word on cost and correctness, and the UX contract ("you'll get a new fact after the countdown") is preserved regardless of what the client does.
- **Considered:** `?force=1` bypassing the client cache (what I initially planned). Rejected because once the server enforces 60s anyway, the param doesn't change behavior and only invites misuse.

### Client cache is in-memory only, keyed by `userId:movieTitle`

- **Decision:** `Map<string, ...>` in React context. No `localStorage`, no SWR/React Query.
- **Why:** The spec requires 30s cache + invalidate-on-movie-change; nothing requires persistence. A plain Map makes the logic trivially inspectable. Keyed by `userId:movieTitle` so sign-out + sign-in-as-different-user can't leak, and movie edits auto-invalidate.
- **Considered:** SWR (its stale-while-revalidate + `mutate` fit the shape well; I just didn't need it for one cached value) and `localStorage` (shared-device staleness/privacy issues, no requirement to persist).

### Lock-wait timeout serves stale rather than 500

- **Decision:** On Postgres `55P03` after `lock_timeout = 10s`, return the latest stored fact with `stale: true`. Only 500 if no prior fact exists.
- **Why:** A user who's done nothing wrong shouldn't see 500 because the request ahead of them got stuck. A slightly-old sentence is strictly better. We only error when there's no content at all.
- **Considered:** Returning 503 with `Retry-After`. Rejected — it pushes the retry onto the client, which is both worse UX and more complexity than a stale read.

### Blocking advisory lock, not try-lock polling

- **Decision:** `pg_advisory_xact_lock` (blocking) inside a Prisma `$transaction`.
- **Why:** Postgres handles the serialization natively; `lock_timeout` bounds the wait. Simpler and correct — no polling loop in user code, no thundering herd, no manual backoff.
- **Considered:** `pg_try_advisory_xact_lock` with a polling / short-wait loop. More code, strictly weaker guarantees, and the "just serve latest" fallback on try-fail duplicates work the blocking variant already handles via the post-lock cache re-check.

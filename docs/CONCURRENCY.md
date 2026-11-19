# Concurrency

The fact service has four jobs: respect a 60-second server cache, survive bursts, survive upstream failures, and never time out a waiting user before the request ahead of them finishes writing. Everything below falls out of those four constraints.

## Timeout invariant (correctness-critical)

```
OpenAI deadline  8s
lock_timeout    10s
tx timeout      20s      (maxWait 5s)
```

Each outer layer is **strictly greater** than the inner. If `lock_timeout ≤ OpenAI deadline`, a waiting request would time out just before the lock holder is about to insert the new row — the waiter would then either fail or go on to make a redundant OpenAI call. This is a correctness bug, not a perf tweak. It's commented at the top of `lib/fact-service.ts` and exercised by `tests/fact-lock.test.ts`.

The 8s OpenAI deadline is **one** `AbortSignal` covering everything `generateFact` does under the lock: the first call, at most one transport retry (429/5xx), and at most one content retry (refusal / empty / too short — either the knowledge → grounded fallback or the strict prompt). So the worst case is three calls, all inside the same 8s. The TMDB details fetch (≤3s) happens **before** the lock, so it never adds to the time a holder keeps the lock.

## Request flow (`GET /api/fact`)

1. `auth()` → 401 if absent.
2. `rateLimit.consume(userId)` → 429 if exceeded. Log `fact.rate_limited`, return.
3. Load `movie.title`, `year`, `tmdbId` for the user. If no movie → 400 `NO_MOVIE`.
4. **Cheap pre-check (no lock, no transaction):** latest *usable* fact for `(userId, title)` (rows that look like a refusal are skipped). If `age < 60s`, log `fact.cache_hit` and return. **This is the hot path** — no transaction overhead and no TMDB call on the common case.
5. Log `fact.cache_miss`. **If the movie has a `tmdbId`, load TMDB details now, before the lock** (`getMovieDetails`: 3s timeout, 24h in-memory cache per `tmdbId`, concurrent callers share one in-flight request, failures not cached). Log `fact.tmdb_context` with `ok`. Any failure → continue with `details: null`.
6. Log `fact.lock_wait_start`. Open:
   ```ts
   prisma.$transaction(async (tx) => {
     await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`)
     await tx.$queryRawUnsafe(
       `SELECT pg_advisory_xact_lock(hashtext($1))`,
       `fact:${userId}`,
     )
     // ...
   }, { timeout: 20_000, maxWait: 5_000 })
   ```
7. **Inside the lock, re-check the cache.** This is the critical step that makes burst protection work. If another request already generated a fresh row while we were waiting, we serve it with zero additional OpenAI cost. Log `fact.cache_hit` (post-lock).
8. Still stale → decide the strategy **in code**: `mode = chooseFactMode(details, MODEL_KNOWLEDGE_CUTOFF, today, hasWikipediaNotes)` (decided before the lock, after the TMDB and Wikipedia lookups) and `angle = pickAngle(count of this user's facts for this title, mode)` (one indexed `COUNT` inside the lock). Call `generateFact({ title, year, details, today, mode, angle }, avoid, signal)` where the signal has an 8s deadline covering every retry. `avoid` = the last 10 usable facts. Log `fact.openai_call` with `model`, `mode`, `angle` and `usedMode`. Inside `generateFact`, a reply that is empty, under 20 chars, or looks like a refusal is retried once — in grounded mode if a knowledge-mode reply failed and TMDB details exist, otherwise with the stricter prompt for the same mode; if that fails too, it throws — a refusal is never returned.
9. On success → INSERT `Fact`. Commit closes the transaction and releases the lock.
10. Return `{ content, movieTitle, generatedAt, stale: false }` with `Cache-Control: no-store`.

## Failure branches

### OpenAI error (inside the lock)

Includes transport failures, the 8s deadline, and two unusable replies in a row (refusal / empty / too short).

1. Log `fact.openai_fallback` (the error message says which).
2. Query for the latest usable prior fact `(userId, title)` regardless of age (stored refusals are skipped).
3. If present: return `{ ..., stale: true }`. Log `fact.stale_served`.
4. If absent: throw `AppErrorException(UPSTREAM_FAILED)` → route handler returns 502; the FactCard shows a friendly message with "Try again".

Either way, nothing is written, and the lock releases when the transaction ends.

### Lock-wait timeout (holder is actually stuck)

Postgres returns `55P03 lock_not_available` after 10s.

1. Transaction rolls back, lock releases.
2. Log `fact.lock_wait_timeout`.
3. Query for the latest usable prior fact `(userId, title)` regardless of age (outside any transaction; stored refusals skipped).
4. If present: return `{ ..., stale: true }`. Log `fact.stale_served`.
5. If absent: throw `UpstreamFailedError` → 502.

**Why serve stale instead of 500.** The waiting user has done nothing wrong; the holder is misbehaving. Showing them a slightly-old sentence is strictly better than a 500. We only error when there is nothing to show at all.

## Why blocking, not try-lock polling

A `pg_try_advisory_xact_lock` + polling scheme would wake up repeatedly to check the cache, burn CPU, and still have to serialize the writes. Blocking `pg_advisory_xact_lock` lets Postgres do the serialization natively at near-zero cost, and the `lock_timeout` setting bounds the wait. The only lock a blocking acquire can "starve" on is one held longer than `lock_timeout` — exactly what the fallback branch above exists to handle.

## Why the lock key is hashed

`pg_advisory_xact_lock` takes a `bigint`. `hashtext()` maps our `'fact:' || userId` string to a 32-bit integer. Collisions are astronomically rare; a collision would cause two unrelated users to briefly serialize, never a data integrity issue.

## Client cache (Variant B)

- `lib/client-cache.ts` holds an in-memory `Map` keyed by `userId` + exact `movieTitle` → `{ fact, fetchedAt, clockOffsetMs }`, mirrored to **sessionStorage** (key `movie-memory:fact:v1:<userId>:<title>`) so it survives a full page reload in the same tab. A read checks memory first, then storage; stored values are Zod-validated (shape, version, and the `userId` / `movieTitle` inside must match the key) and anything malformed is removed. Every storage call is wrapped in try/catch; if storage is missing, blocked or full, the cache silently works from memory alone. Nothing is logged.
- **Invariant: the dashboard never shows a fact past its server window** (`generatedAt + 60s` on the server's clock), except a fact explicitly labelled stale: a server `stale: true` fallback, or the last fact after a failed load. Both carry the "Showing the last available fact" hint.
- **Cache hit rule:** an entry is a hit only while `now < min(fetchedAt + 30s, generatedAt + 60s)`, with `generatedAt + 60s` converted to browser time using the entry's `clockOffsetMs`. A fact fetched at age 59s is a hit for only 1 more second. A `stale: true` fact has an old `generatedAt`, so it is never a cache hit; it is only shown when the server sends it.
- **On mount:** cache hit → render it with **no request**. Otherwise (missing or expired) → the loading skeleton and `api.getFact()`; an expired fact is never painted first.
- **Clock correction:** every `FactResponse` carries `serverNow`. `clockOffsetMs = serverNow − browser time at receipt`, so the countdown to `generatedAt + 60s` follows the server's clock even if the browser's is off.
- **Auto-load:** at `generatedAt + 60s` (+250ms grace), only while the tab is visible (Page Visibility API). Hidden → the timer stops; visible again → recompute, and load straight away if overdue. The timer is cleared and rescheduled whenever a new fact arrives (`nextAt` changes), so only one is ever pending, and these loads always go to the server — the client cache is only read on mount. **On time** (the timer fires at 0:00): the current fact stays visible with "Getting a fresh fact…" for the moment the request takes (≤ 8s worst case), then fades to the new one — the one deliberate, sub-second exception to the invariant, to avoid a skeleton flash every minute. **Late** (more than 1s overdue, i.e. the tab was hidden past the window): the expired fact is taken off screen and the skeleton shows while loading; if that load fails, the old fact comes back only as a labelled fallback. A failed load (or a stale fact) keeps the current fact with the stale hint and retries after 30s (or the server's `retryAfterMs` on 429). If the same fact comes back, wait at least 5s before asking again — a guard against clock skew loops.
- **On `PUT /api/me/movie` success:** delete the entry for the **old** title. The FactCard is keyed by the confirmed title, so it remounts and fetches for the new one. While the save is in flight the card shows a saving skeleton and holds all loads, so it never asks for the new title before the server has it.
- **On sign-out:** `cache.clear()` — memory and every `movie-memory:fact:` key in sessionStorage (other keys are left alone). Also on a 401 from `/api/fact` (expired session) before redirecting to `/`.
- **On mount:** the cache is read in a layout effect, not during render. The server render has no cache, so reading it during the first client render would differ from the server HTML (a hydration error); the layout effect runs after hydration and before paint, so a hit still appears without a skeleton flash.
- **On "New fact" / "Try again" click** (the button only exists after a failed load, on a stale fallback, or 2s past 0:00 without a new fact): skip the client-cache check, call `api.getFact()`; a slow automatic request in flight is aborted and replaced. The server still enforces its 60s window — the client-side action is purely "don't short-circuit via my cache." If the server returns the same fact, the card says "Same fact for now. Next fresh fact in Xs." and the countdown continues from the server's `generatedAt`.

The cache is a plain module-level object, not React context: one instance per tab is exactly what's needed, and it's trivially resettable in tests. It persists to **sessionStorage**, not `localStorage`: per tab, gone when the tab closes, never shared across tabs or users of the same browser profile beyond that tab. Because of the validity rule, a reload more than 30s (or past the window) later simply misses and fetches.

## What is deliberately NOT done

- No distributed cache (Redis). The 60s server window + DB lock already bound cost; Redis would be a horizontal-scale upgrade, not v1.
- No request coalescing in the Node process. The DB lock handles coalescing across *all* processes correctly; a Node-local coalesce would be strictly weaker.
- No `?force` query param. The server always decides freshness; the client's "New fact" action is simply a client-cache bypass.

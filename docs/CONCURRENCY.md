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
8. Still stale → decide the strategy **in code**: `mode = chooseFactMode(details, MODEL_KNOWLEDGE_CUTOFF, today)` and `angle = pickAngle(count of this user's facts for this title)` (one indexed `COUNT` inside the lock). Call `generateFact({ title, year, details, today, mode, angle }, avoid, signal)` where the signal has an 8s deadline covering every retry. `avoid` = the last 10 usable facts. Log `fact.openai_call` with `model`, `mode`, `angle` and `usedMode`. Inside `generateFact`, a reply that is empty, under 20 chars, or looks like a refusal is retried once — in grounded mode if a knowledge-mode reply failed and TMDB details exist, otherwise with the stricter prompt for the same mode; if that fails too, it throws — a refusal is never returned.
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

- `useFact()` reads a `Map<string, { fact, generatedAt, stale }>` keyed by `${userId}:${movieTitle}`.
- **On mount:** if `Date.now() - new Date(generatedAt).getTime() < 30_000` and the key matches → use cached value, start countdown to `generatedAt + 60_000`. Otherwise `api.getFact()`.
- **On `PUT /api/me/movie` success:** delete the entry for the **old** title. The next FactCard render fetches for the new title.
- **On logout:** `cache.clear()`.
- **On "New fact" click:** skip the 30s client-cache check, call `api.getFact()`. The server still enforces its 60s window — the client-side action is purely "don't short-circuit via my cache." If the server returns the same fact, the countdown continues from the server's `generatedAt`.

The cache lives in a React context provided at the `app/layout.tsx` level; it is **not** persisted (no `localStorage`). On a hard reload the user hits the server once, which almost always serves a warm cache.

## What is deliberately NOT done

- No distributed cache (Redis). The 60s server window + DB lock already bound cost; Redis would be a horizontal-scale upgrade, not v1.
- No request coalescing in the Node process. The DB lock handles coalescing across *all* processes correctly; a Node-local coalesce would be strictly weaker.
- No `?force` query param. The server always decides freshness; the client's "New fact" action is simply a client-cache bypass.

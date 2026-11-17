# Concurrency

The fact service has four jobs: respect a 60-second server cache, survive bursts, survive upstream failures, and never time out a waiting user before the request ahead of them finishes writing. Everything below falls out of those four constraints.

## Timeout invariant (correctness-critical)

```
OpenAI deadline  8s
lock_timeout    10s
tx timeout      20s      (maxWait 5s)
```

Each outer layer is **strictly greater** than the inner. If `lock_timeout ≤ OpenAI deadline`, a waiting request would time out just before the lock holder is about to insert the new row — the waiter would then either fail or go on to make a redundant OpenAI call. This is a correctness bug, not a perf tweak. It's commented at the top of `lib/fact-service.ts` and exercised by `tests/fact-lock.test.ts`.

## Request flow (`GET /api/fact`)

1. `auth()` → 401 if absent.
2. `rateLimit.consume(userId)` → 429 if exceeded. Log `fact.rate_limited`, return.
3. Load `movie.title` for the user. If no movie → 400 `NO_MOVIE`.
4. **Cheap pre-check (no lock, no transaction):** `findLatestFact(userId, title)`. If `age < 60s`, log `fact.cache_hit` and return. **This is the hot path** — no transaction overhead on the common case.
5. Log `fact.cache_miss`, log `fact.lock_wait_start`. Open:
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
6. **Inside the lock, re-check the cache.** This is the critical step that makes burst protection work. If another request already generated a fresh row while we were waiting, we serve it with zero additional OpenAI cost. Log `fact.cache_hit` (post-lock).
7. Still stale → call `openai.generateFact(title, avoid, abortSignal)` where the signal has an 8s deadline covering the one 429/5xx retry. Log `fact.openai_call`.
8. On success → INSERT `Fact`. Commit closes the transaction and releases the lock.
9. Return `{ content, generatedAt, stale: false }` with `Cache-Control: no-store`.

## Failure branches

### OpenAI error (inside the lock)

1. Log `fact.openai_fallback`.
2. Query for any prior fact `(userId, title)` regardless of age.
3. If present: return `{ ..., stale: true }`. Log `fact.stale_served`.
4. If absent: throw `UpstreamFailedError` → route handler returns 502 `UPSTREAM_FAILED`.

Either way, the transaction commits (no rollback — we may have logged events) and the lock releases.

### Lock-wait timeout (holder is actually stuck)

Postgres returns `55P03 lock_not_available` after 10s.

1. Transaction rolls back, lock releases.
2. Log `fact.lock_wait_timeout`.
3. Query for any prior fact `(userId, title)` regardless of age (outside any transaction).
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

# Decisions

> Stub — edit before submitting. One short entry per decision: *decision*, *why*, *what I considered*.

### Docker mapped to port 5433, not 5432

- **Decision:** `docker-compose.yml` maps `5433:5432` (host 5433 → container 5432). `DATABASE_URL` uses port 5433.
- **Why:** A native PostgreSQL install owns port 5432 on this machine. When Docker also mapped 5432, the OS delivered connections to the native Postgres instead of the container, producing P1000 auth failures that looked like SCRAM/MD5 mismatches. Moving Docker to 5433 avoids the conflict entirely.
- **Considered:** Stopping the native Postgres service (would break other projects). Also considered patching auth — rejected because the real issue was the wrong process receiving the connection.

### `.env` alongside `.env.local` for Prisma CLI

- **Decision:** Keep a `.env` file containing only `DATABASE_URL` (identical value to `.env.local`).
- **Why:** Prisma CLI (`prisma migrate dev`, `prisma generate`, `prisma studio`) reads `.env` by default and does not read `.env.local`, which is a Next.js convention. Without `.env`, every Prisma command requires an explicit `--env-file` flag. The file is covered by `.gitignore` (`.env*` rule) so it is never committed.
- **Considered:** Always passing `--env-file .env.local` to every Prisma command (verbose, easy to forget in CI). Also considered symlinking — rejected as unnecessary complexity.

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

### Movie posters via TMDB, not omitted

- **Decision:** Fetch the TMDB poster path server-side when the user saves or edits their movie; store only the relative path in `Movie.posterPath`; assemble the full URL in `PosterImage` using the TMDB image base.
- **Why:** A real poster makes the dashboard meaningfully more engaging than a plain title card, and the TMDB free tier comfortably covers this use pattern. Storing only the path (not the full URL) keeps the image-size config in one place (`next.config.ts`) rather than baked into every row.
- **Considered:** Storing the full URL — rejected because it tightly couples the data to a specific TMDB CDN path/size, making future resizing or CDN changes require a migration.

### TMDB_API_KEY is optional, not required

- **Decision:** `lib/env.ts` validates `TMDB_API_KEY` with `.optional()`. When absent, `fetchPosterPath` returns `null` immediately and no poster lookup is attempted. The app starts and runs normally.
- **Why:** The poster is a visual enhancement, not a data-correctness requirement. Making the key optional means the app can be run locally or demoed without a TMDB account, and a TMDB outage at deploy time can't prevent a cold start.
- **Considered:** Making it required (simpler env schema, one less null path). Rejected because a missing API key should degrade gracefully, not break the app.

### Poster fetch on save/edit, not on page load

- **Decision:** `fetchPosterPath` is called inside the server action when the movie is saved or edited, and the result is persisted to `Movie.posterPath`. The dashboard reads the stored path — it does not call TMDB on every request.
- **Why:** Fetching on load would add TMDB latency to every dashboard render and re-fetch the same result each time. Storing it once on write is cheaper, more reliable, and aligns with how the title itself is stored. If TMDB changes the poster, the user can re-save to pick up the new path (or we add a background refresh later).
- **Considered:** Fetching on every dashboard render (always fresh but always costly). Also considered a background job after save (more moving parts for the same result). Both rejected in favour of the simpler synchronous save path.

### Landing page TMDB trending poster wall

- **Decision:** Fetch TMDB trending movie posters (`/trending/movie/day`) with a 24 h Next.js `revalidate: 86400`, display them as an animated 3-row marquee background on the landing page, and credit TMDB in the footer (omitted if `posters.length === 0`).
- **Why:** Trending posters change slowly (daily at most), so a 24 h cache keeps the wall fresh without burning API quota on every cold load. The trending endpoint returns a curated set of high-quality posters with no title lookup — a single call populates the entire background. Failures return `[]` so the page renders normally without posters; the footer credit is conditional on poster data being present.
- **Considered:** A static curated set of local images (no key required, never updates). Per-request fetch with `no-store` (always fresh, adds latency to cold load, depletes free quota faster). Chose 24 h revalidate as the minimum-cost option that still keeps the wall feeling current.

### Landing page poster wall: `clamp` sizing and 3-copy track for seamless coverage

- **Decision:** Poster height is `clamp(120px, 11vw, 210px)` with `aspect-ratio: 2/3`; each row builds a 40-item tile (the ~20-result TMDB list repeated ×2) and uses three copies of that tile, animating with `translateX(-33.333%)` to advance exactly one tile per loop.
- **Why:** `clamp` ties poster size to the viewport — roughly 150 px at 1366 px and capped at 210 px from 1920 px onward — without media-query breakpoints. A 40-item tile at the smallest poster slot width (100 px + 12 px gap = 112 px) produces 4480 px of content, exceeding the widest supported viewport (3840 px) so there is never a visible seam at any size. Translating by one-third of a 3-copy track is the simplest integer fraction that guarantees one tile ≥ viewport.
- **Considered:** Fixed pixel widths (fine on the design viewport, break at higher resolutions). A 2-copy track (`−50 %`) — works until one copy is narrower than the viewport; with the default 20 TMDB results this fails at 2560 px and above at the original fixed poster size.

### Gradient film-frame as poster fallback, not a placeholder image

- **Decision:** When `posterPath` is null, `PosterImage` renders a CSS gradient div with an `IconFilm` icon — same outer dimensions as the poster slot, no image request.
- **Why:** A generated fallback looks intentional and consistent with the dark cinematic theme. A broken image icon or a grey box would look like an error. No external asset needed, no request, no flicker.
- **Considered:** A static "no poster" placeholder image (additional asset, still looks like a gap). Skipping the slot entirely (layout shift when a poster later appears on edit). Both rejected.

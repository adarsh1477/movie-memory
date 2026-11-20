# Movie Memory

Movie Memory is a small full-stack app. You sign in with Google, pick your favorite movie, and the dashboard shows a short fun fact about it. A new fact can be generated at most once every 60 seconds per user and movie; inside that window the stored fact is served again. Facts are written by OpenAI from TMDB data and, when available, the production sections of the film's Wikipedia article.

**Features**

- Google sign-in (Auth.js v5, database sessions), with onboarding for first-time users.
- Movie search with TMDB autocomplete, posters and release years. Free text is accepted only when TMDB is unavailable or has no match.
- Fun facts grounded in TMDB details and Wikipedia production notes, with a model-knowledge fallback for older films that have no notes.
- A 60-second server window per user and movie, protected against bursts by a Postgres advisory lock.
- Graceful fallback: if generation fails, the latest stored fact is served with `stale: true`.
- A 30-second client cache that never outlives the server's 60-second window, a live countdown, and an automatic swap to the next fact.
- Inline edit of the favorite movie on the dashboard, with optimistic update and revert on error.
- Fact history: cursor-paginated, 5 per page, with Load more and Show less.
- A typed API client and Zod validation on every input and response.
- 588 tests across 28 suites, including real-Postgres concurrency tests, and a GitHub Actions workflow.

**Screenshots**

![Landing page](docs/screenshots/landing_page.png)

Landing page with the poster wall and Google sign-in

![Landing page, scrolled](docs/screenshots/landing_page2.png)

Landing page, scrolled

![Onboarding](docs/screenshots/onboarding.png)

Onboarding: pick a favorite movie with TMDB search

![User dashboard](docs/screenshots/user_dashboard.png)

Dashboard with the fun fact and countdown

## Setup

### Prerequisites

- Node.js 22
- pnpm (the version is pinned in `package.json` under `packageManager`; `corepack enable` picks it up)
- Docker (for local Postgres 16)

### Steps

```bash
git clone https://github.com/adarsh1477/movie-memory.git movie-memory
cd movie-memory
pnpm install

# Postgres 16 on localhost:5433 (5433, so it doesn't clash with a native Postgres on 5432)
docker compose up -d

# Environment: .env holds only DATABASE_URL (Prisma's CLI reads it);
# .env.local holds everything else (Next.js reads it)
# Create a file named .env containing exactly this one line:
#   DATABASE_URL="postgresql://movie:movie@localhost:5433/movie_memory"
cp .env.example .env.local
# then fill in real values in .env.local (see the table below)
# Get a free TMDB Read Access Token first. Without it the app still runs, but the posters,
# search and grounded facts are turned off.

pnpm prisma migrate dev     # applies all migrations and generates the Prisma client
pnpm dev                    # development server: http://localhost:3000
```

That's the development setup. To run a production build instead, see [Production build](#production-build) below.

Dev mode is noticeably slower than production (Next.js compiles pages on demand and runs React's development build). For the fast version, use the production build below.

### Running checks

```bash
pnpm test           # all Vitest suites (the real-Postgres suites need the Docker database running)
pnpm tsc --noEmit   # typecheck
pnpm lint           # ESLint 9 flat config
```

Set `SKIP_PG_TESTS=1` to skip the four real-Postgres suites when no database is available.

### Production build

```bash
# same setup as above (database running, migrations applied), plus AUTH_TRUST_HOST=true in
# .env.local: already there if you copied .env.example
pnpm build
pnpm start          # http://localhost:3000
```

Without `AUTH_TRUST_HOST=true`, Auth.js rejects requests under `pnpm start` with `UntrustedHost` and Google sign-in fails. `pnpm dev` doesn't need it (it's harmless there).

## Environment variables

`.env` contains only `DATABASE_URL` (the Prisma CLI reads it). `.env.local` contains all the other values (Next.js reads it). Both files are git-ignored. `.env.example` contains placeholders only.

| Name | Required | What it is | How to get it |
|---|---|---|---|
| `DATABASE_URL` | Required | Postgres connection string. Use port **5433** in **both** `.env` and `.env.local`. | With the Docker defaults: `postgresql://movie:movie@localhost:5433/movie_memory` |
| `AUTH_SECRET` | Required | Secret Auth.js uses to sign and encrypt session data. | `npx auth secret`, or any random string of 32+ characters (for example `openssl rand -base64 32`). |
| `GOOGLE_CLIENT_ID` | Required | Google OAuth client id. | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth client ID (Web application). Add the authorized redirect URI `http://localhost:3000/api/auth/callback/google`. |
| `GOOGLE_CLIENT_SECRET` | Required | Google OAuth client secret. | Shown with the client id above. |
| `OPENAI_API_KEY` | Required | OpenAI API key. Used only on the server. | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `OPENAI_MODEL` | Optional | Chat model for facts. Default `gpt-4.1-mini`. Must be a non-reasoning chat model (the request sends `max_tokens` and `temperature`). | For example `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o-mini`. |
| `MODEL_KNOWLEDGE_CUTOFF` | Optional | `YYYY-MM-DD`, default `2024-01-01`. Only matters when a film has no Wikipedia notes: films released before it fall back to model knowledge, later ones are grounded on TMDB data only. | Set it a few months before `OPENAI_MODEL`'s training cutoff, and update it when you change the model. |
| `AUTH_TRUST_HOST` | Optional | Tells Auth.js to trust the request's host. Needed for a production build run locally with `pnpm start`, or behind a proxy. Not needed in `pnpm dev`; set automatically on Vercel. | Set to `true` (as in `.env.example`). |
| `TMDB_API_KEY` | Strongly recommended (needed for the full experience; empty in `.env.example`) | TMDB **Read Access Token** (the Bearer token, not the v3 API key). Without it there's no movie search autocomplete, no posters or poster wall, and no Wikipedia-grounded facts, because those need TMDB details. Empty is treated the same as unset. | Free: [developer.themoviedb.org](https://developer.themoviedb.org/) → Settings → API → "API Read Access Token". |

**Without `TMDB_API_KEY`** (left empty as in `.env.example`, or removed) the app still works with no errors, in a degraded mode: search reports itself unavailable and accepts the title as free text, there are no posters (a gradient fallback is shown), and facts for free-text titles use model knowledge only, since there are no TMDB details to look up Wikipedia with.

**Google sign-in in Testing mode:** if your OAuth consent screen's publishing status is "Testing", add your Google account under **Test users** (Google Cloud Console → APIs & Services → OAuth consent screen), or Google will block the sign-in.

**Wikipedia needs no key.** It's read through the public MediaWiki API.

## Database migrations

Migrations live in `prisma/migrations` (5 so far).

```bash
pnpm prisma migrate dev       # development: applies pending migrations, regenerates the client
pnpm prisma migrate deploy    # CI / production: applies pending migrations only, never creates new ones
pnpm prisma generate          # regenerates the Prisma client (needed after migrate deploy, or after pulling schema changes)
```

On Windows, stop `pnpm dev` before running `migrate dev`, otherwise Prisma can't replace its query engine file (EPERM). Restart the dev server afterwards.

## Architecture overview

More depth in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md), [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), [`docs/LLD.md`](docs/LLD.md) and [`docs/DECISIONS.md`](docs/DECISIONS.md).

### Request flow

```mermaid
flowchart TD
  C[Dashboard: useFact] -->|"30s client cache hit<br/>(never past generatedAt + 60s)"| C
  C -->|GET /api/fact| R[Route handler: session userId, rate limit]
  R --> Q{"Newest Fact row for<br/>user + movie under 60s old?"}
  Q -->|yes: cache hit| H[Return it. No OpenAI call]
  Q -->|no| FT{"Picked from TMDB?"}
  FT -->|"no: free-text title"| K[Knowledge mode<br/>no TMDB or Wikipedia lookup]
  FT -->|yes| T[TMDB details ≤3s, then Wikipedia notes ≤2s<br/>both cached 24h, both before the lock]
  T --> M[chooseFactMode: grounded or knowledge]
  K --> L
  M --> L["Transaction (20s): lock_timeout 10s,<br/>pg_advisory_xact_lock per user"]
  L --> Q2{"Re-check: fresh row now?"}
  Q2 -->|yes| H
  Q2 -->|no| O["OpenAI, one 8s deadline<br/>for every attempt"] -->|ok| I[INSERT Fact, commit] --> OK[Return stale: false]
  O -->|"reply rejected<br/>(refusal, empty, too short)"| RT["Retry once, same 8s deadline:<br/>knowledge → grounded if TMDB details exist,<br/>otherwise a stricter prompt"]
  RT -->|ok| I
  RT -->|rejected again| S
  O -->|"error or timeout"| S{Any prior fact?}
  L -->|"lock wait timeout (55P03)"| S
  S -->|yes| ST[Return latest with stale: true]
  S -->|no| E[502 with a friendly error]
```

1. The dashboard's `useFact` hook first checks its client cache. On a miss it calls `GET /api/fact` through the typed client in `lib/api.ts`.
2. The route handler gets the `userId` from the Auth.js session (never from the client), applies a per-user rate limit and calls `getFactForUser`.
3. The service loads the user's movie and checks the server cache. A hit returns immediately.
4. On a miss it gathers sources, takes the per-user advisory lock, re-checks the cache, generates, stores and returns the fact.

### Data model

Prisma with Postgres 16. Besides the Auth.js tables (`User`, `Account`, `Session`, `VerificationToken`):

- **`Movie`**: one per user (`userId` is unique). Stores `title`, plus `tmdbId`, `year` and `posterPath` when the movie was picked from TMDB.
- **`Fact`**: `userId`, `movieTitle`, `content`, `createdAt`. Two indexes:
  - `(userId, movieTitle, createdAt desc)` for the cache lookup, the avoid list and stale fallback.
  - `(userId, createdAt desc, id desc)` for the fact history's keyset pagination.

Deleting a user cascades to their movie and facts.

### The 60-second cache window

The cache is **database-backed**: the newest `Fact` row for the user and movie *is* the cache, found with the `(userId, movieTitle, createdAt desc)` index. If that row is less than 60 seconds old, it's returned and **no OpenAI call is made**. There is no separate cache store; every generated fact is kept, which is also what powers the history.

Try it: get a fact on the dashboard, then open `/dashboard` in a second tab within 60 seconds. The new tab shows the same fact, with the countdown continuing from the remaining time, and the server logs `fact.cache_hit` with no OpenAI call. This works because the cache belongs to the user and movie, not to a tab or a browser session.

### Burst protection and the timeout invariant

Several tabs or a burst of clicks can arrive after the window expires at the same moment. Without coordination, each would call OpenAI. Instead, generation runs inside a Postgres transaction that takes `pg_advisory_xact_lock(hashtext('fact:' || userId))`:

- The first request takes the lock and generates.
- The others wait on the lock. When they get it, they **re-check the cache**, find the new row and return it without calling OpenAI.
- The lock is released automatically when the transaction commits or rolls back, so a crash can't leave it held.

The timeouts are ordered so each layer fails before the one around it:

**OpenAI 8s < `lock_timeout` 10s < transaction 20s**

A request holding the lock gives up on OpenAI after 8s, before a waiter's 10s lock wait runs out, and both finish well inside the 20s transaction. TMDB and Wikipedia lookups happen **before** the lock, so they never add to the time it's held. This order is tested against a real Postgres in `tests/fact-lock.test.ts`.

### Failure fallback

- **OpenAI fails** (network error, the 8s deadline, or two unusable replies in a row): the latest usable stored fact for that user and movie is returned with `stale: true`, whatever its age.
- **Lock wait times out** (Postgres `55P03`): same, the latest fact with `stale: true`.
- **No prior fact exists**: a 502 with a friendly message and a "Try again" button.

Refusal-like or too-short model replies are retried once and never stored as a fact.

### Fact generation

1. **TMDB details** (≤3s, cached 24h): title, tagline, overview, release date and status, runtime, genres, directors, top 5 cast, production companies and keywords.
2. **Wikipedia production notes** (≤2s, cached 24h including misses) for every film with TMDB details. The article must match the title and mention the release year or the director; otherwise no notes are used. Production sections are trimmed to 3,000 characters.
3. **Mode decision in code** (`chooseFactMode`, a pure function):

   | Situation | Mode |
   |---|---|
   | Wikipedia notes found (any release date) | Grounded on TMDB + Wikipedia notes |
   | No notes, released before `MODEL_KNOWLEDGE_CUTOFF` | Knowledge (model memory, strict accuracy rules) |
   | No notes, released on or after the cutoff, or unreleased | Grounded on TMDB only |
   | No TMDB details (free-text title, or TMDB down) | Knowledge |

4. **Prompt variety:** a rotating "angle" (for example filming, music, casting) based on how many facts the user already has for this film, and an avoid list of the last 10 facts so the model doesn't repeat itself. Temperature 0.4, at most 200 tokens, capped at 450 characters.
5. **Retry:** a rejected knowledge-mode reply is retried once in grounded mode when TMDB details exist, otherwise with a stricter prompt in the same mode.

### Client cache, countdown and auto-swap

- **Client cache (`lib/client-cache.ts`):** a fetched fact is reused for 30 seconds, but never past `generatedAt + 60s`, the end of the server's window. The rule is `now < min(fetchedAt + 30s, generatedAt + 60s)`. The response's `serverNow` corrects for the browser's clock drift. The cache is mirrored to `sessionStorage` (Zod-validated on read) so a reload stays instant, and it's cleared on sign-out and on a 401.
- **Countdown:** the fact card counts down to `generatedAt + 60s` using the server-corrected clock.
- **Auto-swap:** at zero the hook fetches the next fact and swaps it in. It pauses while the tab is hidden, and backs off briefly if the server returns the same fact. A "New fact" button appears only when a fact is stale or overdue, and "Try again" only after an error.

### Fact history

`GET /api/facts/history` returns the user's facts newest first, using **keyset (cursor) pagination** on `(createdAt, id)`. The dashboard shows **5 per page**:

- **Load more** appends the next 5. The cursor is the id of the last item shown, looked up scoped to the session user, so another user's id is rejected as an invalid cursor.
- **Show less** collapses back to the latest 5 without a request, and Load more continues right after the 5th item.
- While collapsed, a new fact refreshes the list to the latest 5 instead of growing it.

### Security

- **Authorization comes from the session.** Every route handler and server component calls `auth()`, and every query is scoped by the session's `userId`. Client-supplied ids are never trusted. Real-Postgres tests check one user can't read another's facts.
- **`proxy.ts` is UX only:** it redirects based on the session cookie being present, without verifying it. The real check is `auth()` on the server.
- **Server-side validation:** every mutation, query parameter and response is validated with Zod (`lib/validation.ts`).
- **No secrets on the client:** OpenAI, TMDB and Wikipedia are called only from the server. No key is in a `NEXT_PUBLIC_*` variable or the client bundle.
- **Rate limits per user:** facts and movie search 30/min, fact history 30/min, movie edits 20/min (429 with `Retry-After`).
- **Logs** (pino) record events, modes and durations, not fact text or personal data.

## Variants: I built both

I built **both Variant A (backend robustness) and Variant B (frontend/API)**.

- **Variant A:** the 60-second database-backed cache, burst protection with the advisory lock and the timeout invariant, the stale fallback, and tests for all of them (including real-Postgres concurrency tests).
- **Variant B:** the typed API client (`lib/api.ts`) with Zod-validated responses, inline movie editing with optimistic update and revert, the 30-second client cache tied to the server window, and their tests.

**Why both:** the two halves depend on each other. The client cache is only correct because it's bounded by the server's 60-second window, and the countdown and auto-swap only make sense if the server reliably serves one fact per window even under bursts. Building one side alone would have meant guessing at the other side's contract, and building both shows the full path from the database to the UI. Beyond the two variants I added TMDB search, Wikipedia grounding, fact history and CI.

## Key tradeoffs

- **Database-backed cache vs Redis.** The newest `Fact` row is the cache, so there's no extra infrastructure, nothing to invalidate, and the cache and history can't disagree. The cost is a small indexed query on every request, which Redis would avoid at scale. At around 1 million active users, each dashboard asks for a new fact about once a minute, roughly 17,000 requests per second, so Redis and the shared pool become necessary.
- **Postgres advisory lock vs an in-memory lock.** An in-memory mutex only protects one server process. The advisory lock works across instances, releases itself when the transaction ends, and uses the database the app already has. The cost is a held connection while generating, bounded by the timeout invariant.
- **Per-user generation vs a shared pool.** Each user gets their own facts, with their own avoid list and angle rotation. A shared per-movie pool would cut OpenAI cost for popular films but needs per-user "seen" tracking. I chose the simpler, more personal option.
- **30-second client cache vs the 60-second server window.** The client cache saves requests on navigation and reloads, but it's capped at the server window so the client never shows a fact the server would already have replaced.
- **One movie per user.** It matches the brief and keeps the data model and cache key simple. Changing the movie starts that movie's own 60-second window.
- **No force-refresh parameter.** The 60-second window can't be bypassed from the client, which keeps OpenAI cost predictable. "New fact" just asks again; the server decides.
- **TMDB validation with a free-text fallback.** Titles must be picked from TMDB search, which gives accurate titles, posters and details. Free text is accepted only when TMDB is down or has no match, so the app never blocks on a third party.
- **Wikipedia-first grounding vs model memory.** Fact-checking showed the model writing false trivia from memory, including for *Dune: Part Two*, *Great Grand Masti* and *Spider-Man* (2002). The problem wasn't only recent films, so Wikipedia production notes are now the first source for every film, and model knowledge is a fallback only when no notes exist. The cost is up to 2 seconds on a cache miss, cached for 24 hours.
- **The 60-second window belongs to the user and movie.** Facts are generated only when the dashboard requests one, and every generated fact is stored and appears in the history, so a fact the user didn't get to read is never lost.

## With 2 more hours, I would

- **Put Redis in front** of the database cache (a 60-second TTL key per user and movie) so reads at scale don't hit Postgres.
- **Move the rate limiter and the TMDB and Wikipedia caches to Redis**, so they're shared across server instances instead of per process.
- **Add a shared per-movie fact pool** (in Redis, or a Postgres table with Redis in front) with per-user "seen" tracking. Serve an unseen fact from the pool first and call OpenAI only when the pool has nothing new for that user. This is what cuts OpenAI cost at scale, because most users pick popular films.
- **Add a global limit on OpenAI calls** (a shared rate limiter or queue with a daily budget) as a safety net, so total cost and OpenAI rate limits stay bounded. When the limit is hit, serve a pool fact or the latest stored fact instead of an error. Today the limit is per user only (one new fact per 60 seconds, 30 requests a minute).
- **Check for duplicates in code** against recent facts, instead of relying only on the avoid list in the prompt.
- **Store `tmdbId` on `Fact`**, so two films with the same title (for example *Heat*, 1995 and 1986) don't share a cache window and history.
- **Add a verification step for knowledge-mode facts**, such as checking key claims against a source before storing them.
- **Virtualize the history list**, or move long histories to their own page.
- **Add `next build` and end-to-end tests** (for example Playwright) to CI.
- **Reduce the poster wall's DOM size.** It renders 360 images, so the landing HTML is about 1 MB. Fewer posters per row with a CSS-looped animation and a smaller srcset would cut that a lot.

## Known limitations

- **Model output isn't independently verified.** Grounded facts are only as good as their sources, and knowledge mode (used only when no Wikipedia notes exist) can state false trivia despite strict accuracy rules.
- **Wikipedia can be missing, short or wrong.** Some films (especially upcoming or small ones) have no article, a stub without production sections, or an article that hasn't caught up with production news. The app then falls back as described above. If the article is wrong, a fact drawn from it can be wrong too.
- **Rate limits and the TMDB and Wikipedia caches are in memory**, so they're per server process and reset on restart. The 60-second window and the lock are in Postgres and work across instances.
- **The poster cache is per server instance.** The landing wall's TMDB pool (1 hour) lives in each server process's memory, so each instance fetches its own pool and a restart starts empty.
- **Facts are keyed by title**, not by TMDB id, so two films with the same title share a cache window and history.
- **The knowledge cutoff must follow the model.** If `OPENAI_MODEL` changes, update `MODEL_KNOWLEDGE_CUTOFF` to a date comfortably before the new model's training cutoff.

## Testing

**588 tests across 28 suites** (Vitest + React Testing Library). [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md) maps each one to the behavior it covers.

- **Fact service:** cache hit and miss, the 60-second boundary, stale fallback on OpenAI failure and lock timeout, refusal handling and retries, the mode matrix (Wikipedia notes or not, before or after the cutoff, free text), the avoid list and angle rotation, logging without personal data.
- **External services:** TMDB and Wikipedia parsing, matching, timeouts, caching and degraded behavior; the OpenAI client's deadline and output trimming.
- **API routes:** auth (401), validation (400), rate limits (429), response shapes.
- **Client:** the client cache's freshness rule and `sessionStorage` mirror, the countdown and auto-swap, inline edit with optimistic update and revert, the search combobox, onboarding, fact history (Load more, Show less, no duplicates, no extra requests), and above-the-fold image loading.
- **Real Postgres (4 suites):** concurrency (a burst of requests produces exactly one OpenAI call; the timeout order holds), authorization at the service and route level (no cross-user access), and history pagination. They use the Docker database, or `PG_TEST_URL` if set; `SKIP_PG_TESTS=1` skips them.
- **Network guard:** `vitest.setup.ts` makes any test that tries to reach `api.openai.com`, `api.themoviedb.org` or `en.wikipedia.org` fail, so the suite never calls a real service or spends money.
- **CI:** `.github/workflows/ci.yml` runs on every push and pull request with a Postgres 16 service and dummy secrets: install, `prisma generate`, `prisma migrate deploy`, typecheck, lint and the full test suite.
- **Production build:** the production build was checked: `pnpm build` passes with no errors, and with `pnpm start` a signed-out `GET /` has a median server time of about 40ms over 10 requests (the first request, which fetches the TMDB poster pool, about 290ms).

## More

- [AI_USAGE.md](AI_USAGE.md): how I used AI tools while building this.
- Walkthrough video: https://youtu.be/Wqur28GH5Dw

## Credits

- **Movie data and posters:** [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- **Production notes:** [Wikipedia](https://en.wikipedia.org/), via the public MediaWiki API. Wikipedia text is licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). For any film whose Wikipedia article can be matched confidently, fun facts are based on the production sections of that article. Facts are short paraphrases, not copies; credit goes to Wikipedia and its contributors. The dashboard footer carries the same credit.
- **Fun facts:** generated by OpenAI from the sources above; only when there are no Wikipedia notes for an older film does the model fall back to its own knowledge.

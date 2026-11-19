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

- **Decision:** The poster comes from the TMDB search result the user picks; store only the relative path in `Movie.posterPath`; assemble the full URL with `posterUrl()` from the TMDB image base.
- **Why:** A real poster makes the dashboard meaningfully more engaging than a plain title card, and the TMDB free tier comfortably covers this use pattern. Storing only the path (not the full URL) keeps the image-size config in one place (`next.config.ts`) rather than baked into every row.
- **Considered:** Storing the full URL — rejected because it tightly couples the data to a specific TMDB CDN path/size, making future resizing or CDN changes require a migration.

### TMDB_API_KEY is optional, not required

- **Decision:** `lib/env.ts` validates `TMDB_API_KEY` with `.optional()`. When absent, `searchMovies` returns `{ results: [], degraded: true }` without calling TMDB, the combobox says search is unavailable, and free-text titles are accepted. The app starts and runs normally.
- **Why:** The poster is a visual enhancement, not a data-correctness requirement. Making the key optional means the app can be run locally or demoed without a TMDB account, and a TMDB outage at deploy time can't prevent a cold start.
- **Considered:** Making it required (simpler env schema, one less null path). Rejected because a missing API key should degrade gracefully, not break the app.

### Movie search autocomplete replaces the post-save poster lookup

- **Decision:** Onboarding (and the Stage 7 inline edit) uses a TMDB-backed combobox. The user picks the exact film, and `title`, `tmdbId`, `year` and `posterPath` are saved together. The planned `fetchPosterPath(title)` lookup after save is dropped. The dashboard reads the stored path and never calls TMDB per request.
- **Why:** Guessing from a free-text title picks the first search result, which is often the wrong film (*Heat* 1986 vs 1995, remakes, sequels). Letting the user choose gets the right poster and a year to disambiguate facts, with no extra TMDB call at save time.
- **Considered:** Keeping `fetchPosterPath` on save (simpler UI, frequently wrong film). Fetching on every dashboard render (always costly). Storing the full TMDB response (more data than we use).

### Search route returns `{ degraded: true }` instead of an error

- **Decision:** `GET /api/movies/search` returns `200 { results: [], degraded: true }` when TMDB is down, slow (3s timeout), returns an unexpected body, or `TMDB_API_KEY` is missing. Only auth (401), bad `q` (400) and the rate limit (429) are errors.
- **Why:** TMDB being unavailable is an expected state the UI handles ("search is unavailable, you can save the title as typed"), not a failure of our request. A 5xx would push every client into error handling for a case that has a defined fallback. Malformed individual results are dropped rather than failing the whole list; an unsafe `poster_path` drops just that field.
- **Considered:** 502 `UPSTREAM_FAILED` (makes the client treat a normal degraded mode as an error).

### Free text only when search can't help, checked on the server

- **Decision:** If no result was selected, the save action re-runs `searchMovies(title)` and rejects the save when TMDB is healthy and has matches ("Pick your movie from the suggestions"). Free text is accepted when TMDB is degraded or has no match.
- **Why:** The client can't be trusted to report "TMDB was degraded", and without the check most saves would skip the selection and lose the poster and year. The extra TMDB call happens only on free-text submits.
- **Considered:** Client-only enforcement (bypassable, and wrong when the client's last search was stale). Always allowing free text (most users would skip the dropdown).

### Client-supplied `tmdbId` / `year` / `posterPath` are format-validated, not re-fetched

- **Decision:** The hidden inputs are validated with Zod (positive int id, year 1870–2100, poster path regex `^/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$`) and stored. The server does not re-fetch `/movie/{id}` to confirm them.
- **Why:** A user can only affect their own row, and the values are display-only. The strict poster regex is what matters: it means the stored value can only ever become a `https://image.tmdb.org/t/p/...` URL. Re-fetching would add a second TMDB dependency to every save.
- **Considered:** Re-fetching details by `tmdbId` on save (authoritative, but slower, and it fails when TMDB is down).

### Search has its own rate-limit bucket

- **Decision:** `/api/movies/search` uses the same per-user policy as `/api/fact` (30 requests / 60s, in-process sliding window) but a separate limiter instance. Invalid queries are rejected before they count.
- **Why:** Debounced typing can send several searches in a few seconds. Sharing one bucket would let editing your movie on the dashboard block your next fact, and vice versa.
- **Considered:** One shared bucket (couples two unrelated features). No limit on search (every keystroke burst hits the TMDB quota unbounded).

### Release year goes into the fact prompt

- **Decision:** The OpenAI user message is `{ movie, year, today, tmdb, avoid }`, with `year: null` for free-text titles, and the system prompt tells the model to stay on that specific film.
- **Why:** Same-title films are common. Without the year the model happily mixes facts from the 1986 and 1995 *Heat*.
- **Considered:** Appending the year to the title string (blurs the data/instruction boundary the JSON message keeps). Keying facts by `tmdbId` as well — deferred; see the known limitation in `DATA_MODEL.md`.

### Facts are grounded in TMDB details, fetched before the lock

- **Decision:** When the movie has a `tmdbId`, the fact service loads TMDB details (overview, tagline, release date, status, runtime, genres, directors, top 5 cast, studios, keywords) and passes them to OpenAI as JSON data. The fetch has a 3s timeout, is Zod-validated, cached in memory for 24h per `tmdbId`, and shared between concurrent callers. It runs after the cache miss and **before** the advisory lock. On any failure the model writes without it. Free-text titles get no TMDB context.
- **Why:** For a recent or unreleased film (*Avengers: Doomsday*, 2026) the model has nothing in its training data and replied "I'm sorry … beyond my training data" — which we then stored as a fact. TMDB knows the cast, directors, studio, premise and release date, which is enough for a real, specific fact about an upcoming film. Fetching before the lock keeps the lock's hold time bounded by the OpenAI deadline alone, so the timeout invariant is unchanged. The 24h cache means one TMDB call per film per day per server; the in-flight sharing means a 10-request burst makes one call, not ten.
- **Considered:** Fetching inside the lock (simpler, but adds up to 3s to every waiter's wait and eats into the invariant's margin). Storing details in the database (a migration and a refresh policy for data that changes as films approach release; the in-memory cache is enough at this scale). Web search for the model (another dependency, slower, harder to keep factual).

### Refusals are never stored or shown

- **Decision:** A reply that is empty, under 20 characters, or matches a refusal pattern ("I'm sorry", "I can't", "as an AI", "training data", "knowledge cutoff", "NO_FACT", …) is not used. `generateFact` retries once with a stricter prompt ("use only the provided data"); if that is also unusable it throws, and the service falls back to the latest stored fact (`stale: true`) or `UPSTREAM_FAILED`. Rows already stored by older builds that look like refusals are skipped by the 60s cache, the avoid list and the fallback.
- **Why:** The prompt alone can't guarantee behaviour; the check makes "a refusal is never a fact" a property of the code. The strict retry rescues most cases, especially once TMDB data is present. The model is told to answer `NO_FACT` if it truly knows nothing about a free-text title, which gives us a clean signal instead of a guessed fact. Everything stays inside the one 8s deadline, and the transport retry is used at most once per call, so the worst case is bounded.
- **Considered:** A second "judge" model call to classify replies (doubles cost and latency for a problem a dozen patterns catch). Deleting old refusal rows with a migration (destructive, and read-time filtering already hides them). Accepting occasional false positives: a real fact containing "training data" would be rejected and retried — acceptable, because the fallback still serves a real fact.

### Fact strategy is chosen in code: knowledge vs grounded

- **Decision:** `chooseFactMode(details, MODEL_KNOWLEDGE_CUTOFF, today)` in `lib/fact-prompt.ts` picks the prompt before calling the model. **knowledge** — no TMDB details (free-text title), or the film is `Released` with a release date before the cutoff: the model writes trivia from its own knowledge and TMDB is cut down to title, release date and directors, just enough to identify the film. **grounded** — unreleased, in production, no known date, or released on/after the cutoff: the model may use only the TMDB data. If a knowledge-mode reply is rejected and TMDB details exist, the one content retry runs in grounded mode with the full data, inside the same 8s deadline. `MODEL_KNOWLEDGE_CUTOFF` is an env var (YYYY-MM-DD, default `2024-01-01`, validated at startup) and should move with `OPENAI_MODEL`.
- **Why:** The previous single prompt handed every film the full TMDB record and asked for a fun fact, so the model took the easy path and summarized it ("directed by…, starring…, runs 170 minutes"). For films it knows, the interesting material (production stories, effects, casting) is in its own knowledge, not in TMDB; for films it can't know, TMDB is the only safe source. Deciding which case applies is a date comparison, so it belongs in code where it is deterministic, testable and logged (`mode`, `usedMode`), not left to the model to judge.
- **Considered:** Letting the model decide from the data (it can't reliably tell what it doesn't know, which is how the original refusal happened). Asking the model for its own cutoff (unreliable). Always grounded (safe but dull for classic films). Always knowledge (refusals or invented details for new films).

### Grounded mode: every claim must come from the TMDB data

- **Decision:** The grounded prompt (and its strict retry) contains a hard source rule, `GROUNDED_SOURCE_RULE` in `lib/fact-prompt.ts`: every claim must come directly from the provided TMDB data (overview, tagline, cast, crew, studios, dates, status, genres, keywords); no claims about filming locations, practical effects, CGI, budgets, behind-the-scenes events or production difficulties unless the data states them; when the data is thin, write about the premise, the cast or the franchise tie-in and, if the film isn't out yet, say it is upcoming. Grounded mode also gets its own "what to write" section and its own examples (made-up films showing how to turn data fields into a fact, plus a "bad: claim not in the data" example), and is told to ignore an `angle` the data can't support. TMDB keywords are now fetched in the same details call (`append_to_response=credits,keywords`, up to 10).
- **Why:** The shared prompt asked every mode for behind-the-scenes stories, locations and effects, and its good examples (*Jaws*, *The Lord of the Rings*) were exactly that. For an unreleased film the model has no such knowledge, so following those instructions meant inventing them. A film with only an overview, a cast and a release date still supports a genuine fact (a casting reversal, a source-material tie-in, a premise twist); it doesn't support "the battle scenes were shot in Iceland". Keywords ("based on comic", "sequel", "time travel") are often the best hook for those facts and cost nothing extra to fetch.
- **Considered:** Post-checking grounded replies for words like "filmed", "CGI" or "budget" and rejecting them (brittle: those words are fine when the data says them, and a retry costs latency). A separate angle list for grounded mode (the "ignore the angle if the data has nothing on it" rule covers it for now; revisit if logs show `music or score` angles producing weak grounded facts).

### Prompt asks for "did you know?" facts, with a rotating angle and examples

- **Decision:** The system prompt requires a genuinely surprising fact (behind-the-scenes stories, production challenges, casting stories, locations, effects, music, source material, cultural impact, awards, easter eggs, little-known trivia) and forbids facts that only list director / cast / runtime / studio / genre / release date, or that restate the plot. It includes two good and two bad generic examples (style only, marked "never reuse"). The server passes an `angle` hint that rotates through seven topics based on how many facts the user already has for this movie (per-mode lists since the hallucination changes below: knowledge mode swaps "casting" for "filming techniques and sets"), and the avoid list grows from 3 to the last 10 facts for this user and exact title.
- **Why:** Telling a model what *not* to write, with a concrete bad example, is the most reliable way to stop credit-list summaries. The angle hint spreads facts across topics so consecutive facts don't all come from the same area; deriving it from the fact count makes it deterministic and needs no extra state. Ten avoid entries cover the last ten minutes of facts, which is about how long one sitting lasts. The angle is a suggestion, so the model can switch when the angle has nothing true to say (e.g. "music" for an unreleased film).
- **Considered:** Random angles (non-deterministic, harder to test, can repeat). Storing the angle on each `Fact` row (a migration for little gain). A longer avoid list (more tokens on every call for diminishing returns). Real examples about the user's own film (would leak into the output).

### Fact history: keyset pagination, a new index, dashboard only

- **Decision:** `GET /api/facts/history` returns the user's facts newest first, paginated by cursor (`?cursor=<id of the last item>`), ordered by `createdAt desc, id desc`. A new index `(userId, createdAt desc, id desc)` serves it. The cursor is looked up scoped to the session user, so an unknown id or another user's id is `400 Invalid cursor` and never reveals anything. Refusal rows are skipped in code with bounded batches. Own rate limit (30/min), `no-store`. The UI lives only in the dashboard hero, below the FactCard, shows 5 facts per page (`HISTORY_PAGE_SIZE`, sent explicitly as `limit=5`; the API's own default of 10 and max of 50 are unchanged), and refreshes page 1 when the card reports a new fact. Five keeps the section shorter than the hero beside it; the timeline is a secondary panel, not the main content.
- **Why:** Keyset pagination is stable while new facts arrive every minute (an offset would shift and repeat items), and `id` breaks ties between facts with the same `createdAt`. The existing `(userId, movieTitle, createdAt)` index can't order *all* of a user's facts by time without a sort over every row, and an active user adds ~60 rows an hour, so the small extra index is worth it. Refusal patterns aren't expressible in SQL, so they're filtered after reading, in batches of `limit + 1`, up to 5 per request, so skipped rows don't shrink pages and the work per request stays bounded. The history keeps its own component state and is driven by an observe-only `onFactShown` callback, so it can't affect the fact cache, the lock, the countdown or `useFact`.
- **Considered:** Offset pagination (duplicates and gaps as new facts arrive). Encoding `createdAt` in the cursor (an opaque id is simpler and the scoped lookup doubles as the authorization check). Per-movie history (the badge shows the title instead, so a user who changed movie still sees everything). Caching history in sessionStorage (no need: it's cheap and must never outlive a session).

### "New fact" is not shown in the normal state

- **Decision:** The FactCard has no action button while a current fact is showing and the countdown is running. A button appears only when the user can change the outcome: **Try again** after a failed load; **New fact** when the fact shown is a server `stale: true` fallback; **New fact** when the countdown passed 0:00 (plus a 2s grace) and the new fact hasn't arrived, in which case it replaces the slow automatic request.
- **Why:** Facts refresh automatically at the end of each 60s window, and the server's window can't be bypassed: a "New fact" click inside it just returns the same fact. An always-visible button promises a control that doesn't exist, invites repeated clicks that do nothing (and use up the rate limit), and needs a "Same fact for now" explanation to undo the confusion it created. Shown only in the three cases above, the button always means "this might actually help". The 2s grace keeps it from flashing during every normal sub-second swap at 0:00.
- **Considered:** An always-visible but disabled button with a tooltip until 0:00 (still suggests manual control is the normal path). Showing it at exactly 0:00 (flashes for a fraction of a second every minute). Removing it entirely (no way to recover from a stale fallback or a hung request without reloading).

### The client fact cache persists in sessionStorage

- **Decision:** The client cache is an in-memory map mirrored to `sessionStorage`, keyed by `userId` and exact movie title (`movie-memory:fact:v1:<userId>:<title>`). The validity rule is unchanged and applies to stored entries too: a hit only while `now < min(fetchedAt + 30s, generatedAt + 60s)`, server-clock corrected. Stored values are Zod-validated, and must name the same user and title as their key; malformed or expired entries are ignored and removed. Every storage call is wrapped in try/catch with a silent memory-only fallback, and nothing is logged. It is cleared on sign-out, on an expired session (401), and per movie on edit. On mount it is read in a layout effect, so a reload doesn't cause a hydration mismatch or a skeleton flash.
- **Why:** A reload within the same tab (or a quick back/forward through a full navigation) shouldn't cost a round-trip to show a fact the client already has and that is still current. `sessionStorage` is the right scope: per tab, gone when the tab closes, not shared with other tabs. Because expiry is bounded by the server's window, persistence can't make the dashboard show anything older than it would without it.
- **Considered:** `localStorage` (outlives the tab and is shared across tabs, so a second account in another tab or a shared computer could see facts later; more to clear on sign-out). IndexedDB (async API, overkill for one small JSON value per movie). Not persisting (one extra request per reload; the server's 60s cache makes that cheap, so this is a convenience, not a necessity). Storing without validation (storage is user-editable and can hold stale shapes from older builds). Facts and user ids in sessionStorage are readable by any script on our origin, the same as the page itself; nothing more sensitive than what the page already shows is stored.

- **Dev logging:** cache decisions (hit / miss and why / write / cleared / restored / storage unavailable) are logged as `[fact-cache] …` through one helper, `lib/dev-log.ts`, only when `NODE_ENV === "development"` — never in production (Next.js inlines the check, so it compiles away) — and only numbers and fixed words, never fact text, user ids or emails.

### The dashboard never shows a fact past its 60s window

- **Decision:** A client-cache entry is a hit only while `now < min(fetchedAt + 30s, generatedAt + 60s)`, with `generatedAt + 60s` converted to browser time using the `serverNow` offset measured when the fact arrived. On mount an expired entry is never painted: the card shows the skeleton and fetches. Automatic loads always go to the server, with one timer that is cleared and rescheduled for each new fact. A load that starts late (the tab was hidden past the window) takes the expired fact off screen while loading; if it fails, the old fact returns only as a labelled fallback ("Showing the last available fact"). The only facts shown past their window are labelled ones: a server `stale: true` fallback, or the last fact after a failed load.
- **Why:** With a plain 30s TTL measured from the fetch, a fact received at age 59s stayed "fresh" in the cache until age 89s — half a minute past the moment the server would have replaced it — and a tab hidden for an hour showed an hour-old fact until its request finished. Bounding the cache by the server's own window keeps the client and server agreeing on what "current" means, and the clock offset keeps that true on machines whose clocks are wrong.
- **Considered:** Hiding the fact during *every* auto-swap, including the on-time one at 0:00 — strictly simpler, but it flashes a skeleton every minute for a request that usually takes well under a second; the on-time swap keeps the fact visible for that moment and fades to the new one (documented in `CONCURRENCY.md` as the one deliberate exception). Caching `stale: true` facts for 30s (would show a fallback again on remount without asking the server whether OpenAI has recovered).

### Knowledge-mode cutoff moved earlier, to 2024-01-01

- **Decision:** The default `MODEL_KNOWLEDGE_CUTOFF` moved from `2024-06-01` to `2024-01-01`, so films released in 2024 or later use grounded mode (TMDB data only).
- **Why:** Knowledge mode can state false trivia for films released close to the model's training cutoff: the model knows *of* the film but has seen little reliable coverage of it, so it fills gaps confidently. Fact-checking a *Dune: Part Two* (released 2024-03-01) fact turned up exactly that. Moving the cutoff a few months earlier than the model's nominal one trades some trivia for those films for facts that come only from TMDB data.
- **Must be updated if the model changes:** the cutoff belongs to `OPENAI_MODEL`. When the model changes, set `MODEL_KNOWLEDGE_CUTOFF` to a date comfortably before the new model's training cutoff.
- **Considered:** Keeping 2024-06-01 and relying on the accuracy rule (it already applied, and still produced the false fact). Grounded mode for everything (dull facts for classics, where knowledge mode is reliable).

### Hallucination mitigation in knowledge mode, and its limits

- **Decision:** Four changes aimed at invented trivia when the model writes from its own knowledge:
  1. **Lower temperature:** `FACT_TEMPERATURE = 0.4` (was 0.8) for every fact call. Variety now comes from the rotating angle and the 10-fact avoid list rather than sampling randomness.
  2. **Accuracy rule** (`KNOWLEDGE_ACCURACY_RULE`, in the knowledge prompt and its strict retry): only facts widely documented in interviews, press coverage or the film's official materials; no claims about who else was considered or auditioned, who turned a role down, exact quotes, exact numbers or dates, or real people's personal motivations unless fully certain; never a casting alternative; when unsure, a safer, famous, well-documented fact (a well-known filming technique, the score, a real technical consultant, a verified record).
  3. **No casting angle in knowledge mode:** the knowledge angle list replaces "casting" with "filming techniques and sets", and "casting stories" is gone from the knowledge topic list. Grounded mode keeps "casting", because there the cast comes from the TMDB data.
  4. **Examples:** the knowledge prompt adds a third bad example, a casting-alternative claim ("X was the studio's first choice for the lead but turned it down"); none of the good examples involve casting alternatives.
- **Why:** The invented facts we saw clustered in a few shapes: "A was first choice but turned it down", "B auditioned for the role", made-up quotes, and confident but wrong numbers or dates. These are the details models get wrong most often, because the real stories are common and the specifics vary. They are also the hardest for a reader to spot. Production techniques, scores and records are better documented and repeated consistently across sources, so the model's recall of them is more reliable. A lower temperature makes the model pick its most likely continuation, which for well-known films is usually the documented one.
- **Limits — this reduces hallucination, it does not eliminate it:**
  - The model can still be confidently wrong about a "well-documented" fact; nothing here verifies claims against a source.
  - "Fully certain" is the model's own judgement, which is not calibrated; the rule lowers the rate, not to zero.
  - Lower temperature means a little less variety in wording; repeated facts are still prevented by the avoid list, not guaranteed unique.
  - The rules are prompt instructions only: there is no code-level check that rejects, say, "turned down the role". A keyword filter would catch some cases but also reject true facts ("X famously turned down the sequel"), and every rejection costs an extra call within the 8s deadline.
  - Grounded mode is the strong guarantee (every claim must come from TMDB data); knowledge mode trades that for more interesting facts about films the model knows.
- **Considered:** Verifying each fact against a second source (Wikipedia / a search API: another dependency, more latency, and its own matching errors). A second "fact-check" model call (doubles cost and time, and the checker hallucinates too). Grounded mode for every film (safe but dull, which is the problem the knowledge mode solved). Temperature 0 (repetitive wording across facts for the same film).

### OpenAI model is configurable; default `gpt-4.1-mini`

- **Decision:** `lib/env.ts` reads an optional `OPENAI_MODEL` (blank or unset → `gpt-4.1-mini`; malformed ids fail at startup), and `lib/openai.ts` sends it as `model`. The request stays a plain Chat Completions call with `max_tokens` and `temperature`, so the configured model must be a **non-reasoning chat model** (e.g. `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o-mini`). The model id is logged on `fact.openai_call` / `fact.openai_fallback`.
- **Why:** Switching models (cost, quality, a fine-tune, a newer release) should be a config change, not a code change. `gpt-4.1-mini` writes noticeably better 2–3 sentence facts than `gpt-4o-mini` at a similar price and latency, well inside the 8s deadline. **But a newer model is not the fix for recent or unreleased films:** any model only knows what was in its training data, so a film announced or released after its cutoff (*Avengers: Doomsday*, 2026) is unknown to it no matter how new the model is. That is why facts are grounded in TMDB data passed with each request (see "Facts are grounded in TMDB details"); the model's job is to write a good fact from that data, not to remember the film.
- **Considered:** Hard-coding the model (needs a deploy to change). Supporting reasoning models (`o`-series and similar) too — they reject `temperature`, need `max_completion_tokens`, and spend part of the 8s deadline thinking, which is the wrong trade for a two-sentence fact; not worth a second code path. Validating against a list of known model names (goes stale with every release; a bad id surfaces quickly as `fact.openai_fallback` in the logs).

### Longer facts: 2–3 sentences

- **Decision:** The prompt asks for 2 to 3 sentences (about 40–70 words). `max_tokens` is 200 and the stored text is capped at 450 characters, cut at a sentence end when one is close, otherwise at a word boundary with "…".
- **Why:** One sentence under 240 characters was often too thin to be interesting, especially with TMDB context to draw on. 200 tokens comfortably fits 70 words without letting the model ramble.
- **Considered:** Keeping one sentence (thin). Letting the UI truncate instead (the stored fact should already be the final text).

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

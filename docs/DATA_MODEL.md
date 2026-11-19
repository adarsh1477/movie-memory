# Data Model

Postgres 16 + Prisma 5. Four domain tables beyond the Auth.js adapter set.

## Schema

```prisma
// prisma/schema.prisma

datasource db { provider = "postgresql"; url = env("DATABASE_URL") }
generator client { provider = "prisma-client-js" }

// ── Auth.js adapter tables (standard) ───────────────────────────────

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ── Domain tables ───────────────────────────────────────────────────

model User {
  id            String    @id @default(cuid())
  name          String?
  email         String    @unique
  emailVerified DateTime?
  image         String?
  createdAt     DateTime  @default(now())
  movie         Movie?
  facts         Fact[]
  accounts      Account[]
  sessions      Session[]
}

model Movie {
  id         String   @id @default(cuid())
  userId     String   @unique
  title      String
  tmdbId     Int?
  year       Int?
  posterPath String?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Fact {
  id         String   @id @default(cuid())
  userId     String
  movieTitle String
  content    String
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, movieTitle, createdAt(sort: Desc)])
}
```

## Per-choice reasoning

**`User.email` is `@unique` but `name` and `image` are nullable.** Google guarantees an email on every account; the display name and photo can both legitimately be absent. The nullability lets the DB enforce what Google guarantees and nothing more. Rendering handles the nulls (initials avatar; email prefix as name fallback).

**`Movie.tmdbId`, `Movie.year` and `Movie.posterPath` are nullable and written together.** They come from the search result the user picks in the onboarding combobox (and, from Stage 7, the inline edit). All three are `null` for a free-text title, which is only accepted when TMDB search is degraded or has no match. Saving a free-text title also clears any previous `tmdbId`/`year`/`posterPath`, so a poster can never belong to a different film than the title.
- `tmdbId` identifies the exact film. Not `@unique`: many users can share a favorite. Kept for future refreshes (re-fetch poster by id) rather than read today.
- `year` disambiguates same-title films (*Heat* 1986 vs 1995). It is passed to the OpenAI prompt and shown on the dashboard.
- `posterPath` stores the TMDB-relative path (e.g. `/abc123.jpg`), never a full URL, so the image base or size can change without a migration. It is validated with a strict regex because it can arrive from the client on save. This is distinct from the landing page poster wall, which calls `getPosterWall()` (a cached in-memory TMDB pool) at render time and never touches the database. `null` renders the gradient film-frame fallback; the app never breaks regardless of this column's value.

**Known limitation: facts are keyed by title, not by `tmdbId`.** `Fact.movieTitle` is the cache and avoid-list key, so switching from *Heat* (1995) to *Heat* (1986) keeps the same 60s cache entry and avoid list. Rare enough to accept; the fix would be a `Fact.tmdbId` snapshot added to the index.

**`Movie` is one-to-one with `User`.** The spec is about "the favorite movie" — singular. A list of movies would complicate the 60s cache lookup key and the "edit movie → invalidate" flow for Variant B. Keeping it as a single row means `prisma.movie.upsert({ where: { userId } })` and the onboarding and edit flows share the same code path.

**`Movie.userId` is `@unique` (not `@@unique([userId])`).** Enforces the one-to-one at the DB level and lets Prisma expose `User.movie: Movie?` as a scalar relation.

**`Fact.movieTitle` is a snapshot, not an FK to `Movie.id`.** Three reasons:
1. The 60s cache lookup is literally "most recent fact for this user AND this current title." When a user edits their movie, Variant B must not serve stale facts tagged to the old title; snapshotting makes the invariant structural — the stale rows simply won't match the new query key.
2. An FK would require a decision when the title changes: delete old facts (loses the history) or leave them pointing at a row whose `title` has mutated (misleading). The snapshot sidesteps both.
3. The 60-char-ish snapshot cost is negligible compared to the content field.

**Composite index `(userId, movieTitle, createdAt DESC)`.** The hottest query is `findFirst where userId = ? and movieTitle = ? order by createdAt desc`. This index serves it directly without a sort. Including `userId` at the leading position lets the same index also serve `delete where userId = ?` when a user is removed (authorization/privacy cascade).

**`onDelete: Cascade` everywhere pointing at `User`.** When a user signs out and then deletes their account (future feature, not shipped), their movie, facts, sessions, and accounts should all go. Cascade makes this a single `DELETE user` — no orphans, no admin scripts.

**No `status` column on `Fact` (yet).** The claim-row pattern (see PLAN.md tradeoffs) would introduce `status: 'pending' | 'ready'`. We opted for the simpler "write only on success" model for this scope; adding the column later is a non-breaking migration.

**No separate `RateLimit` table.** The sliding window is in-process by design — Redis or a dedicated table is the horizontal-scale upgrade, not v1.

## Migration

Initial migration generated by `pnpm prisma migrate dev --name init`, followed by:
- `fix_authjs_fields` — `User.emailVerified` (required by the Auth.js adapter)
- `add_movie_poster_path` — `Movie.posterPath`
- `add_movie_tmdb_id_year` — `Movie.tmdbId`, `Movie.year` (both nullable, so existing rows stay valid)

Subsequent schema changes also use `migrate dev` locally; `migrate deploy` is used in CI and any remote environment.

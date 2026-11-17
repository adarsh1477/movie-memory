# CLAUDE.md

Project context for future sessions. Read `docs/` for depth; this file is the index.

## Stack

Next.js 16 App Router, TypeScript strict, Prisma 5 + Postgres 16, Auth.js v5 (Google, DB sessions), OpenAI (`gpt-4o-mini`), Vitest + RTL, Tailwind v3, pino.

## Commands

- `docker compose up -d` — start local Postgres
- `pnpm prisma migrate dev` — apply migrations locally
- `pnpm dev` — run the app
- `pnpm test` — run all Vitest suites
- `pnpm lint` — run ESLint 9 flat config directly (Next 16 removed `next lint`)
- `pnpm tsc --noEmit` — typecheck

## Folders

- `app/` — routes, server components, API handlers, error boundaries
- `components/` — client components (Sidebar, TopBar, Avatar, MovieHeroCard, FactCard)
- `lib/` — env, auth, prisma, openai, fact-service, lock, rate-limit, logger, clock, validation, api, errors, client-cache
- `prisma/` — schema + migrations
- `tests/` — Vitest suites
- `docs/` — design decisions, architecture, concurrency, data model, LLD, test plan, UI spec

## Key rules

- OpenAI calls are server-side only. No `OPENAI_API_KEY` in any `NEXT_PUBLIC_*` var or client bundle.
- Fact generation uses a blocking Postgres advisory lock + 60s cache + 30s client cache. See `docs/CONCURRENCY.md`.
- Timeout invariant: **OpenAI 8s < lock_timeout 10s < tx timeout 20s**. Do not reorder.
- Every mutation is Zod-validated server-side (`lib/validation.ts`).
- Every query is scoped by the session's `userId`. Never trust client-supplied ids.
- `auth()` in server components and route handlers is the real guard. `proxy.ts` is UX only — cookie-presence redirect, no verification.
- Lock-wait timeout (55P03) serves the latest stored fact with `stale: true`; only error when no prior fact exists.

## UI tokens

See `docs/UI_SPEC.md` for the dark palette, Inter typography, `rounded-2xl` cards, 150–200ms transitions, focus rings.

## Working rules

- Build in the stages listed in `docs/PLAN.md`. Don't jump ahead.
- Keep answers brief.
- Read `docs/` instead of re-exploring the repo.
- Run `pnpm test` after each stage.

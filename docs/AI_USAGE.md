# AI Usage

> Stub — edit before submitting.

- I used Claude Code for planning, writing the docs under `docs/`, and implementing the app in stages.
- I used a separate Claude chat to review the plan and challenge the design before any code was written.
- I set the scope (Base + both variants), chose the stack specifics (Auth.js v5, Vitest + RTL, Next.js 16), and picked the deployment posture (local-first, Vercel-ready — so the per-user lock had to be DB-backed, not in-memory).
- I pushed back on the initial design in several places — see `docs/DECISIONS.md` for the specific challenges. I decided what to keep, what to simplify, and what to defer.
- I reviewed the generated Prisma schema, the fact-service concurrency logic, and the API contracts by hand before accepting them.
- I verified behavior by running `pnpm test` (all seven Vitest suites, including the real-Postgres lock test) and by exercising the app manually per the verification plan in `docs/PLAN.md`.
- I verified docs claims (Auth.js v5 patterns, Next.js 16 `proxy.ts` rename, Prisma 6 `$transaction` syntax) against the current upstream documentation during planning, not just from training data.

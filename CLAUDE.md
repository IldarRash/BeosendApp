# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Invariants (non-negotiable)

- This is the **BeoSand** booking system — a Telegram bot for a beach-volleyball school in
  Belgrade. It covers **two domains in one bot**: training-session booking (school) and
  court-rental requests (Edition 2). Keep both working; never let one regress the other.
- **Telegram is an interaction layer, not the source of truth.** Structured domain state
  (`Group → Trainings → Bookings`, `Courts → Requests → Assignments`) is authoritative for
  schedules, availability, and money.
- **The bot never writes to domain tables directly.** Every read/write goes through `apps/api`
  services that validate input (Zod contracts from `packages/types`), ownership (by `telegram_id`),
  availability/capacity, and status transitions. Repositories are the only DB access.
- **Capacity and status are recomputed server-side after every booking/cancel** (15.2). A training
  flips `open ↔ full` automatically; `full`/`cancelled` slots are never offered as bookable.
- **Monthly group booking creates one booking per training instance** (a batch linked by
  `group_subscription_id`). Cancelling one date must never drop the rest of the month.
- **Court assignment is admin-only and manual.** Clients request a *time* and never see or choose a
  court number. Never confirm more requests than there are courts for any overlapping hour.
- **Money is always RSD** (whole dinars). Prices and totals are computed server-side; the bot only
  displays them.
- Mandatory architecture (section 18 of the spec): **Group → Trainings → Bookings.**

## Commands

All commands run from the repo root. Package manager is **pnpm 10** (via corepack); orchestration is
**Turborepo**.

```text
corepack pnpm install     # install all workspaces
pnpm dev                  # run full dev stack (turbo dev) — API :3000, bot (long polling), admin :5173
pnpm lint                 # eslint across workspaces (--max-warnings=0, so warnings fail)
pnpm typecheck            # tsc --noEmit across workspaces
pnpm test                 # vitest run across workspaces
pnpm build                # turbo build (tsc per package → dist)
```

Database (local Postgres via Docker Compose):

```text
pnpm db:up                # start Postgres container
pnpm db:migrate           # apply Drizzle migrations
pnpm db:seed              # seed reference data (levels, trainers, 6 courts)
pnpm db:down              # stop Postgres
pnpm --filter @beosand/db db:generate   # generate a new migration after schema changes
```

Scope to one package/app and run the **narrowest useful** check after a change:

```text
corepack pnpm --filter @beosand/api typecheck
corepack pnpm --filter @beosand/api test
corepack pnpm --filter @beosand/admin dev          # admin console at http://localhost:5173 (needs API + VITE_API_URL)
corepack pnpm --filter @beosand/types exec vitest run src/helpers.spec.ts
```

## Architecture

TypeScript monorepo. Apps live in `apps/*`, shared code in `packages/*`. Never import one app into
another; cross-cutting code goes through `packages/*`.

```text
apps/api        NestJS modular monolith (:3000) — domain source of truth, scheduler, outbound Telegram sends
apps/bot        grammY Telegram bot — interaction layer; calls apps/api via a typed ApiClient
apps/admin      React + Vite admin console (:5173) — interaction layer; calls apps/api via a typed ApiClient. Reuses packages/types; never imports packages/config (server secrets)
packages/types  Shared Zod contracts + pure domain helpers (the contract source of truth)
packages/db     Drizzle schema + migrations (the only place schema/migrations live) + Postgres compose
packages/config Shared tsconfig + fail-closed env contract (Zod)
```

### Backend layering (apps/api)

NestJS modular monolith, **one module per domain** (`clients`, `levels`, `trainers`, `groups`,
`trainings`, `bookings`, `waitlist`, `notifications`, `broadcasts`, `analytics`, `courts`,
`court-requests`, `admin`). Within a module: **controllers stay thin → services own domain logic →
repositories own DB access.** Validate all API inputs and bot-facing outputs with Zod contracts from
`packages/types`. Use typed Nest exceptions; never swallow failures.

### The bot (apps/bot)

grammY, long polling in dev. Handlers are thin: parse the update, call the `ApiClient`, render
keyboards/messages. No domain logic, no DB access, no money math in the bot. Conversation/flow state
(onboarding, multi-step booking) lives in the bot; the *decisions* live in `apps/api`.

### The admin console (apps/admin)

React + Vite SPA for the manager/admin, the web counterpart to the bot and subject to the same rule:
an **interaction layer only** — no domain logic, money, or availability math. It calls `apps/api` via a
typed `ApiClient` and validates every rendered value against a `packages/types` contract. It reads
browser config from `import.meta.env` (`VITE_*`) and **must never import `@beosand/config`**, which
loads server secrets from `process.env`. Currently a scaffolded shell (live `/health` panel); real
admin auth and endpoints are a follow-up feature. See `.claude/rules/frontend.md`.

### Notifications & schedule

Reminders (24h/3h), waitlist promotion, and broadcasts run from a scheduler in `apps/api`
(`@nestjs/schedule`). Outbound Telegram sends use the bot token directly from the API; the
`notifications` table logs sends for idempotency and analytics.

## Testing expectations

- Test the behavior changed by the task, not framework defaults.
- Unit-test domain services and pure helpers (`packages/types/src/helpers.ts`); integration-test when
  behavior crosses controller/service/repository/DB boundaries.
- Test Zod schemas for API inputs and bot-facing outputs.
- Always test **capacity recompute** and **status flips** (`open/full`), and **monthly-batch**
  booking + single-date cancellation.
- For court flows, cover the **6-per-hour** confirmation limit and that clients never receive a court
  number before admin confirmation.

## Refactoring

When refactoring, **remove the superseded path** in the same change — dead files, exports, obsolete
tests, stale config. Don't layer a new path while leaving the old one. Call out any remaining legacy
by name in your final summary.

## Git & deployment

- Create a feature branch (`feature/<slug>` or `fix/<slug>`) before feature work; don't work on `main`.
- Inspect `git status` / `git diff` first, stage only files relevant to the approved change, and don't
  disturb unrelated changes. Commit/push only when the user asks.
- Never stage secrets, `.env`, `.idea/`, `.turbo/`, `dist/`, or local runtime artifacts.

## Operating layer (subagents, skills, rules)

This repo ships a Claude operating layer under `.claude/`:

- `.claude/agents/*` — specialized subagents (planner, backend/bot/frontend implementers, ui-designer,
  test-writer, reviewer, security-reviewer, app-runner). Delegate role-specific work to them via the
  Agent tool.
- `.claude/skills/*` — invocable workflows (backend / bot-flow / frontend implementation,
  frontend-design, feature planning, test writing, security review).
- `.claude/rules/*` — detailed style/security/layering rules; consult the relevant file when working
  in its area.

For larger features, the multi-agent workflow is described in `AGENTS.md` and
`.claude/rules/agent-workflow.md`: a planner clarifies scope and writes a feature brief in
`docs/product/features/<slug>.md`, then delegates implementation/tests/review/run-verification to
subagents. A feature is "done" only when it works in the running bot/API or a concrete blocker is
reported.

## Useful docs

`docs/architecture/overview.md`, `domain-model.md`, `database.md`; `docs/product/feature-roadmap.md`
and the per-feature briefs under `docs/product/features/`.

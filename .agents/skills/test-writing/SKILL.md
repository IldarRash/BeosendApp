---
name: test-writing
description: Write Vitest unit/integration tests for a BeoSand change covering domain services, pure helpers, Zod contracts, and the invariant the feature touches. Use after or alongside implementation.
---

# Test writing

Cover the behavior the task changed, not framework defaults.

## What to test

- **Pure helpers** (`packages/types/src/helpers.ts`) - status recompute, free seats, month dates,
  court price/hours. Fast, no Nest/DB.
- **Domain services** - unit-test logic with repositories faked; integration-test when behavior
  crosses repository/DB boundaries.
- **Contracts** - valid input parses; invalid input is rejected (bad time, negative capacity, unknown
  fields).
- **Invariants for the feature** - always include:
  - capacity recompute + `open/full` flip after booking/cancel;
  - monthly-batch creates one booking per training date; single-date cancel leaves the rest;
  - waitlist promotion order;
  - court 6-per-hour confirmation limit; client never gets a court number pre-confirmation.
- **The unsafe/forbidden path** - acting on another user's record, double-booking a full slot,
  over-confirming a court hour, a non-admin hitting an admin endpoint.

## Conventions

`*.spec.ts` next to the unit. `vitest run`. Deterministic dates (pass year/month/fixed clock); no real
network/Telegram. Keep fixtures small and readable.

## Running checks

Use the repository runner instead of ad hoc commands:

- `pnpm check` runs full workspace lint, then full workspace tests.
- `pnpm check <scope>` runs lint and tests for one workspace scope. Scope may be a short alias
  (`admin`, `api`, `bot`, `miniapp`, `types`, `db`, `config`, `i18n`), a workspace path
  (`apps/admin`, `packages/types`), or an explicit pnpm filter (`@beosand/admin`).

When the user asks to "check tests" or "run tests", run `pnpm check` unless they explicitly ask for a
scoped run.

## Done

New tests fail before the fix and pass after; `pnpm check` green across the workspace.

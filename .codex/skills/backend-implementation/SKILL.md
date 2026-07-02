---
name: backend-implementation
description: Implement an apps/api domain module (controllerв†’serviceв†’repository) plus its Zod contracts and Drizzle schema/migration for a BeoSand feature. Use when adding or changing API behavior, domain logic, or the database schema.
---

# Backend implementation

Build one domain slice in `apps/api`, end to end through the layers, backed by contracts and schema.

## Steps

1. Read the feature brief in `docs/product/features/<slug>.md` and `docs/architecture/domain-model.md`.
2. **Contracts** вЂ” add/adjust schemas in `packages/types` (entity + request schemas, `z.infer`
   types). Put any pure math in `packages/types/src/helpers.ts`.
3. **Schema** вЂ” if new fields/tables are needed, edit `packages/db/src/schema.ts`, then
   `pnpm --filter @beosand/db db:generate` and commit the migration. Keep schema в†” contracts in sync.
4. **Module** вЂ” under `apps/api/src/modules/<domain>/`: `*.controller.ts` (thin, Zod-validated),
   `*.service.ts` (all domain logic, recompute, transactions, typed exceptions), `*.repository.ts`
   (Drizzle only). Register the module in `app.module.ts`.
5. Enforce the invariants in the service: ownership by `telegram_id`, capacity/status recompute,
   monthly-batch integrity, 6-per-hour court limit, server-side RSD pricing.
6. **Tests** вЂ” unit-test the service/helpers; integration-test across repo/DB where it matters.

## Conventions

Follow `.Codex/rules/nestjs-layering.md`, `zod-contracts.md`, `drizzle-migrations.md`, `security.md`.

## Done

`pnpm --filter @beosand/api typecheck lint test` green; new contracts/migration committed; behavior
covered by tests; acceptance criteria from the brief met.


# T1.2 — Trainers reference

**Goal.** Manage trainers (name, main/guest type), the pool groups and trainings reference.

**Spec refs.** ТЗ §3.3.

**Contracts & tables.** `trainerSchema`, `createTrainerSchema` (`packages/types`); `trainers` table
(`telegram_id?` enables the trainer UI in T2.3).

**API.** `apps/api/src/modules/trainers/`:
- `GET /trainers` → active trainers.
- `POST /trainers` (admin) → add (the spec requires adding new trainers).
- `PATCH /trainers/:id` (admin) → edit type/status/`telegram_id`.

**Bot flow.** Managed via the admin console (A1); referenced when creating groups and rendering slots.

**Invariants.** Admin-only writes. A trainer gains the trainer UI only once their `telegram_id` is set.

**Acceptance criteria.**
- Seeded trainers (Milena, Danilo) returned by `GET /trainers`.
- Admin can add a guest trainer; it appears in the list.
- Setting `telegram_id` later enables T2.3 for that trainer.

**Tests.** Service create/list/edit; type enum validation; non-admin rejected.

**Dependencies.** Foundation only.

**Open questions.** None.

---

## Implementation spec (planner brief — agreed)

This is a foundation, API-only vertical slice. It mirrors the existing `levels` module 1:1. No bot
UI is built here: the brief's "managed via the admin console (A1)" refers to a later feature; the
`apps/admin` console auth and trainer screens are out of scope. T1.2's deliverable is the API +
contract surface that group creation, slot rendering, and the future admin console / trainer UI all
read from.

### What already exists (reuse, do NOT recreate)
- `trainers` table in `packages/db/src/schema.ts` (columns: `id`, `name`, `type` enum main/guest,
  `status` enum active/inactive default active, `telegramId` nullable integer). No schema change.
- Contracts in `packages/types/src/training-contracts.ts`: `trainerType`, `trainerSchema`,
  `createTrainerSchema` (picks `name` + `type`, plus optional nullable `telegramId`), `Trainer` type.
- Seed (`packages/db/src/seed.ts`) already inserts Milena and Danilo (both `main`), idempotent.
- `isAdmin(env, telegramId)` and `ENV` injection token (`apps/api/src/config/config.module.ts`).
- `DatabaseService` + `tables` from `@beosand/db`.
- Reference template to copy verbatim in shape: `apps/api/src/modules/levels/*`.

### Contract to add (packages/types, NOT a DB schema change)
- `updateTrainerSchema` — mirror `updateLevelSchema`: a `.partial()` object over
  `{ name: z.string().min(1), type: trainerType, status: entityStatus, telegramId: z.number().int().nullable() }`.
  Export `type UpdateTrainerInput = z.infer<typeof updateTrainerSchema>`. Place it directly under the
  existing Trainers block in `training-contracts.ts`. `index.ts` already re-exports the module.
- No new fields on `trainerSchema`/`createTrainerSchema` or on the DB table. `schemaChange = false`.

### apps/api module: `trainers` (`apps/api/src/modules/trainers/`)
Four files, copied from `levels` and renamed:
- `trainers.repository.ts` — only DB access. Methods: `listActive()` (filter `status = active`, order
  by `name`), `findById(id)`, `create(input: { name; type; telegramId? })`, `update(id, patch)`.
  Returns typed `Trainer` rows. No business rules.
- `trainers.service.ts` — domain logic + auth gate. `listActive()` (client/group-creation facing,
  active only). `create(actorTelegramId, input)` and `update(actorTelegramId, id, patch)` both call a
  private `assertAdmin(actorTelegramId)` that throws `ForbiddenException` via `isAdmin`. `update`
  loads `findById` first, 404s (`NotFoundException`) if missing, returns existing unchanged when patch
  is empty. Status changes are flips (never delete). Logger via Nest `Logger` if any logging is added.
- `trainers.controller.ts` — thin. Reuse the `parseTelegramId(header)` + `validate(schema, input)`
  helpers from the levels controller pattern. Endpoints:
  - `GET /trainers` → `service.listActive()` (no header required; reference data).
  - `POST /trainers` → `validate(createTrainerSchema, body)`, `parseTelegramId(x-telegram-id)`,
    `service.create(actor, input)`.
  - `PATCH /trainers/:id` → `validate(uuid, id)`, `validate(updateTrainerSchema, body)`,
    `parseTelegramId`, `service.update(actor, id, patch)`.
- `trainers.module.ts` — `{ controllers: [TrainersController], providers: [TrainersService, TrainersRepository] }`.
- Register `TrainersModule` in `apps/api/src/app.module.ts` imports.

### Bot / admin
- No bot handlers, keyboards, or `ApiClient` methods in this slice. (Group-creation slot rendering
  that consumes `GET /trainers` is a separate feature; the admin console trainer CRUD UI is A1.)

### Most important invariant
Trainer writes (create / edit type / edit status / set `telegram_id`) are admin-only and enforced in
`TrainersService.assertAdmin` via `ADMIN_TELEGRAM_IDS` — never in the controller or any client. A
non-admin `telegram_id` must not be able to add a trainer or grant itself the trainer UI by setting
`telegram_id`. Trainers are deactivated by a `status` flip, never deleted.

### Unsafe / forbidden path that must be rejected
A non-admin caller (telegram id not in `ADMIN_TELEGRAM_IDS`) calling `POST /trainers` or
`PATCH /trainers/:id` — especially `PATCH` setting `telegramId` to escalate into the trainer UI — must
be rejected with `ForbiddenException` and perform zero writes (repo create/update not called).
Missing/invalid `x-telegram-id` header → `BadRequestException`; invalid body (empty name, bad `type`
enum, non-uuid id) → `BadRequestException`, before any write.

### Tests
- `trainers.service.spec.ts` (fake repo + real `isAdmin` via test `Env`): lists only active; admin
  create; admin edit type and status flip; admin set `telegramId` (and clear to null); non-admin
  create rejected, writes nothing; non-admin update rejected, writes nothing; 404 on missing id.
- `trainers.controller.spec.ts`: header resolves actor; non-admin POST/PATCH → Forbidden, no write;
  missing/invalid header → BadRequest; invalid body (empty name, invalid `type`) → BadRequest;
  non-uuid id on PATCH → BadRequest.
- Contract test (`packages/types`): `createTrainerSchema` rejects an unknown/invalid `type`;
  `updateTrainerSchema` accepts a partial `{ telegramId: null }` and rejects a non-integer telegramId.

### Validation gate
From the worktree root `C:\Users\ilsac\IdeaProjects\BeosendApp-training`:
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then a live `GET /trainers` returns the two
seeded trainers and an admin `POST` adds a guest that appears in the list.

# T1.3 — Groups management

**Goal.** Create and edit groups — the recurring slots (level, weekdays, time, trainer, capacity,
single + monthly RSD prices) that drive training generation.

**Spec refs.** ТЗ §3.4.

**Contracts & tables.** `groupSchema`, `createGroupSchema` (`packages/types`); `groups` table.

**API.** `apps/api/src/modules/groups/`:
- `GET /groups` → active groups (for the client "join a group" list, with seats remaining derived
  from upcoming trainings).
- `POST /groups` (admin), `PATCH /groups/:id` (admin) → create/edit incl. capacity & prices.

**Bot flow.** Client side consumes `GET /groups` in T1.9. Authoring is in A1.

**Invariants.** Admin-only writes. `daysOfWeek` uses ISO 1–7 (Mon–Sun). `endTime > startTime`.
Capacity > 0. Prices are integer RSD. Editing a group does **not** retroactively rewrite already
generated trainings (those carry their own capacity/trainer) unless explicitly regenerated.

**Acceptance criteria.**
- Admin creates "Intermediate, Mon+Wed, 20:00" with capacity and prices; it appears in `GET /groups`.
- Invalid times/empty weekdays/zero capacity are rejected with a typed error.
- Non-admin cannot create/edit.

**Tests.** Contract validation (times, weekdays, capacity, prices); service create/edit; non-admin
rejected.

**Dependencies.** T1.1 (levels), T1.2 (trainers).

**Open questions.** Does editing capacity propagate to future trainings? Default: no automatic
propagation; A1 offers an explicit "change capacity" action on a training.

---

## Implementation plan (planner — smallest correct slice)

### Scope decision

This slice is **apps/api only**: the `groups` domain module. It mirrors the existing `levels` /
`trainers` modules exactly (thin controller + Zod validation, admin-gated service via
`isAdmin(env, telegramId)`, repository as the only DB access). The `groups` table and the
`groupSchema` / `createGroupSchema` contracts already exist and are sufficient.

Explicitly **out of scope** here (separate features, do not build now):
- Bot "join a group" client flow — feature T1.9 (`monthly-group-booking` / available-slots). No bot
  source exists in the worktree yet; this slice ships no bot handler.
- Admin authoring UI — feature A1 (`admin-manager-console`). The admin SPA `ApiClient`
  (`apps/admin/src/api/client.ts`) is the seam; A1 adds the `groups` methods and UI there.

### Seats-remaining: deferred (design fork, default chosen)

The brief's `GET /groups` line mentions "seats remaining derived from upcoming trainings". There is
**no trainings module yet** (T1.4 `month-training-generation` generates training instances).
Computing seats here would force a premature cross-module dependency and duplicate availability math.
**Default (chosen): `GET /groups` returns plain active `Group[]`** (validated against `groupSchema`).
A seats-remaining projection is added in T1.9 when trainings exist and the client list is actually
rendered, reusing `freeSeats` from `packages/types/src/helpers.ts` over upcoming `trainings` rows.
Recorded as an open question below.

### Contracts to add (`packages/types/src/training-contracts.ts`)

`createGroupSchema` already exists (`groupSchema.omit({ id: true, status: true })`). **Add the
missing update contract** next to it (PATCH needs it; `levels`/`trainers` have the equivalent):

```
export const updateGroupSchema = groupSchema
  .omit({ id: true })       // name, levelId, daysOfWeek, startTime, endTime, trainerId,
  .partial();               // capacity, priceSingleRsd, priceMonthRsd, status — all optional
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
```

No new primitives — reuse `uuid`, `timeString`, `dayOfWeek`, `rsd`, `entityStatus` from `common.ts`.
Exported automatically via `packages/types/src/index.ts` (`export * from "./training-contracts"`).

**No DB schema change.** The `groups` table already has every field
(`name, levelId, daysOfWeek, startTime, endTime, trainerId, capacity, priceSingleRsd,
priceMonthRsd, status`). `schemaChange = false`. Do **not** run `db:generate`.

### `endTime > startTime` check

`timeString` validates format only; it cannot compare two fields. Enforce `endTime > startTime` in
the **service** (string compare on `"HH:MM"` is lexicographically correct), throwing
`BadRequestException`. Apply it on create, and on update when either time is present (re-read the
existing row to compare against the unchanged side). Optionally also add a `.refine` on
`createGroupSchema`/`updateGroupSchema`, but the service check is the authoritative guard.

### Files to create (`apps/api/src/modules/groups/`)

- `groups.module.ts` — `controllers: [GroupsController]`, `providers: [GroupsService, GroupsRepository]`.
- `groups.controller.ts` — `@Controller("groups")`; `GET /` → `service.listActive()`;
  `POST /` → validate `createGroupSchema`, resolve actor from `x-telegram-id` header
  (`parseTelegramId` helper, copied from `trainers.controller.ts`), call `service.create`;
  `PATCH /:id` → validate `uuid` + `updateGroupSchema`, call `service.update`. Same `validate()` +
  `parseTelegramId()` boundary helpers as the levels/trainers controllers.
- `groups.service.ts` — `listActive()`; `create(actorTelegramId, input)` and
  `update(actorTelegramId, id, patch)` both call `assertAdmin(actorTelegramId)` first
  (`isAdmin(this.env, actorTelegramId)` → `ForbiddenException`), then the `endTime > startTime`
  guard, then the repo. `update` 404s when the row is missing (mirror trainers); empty patch returns
  existing.
- `groups.repository.ts` — only DB access: `listActive()`
  (`where status = 'active'`, `orderBy asc(name)`), `findById(id)`, `create(values)`,
  `update(id, patch)`. Use `tables.groups` from `@beosand/db` and the injected `DatabaseService`.

### Wiring

Register `GroupsModule` in `apps/api/src/app.module.ts` `imports`.

### Invariant this feature protects

Group writes (create/edit of capacity, prices, schedule) are **admin-only** and structurally valid
(`capacity > 0`, non-empty ISO 1–7 `daysOfWeek`, `endTime > startTime`, integer-RSD prices). A
non-admin caller can never create or mutate a group.

### Unsafe / forbidden path that must be rejected

A non-admin `telegram_id` calling `POST /groups` or `PATCH /groups/:id` must be rejected with
`ForbiddenException` (403) **in the service**, before any DB write — never gated only at the
controller or in the (future) admin UI.

### Tests

- `packages/types` contract tests: valid group accepted; empty `daysOfWeek`, weekday outside 1–7,
  `capacity = 0`/negative, non-integer or negative RSD price, malformed `HH:MM` all rejected.
- `apps/api` `groups.service` tests: admin create returns the row and it appears in `listActive()`;
  admin edit of capacity/price succeeds; `endTime <= startTime` rejected with a typed error;
  **non-admin create and non-admin update both throw `ForbiddenException`**; update of a missing id
  throws `NotFoundException`.

### Open questions

1. Seats-remaining on `GET /groups`. **Default (chosen): omit now**; `GET /groups` returns
   `Group[]`. Add the derived `freeSeats` projection in T1.9 once trainings exist.
2. Editing capacity propagating to future trainings. **Default (chosen, from brief): no automatic
   propagation**; A1 offers an explicit per-training "change capacity" action.

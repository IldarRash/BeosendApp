# T1.4 — Month training generation

**Goal.** Generate concrete `trainings` for a group across a chosen month from its weekdays — the
automation the whole system rests on (15.1).

**Spec refs.** ТЗ §3.5, §15.1, §18.

## Slice

Smallest correct vertical slice: contract type → `trainings` module (controller → service →
repository) → ApiClient methods, against the already-existing `generateMonthSchema`, the
`monthTrainingDates` helper, and the `trainings` table. No DB schema change.

The bot surface is **out of scope for this slice** (see Open question 2): there is no admin bot/menu
yet (`apps/bot` is client-only). This slice delivers the admin-only API end-to-end; the A1 trigger
lands with the admin UI feature.

## Contracts & tables (mostly existing — reuse, do not recreate)

- `generateMonthSchema` — already in `packages/types/src/training-contracts.ts`. **Add only** the
  inferred type `export type GenerateMonthInput = z.infer<typeof generateMonthSchema>;` (the schema
  exists, the type does not). Same file, no schema/DB change.
- `trainingSchema` / `Training` — already exist; reused for responses.
- `monthTrainingDates(days, year, month)` — already implemented + unit-tested in `helpers.ts`.
- `trainings` table — already in `packages/db/src/schema.ts` (id, groupId, date, startTime, endTime,
  trainerId, capacity, bookedCount default 0, status default `open`).
- **New, tiny:** `listTrainingsQuerySchema` in `training-contracts.ts` for `GET /trainings`:
  `{ from: dateString, to: dateString, groupId: uuid.optional() }` with an inferred
  `ListTrainingsQuery` type. Reuses `dateString`/`uuid` primitives from `common.ts`.

No DB field is missing. `schemaChange = false`.

## API — `apps/api/src/modules/trainings/`

Mirror the existing `groups` module layout (controller thin + `parseTelegramId`/`validate` helpers,
service owns logic + `assertAdmin` via `isAdmin(env, ...)`, repository is the only DB access).

- `POST /trainings/generate` (admin) — header `x-telegram-id`, body `{ groupId, year, month }`
  validated by `generateMonthSchema`. Service: `assertAdmin`; load group by id (404 if missing,
  reject if not `active`); compute `monthTrainingDates(group.daysOfWeek, year, month)`; **skip dates
  before today** (default for Open question 1); for each remaining date insert one training copying
  the group's `capacity`, `trainerId`, `startTime`, `endTime`, with `bookedCount = 0`, `status =
  "open"`, `groupId = group.id`. Idempotent: skip any date that already has a training for that
  group. Wrap the multi-insert in a transaction. Returns `Training[]` (only the newly created rows;
  re-run returns `[]`).
- `GET /trainings?from&to&groupId?` (admin) — header `x-telegram-id`, query validated by
  `listTrainingsQuerySchema`. Service: `assertAdmin`; repo returns trainings whose `date` is in
  `[from, to]`, optionally filtered by `groupId`, ordered by `date, startTime`. Returns `Training[]`.

Repository: `listForGroupAndDates(groupId, dates[])` (to compute existing dates for idempotency),
`insertMany(rows[])` inside the caller's transaction, and `listInRange(from, to, groupId?)`. Normalize
Postgres `time` `"HH:MM:SS"` → `"HH:MM"` on read like `groups.repository.ts`.

Register `TrainingsModule` in `app.module.ts`.

## Bot flow

Deferred (no admin bot exists). When the admin UI lands, A1 "create schedule for month" calls the two
ApiClient methods below. ApiClient methods added now so the admin feature can wire straight in:

- `generateMonth(input: GenerateMonthInput, actorTelegramId): Promise<Training[]>` →
  `POST /trainings/generate` with `x-telegram-id` header, validated against `z.array(trainingSchema)`.
- `listTrainings(query, actorTelegramId): Promise<Training[]>` → `GET /trainings?...`.

No domain/money/availability math in the bot; it only renders counts the API returns.

## Invariants

- **Admin-only.** Both endpoints gated by `ADMIN_TELEGRAM_IDS` in the service (`assertAdmin`), never
  in the controller or bot.
- **Idempotent generation.** Re-running for the same group+month creates zero duplicate trainings
  (skip dates already having a training for that group). This is the single most important invariant.
- Generated trainings start `status = "open"`, `bookedCount = 0`, copying the group's capacity,
  trainer, and times.
- Editing a group later does not retroactively rewrite already-generated trainings.

## Acceptance criteria

- Generating Mon+Wed for June 2026 creates 9 trainings (5 Mondays + 4 Wednesdays) when run before
  June (today is 2026-06-03, so with the skip-past default only future June dates are created — see
  test note below).
- Re-running the same month adds none (returns `[]`).
- Each training copies the group's capacity, trainer, and times.
- A non-admin caller is rejected with 403; a missing/invalid `x-telegram-id` is 400.

## Tests

- Helper `monthTrainingDates` — already covered.
- Service: correct count for a known month (use a fixed reference month entirely in the future, e.g.
  generate 2026-07 so the skip-past rule doesn't reduce the count and the 5-Monday/4-Wednesday
  assertion holds deterministically); idempotency (second run inserts none); field copy
  (capacity/trainer/times/status/bookedCount); non-admin rejected (403); unknown group 404; inactive
  group rejected.
- Contract: `generateMonthSchema` accepts valid body, rejects month 13 / year < 2024;
  `listTrainingsQuerySchema` rejects a bad date string.

## Dependencies

T1.3 (groups) — present (`groups` module + `groupSchema`).

## Open questions (with chosen defaults)

1. **Past dates within the chosen month — skip or include?** Default: **skip dates before today**
   (don't generate trainings that already happened). Recorded as the implemented behavior.
2. **Bot trigger now or with the admin UI?** No admin bot/menu exists (`apps/bot` is client-only).
   Default: **ship the admin-only API + ApiClient methods in this slice; the A1 bot trigger lands
   with the admin UI feature.** Avoids inventing a parallel admin surface here.

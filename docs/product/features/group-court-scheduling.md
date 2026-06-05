# Feature: Group court scheduling — auto court blocks + generate all groups

Slug: `group-court-scheduling` · Branch: `feature/court-load-redesign` · Status: planned (brief agreed)

Covers Owner features **2** (auto court blocks under groups) and **3** (generate all groups). Builds
directly on top of Feature 4 (`court-30min-granularity.md`, already landed): court occupancy is
30-minute-aware and the single occupancy math lives in `packages/types/src/helpers.ts`.

## Goal

Two admin conveniences that close a real double-booking gap between the two domains (school trainings
vs. court rental):

1. **Auto court blocks (Feature 2).** When the admin generates a month of trainings for a group, each
   newly-created training instance also reserves a physical court for its time window — automatically,
   at generation time. The court is now marked busy so it cannot be rented out from under a training.
   The admin may pick a preferred court at generation; otherwise the lowest-numbered free court is
   chosen per date. The block is editable later (change court) and is removed when the training is
   cancelled. The court *number* is not the point — marking the court busy is.
2. **Generate all groups (Feature 3).** One admin action generates the month for **all active groups**
   at once, instead of running generate per group. Returns a per-group summary.

These reuse, never reinvent, the Feature-4 occupancy helpers and respect the hard 6-courts-per-30-min
limit.

## Spec / invariant refs

- `CLAUDE.md` invariants: court assignment admin-only; never exceed active-court count per overlapping
  slot; monthly batch (`group_subscription_id`) never regresses; domain logic only in `apps/api`.
- `.claude/rules/security.md`: 6-per-slot is a hard server rule; admin-only writes gated in the service.
- Feature 4 brief `docs/product/features/court-30min-granularity.md` (30-min grid, helpers).

## Reused helpers (do NOT duplicate occupancy math)

From `packages/types/src/helpers.ts` / `common.ts`:

- `freeCourtsBySlot({ activeCourtCount, openHour, closeHour, confirmed, blocks })` — the single
  6-per-slot rule (free count per `"HH:MM"` slot).
- `courtSlotsCovered(startTime, durationMinutes)` — the 30-min slot starts an occupant covers.
- `timeRangesOverlap(aStart, aEnd, bStart, bEnd)` — half-open overlap.
- `minutesOfDay` / `timeOfMinutes` / `isSlotAligned` / `durationMinutesOf` / `freeForDuration`
  (the last is exported from `court-requests.service.ts`).
- `monthTrainingDates(daysOfWeek, year, month)` — already drives `generateMonth`.

In `apps/api`, reuse the existing per-court freeness helper `courtIsFreeForSlots(courtId, slots,
confirmed, blocks)` and the `toOccupant` / `toSlotOccupantsFromCourtRows` adapters from
`court-requests.service.ts` for the auto-block court selection and the reassign re-check. If the
selection/reassign logic must live in `courts`/`trainings` and importing from `court-requests` is
awkward, lift `courtIsFreeForSlots` into a small shared place (preferred: a pure helper in
`packages/types/src/helpers.ts`, e.g. `courtFreeForSlots(courtId, slots, occupants[])`) and have
`court-requests` consume it — do not copy it. Decide at implementation; default is to lift it to
`helpers.ts` since it is pure and now needed by two modules.

## Schema change (packages/db/schema.ts)

Add a nullable self-documenting link on `courtBlocks` tying an auto-block to its source training:

```ts
export const courtBlocks = pgTable("court_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  courtId: uuid("court_id").notNull().references(() => courts.id),
  date: date("date").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  reason: text("reason").notNull(),
  // NEW: non-null = an auto-block created for this training instance at month
  // generation; null = a manual admin block (C5). Makes auto-blocks
  // distinguishable, editable, and removable when the training is cancelled.
  groupTrainingId: uuid("group_training_id").references(() => trainings.id)
});
```

- Column: `group_training_id uuid NULL REFERENCES trainings(id)`. No `ON DELETE CASCADE` — trainings
  are never deleted (they go to `cancelled`); the auto-block is deleted explicitly on cancel.
- Migration: run `corepack pnpm --filter @beosand/db db:generate`, **commit the generated SQL** under
  `packages/db/drizzle/` together with this schema change. No backfill needed (existing blocks are all
  manual → `NULL`).
- Idempotency support: the implementer SHOULD add a partial unique index on
  `group_training_id WHERE group_training_id IS NOT NULL` so a training can have at most one auto-block
  (defends the idempotency rule at the DB level). If Drizzle partial-unique generation is awkward,
  enforce idempotency purely in the service via a "which trainings already have an auto-block" lookup;
  default is the partial unique index.

## Contracts (packages/types/src/court-contracts.ts + training-contracts.ts)

### courtBlock entity gains the link (court-contracts.ts)

```ts
export const courtBlockSchema = z.object({
  id: uuid,
  courtId: uuid,
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  reason: z.string().min(1),
  /** Non-null = auto-block for this training instance; null = manual admin block. */
  groupTrainingId: uuid.nullable()
});
export const createCourtBlockSchema = courtBlockSchema.omit({ id: true, groupTrainingId: true });
```

`createCourtBlockSchema` (manual C5 create) **omits** `groupTrainingId` — manual blocks are always
null; the field is set only by the generator, never by the create endpoint. The admin list/grid reads
carry it.

### Reassign-court contract (court-contracts.ts)

```ts
/** PATCH /court-blocks/:id — admin moves a block to another court (re-checks limit + overlap). */
export const reassignCourtBlockSchema = z.object({ courtId: uuid });
export type ReassignCourtBlock = z.infer<typeof reassignCourtBlockSchema>;
```

### generateMonth gains optional preferred court (training-contracts.ts)

```ts
export const generateMonthSchema = z.object({
  groupId: uuid,
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12),
  /** Preferred court for this group's auto-blocks; falls back per date if not free. */
  courtId: uuid.optional()
});
```

### generate-all contract + per-group result summary (training-contracts.ts)

```ts
/** Generate the month for every active group at once (Feature 3). No courtId — auto-pick per group. */
export const generateAllMonthSchema = z.object({
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12)
});
export type GenerateAllMonthInput = z.infer<typeof generateAllMonthSchema>;

/** Per-group outcome: trainings created, auto-blocks created, dates left without a block. */
export const generateGroupResultSchema = z.object({
  groupId: uuid,
  groupName: z.string(),
  created: z.number().int().nonnegative(),   // new trainings
  blocked: z.number().int().nonnegative(),   // auto-blocks created
  skipped: z.number().int().nonnegative()    // trainings created but no free court → no block
});
export type GenerateGroupResult = z.infer<typeof generateGroupResultSchema>;

export const generateAllResultSchema = z.object({
  perGroup: z.array(generateGroupResultSchema)
});
export type GenerateAllResult = z.infer<typeof generateAllResultSchema>;
```

Invariant: `created` is total new trainings; `blocked + skipped === created` for each group (every new
training either gets a block or is recorded as skipped).

> After editing `packages/types`, rebuild it (`corepack pnpm --filter @beosand/types build`) before
> downstream typecheck — apps consume the built `dist`.

## API

### TrainingsService.generateMonth (extend)

Signature unchanged shape, input now carries optional `courtId`:

```ts
async generateMonth(actorTelegramId: number, input: GenerateMonthInput): Promise<Training[]>
```

Behavior change — **within the same transaction** that inserts the new trainings, create one auto
court block per newly-inserted training:

1. Insert new trainings (existing path; idempotent skip of already-generated dates is unchanged).
2. For each NEW training, build its window `[startTime, endTime)` (group's times, may be on `:30`) and
   its covered slots via `courtSlotsCovered(startTime, durationMinutesOf-equivalent)` — compute minutes
   from `minutesOfDay(endTime) - minutesOfDay(startTime)`.
3. Load that date's existing occupancy (confirmed requests + blocks) **inside the tx**, accumulating
   the auto-blocks created earlier in this same generation run so two trainings in one run can't both
   grab the same court/slot. Use `freeCourtsBySlot` for the 6-per-slot guard and `courtIsFreeForSlots`
   (or lifted `courtFreeForSlots`) for per-court freeness.
4. **Court selection per training:**
   - If `input.courtId` is given and that court is active and free for every covered slot on that date
     (and the 6-per-slot limit still holds), use it.
   - Else pick the **lowest-numbered active court** that is free for every covered slot on that date.
   - If **no** court is free for all covered slots (limit reached), **skip** the block for that
     training — record it in the result's `skipped`. Never exceed the limit.
5. `reason = group.name`. `groupTrainingId = training.id`.
6. Idempotency: never create a 2nd auto-block for a training that already has one (keyed by
   `groupTrainingId`; backed by the partial unique index). Because trainings already-generated are
   skipped in step 1, re-running generate is a no-op for both trainings and blocks.

Repositories: add to `CourtBlocksRepository` (or a thin courts-side repo) tx-aware methods to
insert an auto-block and to read confirmed+block occupancy for a date inside the trainings tx. Reuse
the existing `confirmedCourtOccupancyForDate` / `blocksByCourtForDate` query bodies — they already
exist on `CourtsRepository` and `CourtRequestsRepository`; do not add a third divergent copy. Cross-
module DB access in one tx: `TrainingsRepository.transaction(tx => …)` already provides the `Database`
handle; pass it to court-block insert/read methods (give `CourtBlocksRepository` tx-accepting variants).

### TrainingsService.generateMonthForAll (new)

```ts
async generateMonthForAll(
  actorTelegramId: number,
  input: GenerateAllMonthInput
): Promise<GenerateAllResult>
```

- Admin-gated (same `assertAdmin`).
- Load active groups via `GroupsRepository.listActive()`.
- For each active group, reuse the `generateMonth` per-group logic (no preferred court → auto-pick).
  Each group is processed in its own transaction (a failure on one group must not roll back groups
  already done; log and continue, or surface a typed error — default: per-group try, record a group
  with `created/blocked/skipped` and continue, so one bad group can't abort the batch). Return
  `{ perGroup: [...] }` validated against `generateAllResultSchema`.

Refactor note: factor the per-group "insert trainings + create auto-blocks" into one internal method
(e.g. `private generateMonthForGroup(tx, group, year, month, preferredCourtId?)`) that both
`generateMonth` and `generateMonthForAll` call, so the two paths can't diverge.

### TrainingsService.cancelTraining (extend)

In the existing cancel transaction (after marking the training `cancelled` and flipping its booked
bookings), **delete the training's auto-block** (the row keyed by `groupTrainingId = id`), freeing the
court. A block is not active plan state, so delete (not soft-cancel) is correct and consistent with
`CourtBlocksService.deleteBlock`. Idempotent: deleting when no auto-block exists is a no-op. Manual
blocks (null link) are untouched.

### CourtBlocksService.reassignCourt (new) — PATCH /court-blocks/:id

```ts
async reassignCourt(
  callerTelegramId: number,
  blockId: string,
  input: ReassignCourtBlock
): Promise<CourtBlock>
```

- Admin-only (`assertAdmin`).
- Load the block (404 if missing). The new court must be active (400 if not).
- Re-check on the **target** court for the block's own slots (`courtSlotsCovered` over its
  `[startTime, endTime)`):
  - per-court freeness via `courtIsFreeForSlots`/lifted helper (no confirmed request, no *other* block
    on the target court overlapping those slots — exclude this block itself), and
  - the 6-per-slot limit via `freeCourtsBySlot` over the date (the block already counts toward
    occupancy on its current court; moving it doesn't change the total per-slot count, but the target
    court must have a free seat for each slot — the per-court freeness check covers this; the limit
    check guards the case where the move would land on an over-subscribed slot).
  Reject with `ConflictException` if it would clash or exceed the limit.
- Persist the new `courtId` (block keeps its id, date, window, reason, `groupTrainingId`). Return the
  validated `courtBlockSchema` row.
- Applies to both auto-blocks and manual blocks (any block may be moved); the admin UI exposes it
  primarily for auto-blocks but the endpoint itself is block-agnostic.

### Controllers

- `POST /trainings/generate` — body now optionally carries `courtId` (validated by extended
  `generateMonthSchema`). No controller logic change beyond passing it through.
- `POST /trainings/generate-all` — new, admin-gated in the service; validate `generateAllMonthSchema`,
  call `generateMonthForAll`, return `GenerateAllResult`.
- `PATCH /court-blocks/:id` — new on `CourtBlocksController`; validate `uuid` id +
  `reassignCourtBlockSchema` body, call `reassignCourt`.
- `GET /court-blocks` list now returns rows with `groupTrainingId` (already covered by the entity
  schema change; no controller change).

## Bot flow

None. These are admin-console / API features. The bot's court-rental availability automatically
reflects the new auto-blocks because availability already subtracts blocks via the shared helpers — no
bot change, but verify the client court flow still offers correct slots after auto-blocks exist (it
must show fewer free courts on training slots).

## Admin UI (apps/admin)

- **Trainings.tsx → GenerateMonthModal**: add an optional court `<select>` (options from `useCourts()`
  / `listCourts()`, plus an "auto-pick" empty option). Pass `courtId` into `GenerateMonthInput` only
  when chosen. Hook: `useGenerateMonth` already passes the input through; `client.generateMonth` body
  now includes optional `courtId`.
- **Trainings.tsx**: add a "Сгенерировать все группы" button next to "Generate". Opens a small
  modal/inline form with year + month only → `client.generateAllGroups({ year, month })`. New hook
  `useGenerateAllGroups` in `useTrainings.ts` (invalidates the trainings lists on success). Show the
  per-group summary (created / blocked / skipped) in a result panel or toast list. If any group has
  `skipped > 0`, surface it clearly (some trainings could not reserve a court).
- **api/client.ts**: add `generateAllGroups(input: GenerateAllMonthInput): Promise<GenerateAllResult>`
  (POST `/trainings/generate-all`, validate with `generateAllResultSchema`) and
  `reassignCourtBlock(id: string, courtId: string): Promise<CourtBlock>` (PATCH `/court-blocks/:id`,
  body `{ courtId }`, validate with `courtBlockSchema`). Extend `generateMonth` body to include
  optional `courtId`.
- **CourtBlocks.tsx / CourtLoad.tsx**: distinguish auto-blocks (non-null `groupTrainingId`) from manual
  blocks visually (e.g. a "группа" tag / different swatch tone; the reason already shows the group
  name). On a block with `groupTrainingId`, expose a "Сменить корт" action → a court `<select>` →
  `client.reassignCourtBlock(id, courtId)`. New hook `useReassignCourtBlock` in `useCourtBlocks.ts`
  (invalidate both the blocks query and the load grid, mirroring `invalidateBlocks`). The CourtLoad
  grid is read-only today; the change-court action belongs on CourtBlocks.tsx (the list view) since the
  grid cell carries no block id. If a block id is wanted in the grid, that is out of scope here.
- UI strings in RU; mirror `sr`/`en` since the catalogs are catalog-driven (`packages/i18n`). Rebuild
  i18n after adding keys.

## Invariants honored

- 6-per-30-min limit: auto-block selection and reassign both go through `freeCourtsBySlot` /
  `courtIsFreeForSlots`; a training that cannot get a court is skipped, never forced.
- Court assignment admin-only: all new writes gated by `assertAdmin` in the service.
- `group_subscription_id` monthly batch untouched: this feature only adds court blocks and a nullable
  FK; the booking/subscription path is not modified. Cancelling a training still flips only that
  training's bookings (existing behavior) and now also frees its auto-block.
- No domain math in admin: the console only renders results and offers the server-validated actions.
- `packages/types` and `packages/db` in lockstep: `groupTrainingId` added to both; migration committed.

## Acceptance criteria

1. Generating a month for a group also creates one court block per new training, each occupying a
   court for the training's `[startTime, endTime)` window, with `reason = group name` and
   `groupTrainingId = training.id`.
2. With a preferred `courtId` that is free, all auto-blocks land on it; where it is not free for a
   date, that date falls back to the lowest-numbered free court.
3. When no court is free for a training's slots (limit reached), no block is created for it and it is
   counted in `skipped`; the per-slot count never exceeds the active-court count.
4. Re-running generate for the same group/month creates no duplicate trainings and no duplicate
   auto-blocks (idempotent).
5. "Generate all groups" creates the month for every active group and returns a per-group summary;
   inactive groups are excluded.
6. After an auto-block exists on a training slot, the court-rental availability (C3) and load grid show
   one fewer free court for those slots (auto-block reduces rentable availability).
7. Cancelling a training deletes its auto-block (court frees up); its bookings still flip per existing
   behavior and sibling-date bookings of the same `group_subscription_id` are untouched.
8. `PATCH /court-blocks/:id` moves a block to a free court; it is rejected (409) when the target court
   has an overlapping confirmed request or another block, or when the move would exceed the 6-per-slot
   limit.
9. Admin can pick a court in the generate modal, run "generate all", and change an auto-block's court
   from the console; non-admin callers are rejected by the API.

## Test list (the precise set implementers must deliver)

Service / helper (apps/api + packages/types):

- T1 `generateMonth` idempotency: second run for same group/month inserts 0 trainings and 0 auto-blocks.
- T2 auto-block occupies the court for the training window and reduces rental availability: after
  generation, `freeCourtsBySlot` / C3 availability for those slots drops by one on the chosen court.
- T3 court selection — preferred court used when free; falls back to lowest-numbered free court when the
  preferred is taken for a given date.
- T4 6-per-slot limit honored at generation: when all active courts are occupied for a training's
  slots, no block is created and the training is counted in `skipped`; the per-slot occupancy never
  exceeds `activeCourtCount`.
- T5 two trainings generated in one run for overlapping windows do not both grab the same court (the
  in-run accumulation prevents it).
- T6 `generateMonthForAll`: iterates active groups only; returns per-group summary with
  `blocked + skipped === created`.
- T7 `reassignCourt` honors per-court overlap and the limit: rejects (409) onto a court with an
  overlapping confirmed request / block; accepts onto a free court; non-admin rejected (403).
- T8 cancel removes the auto-block: cancelling a training deletes its `groupTrainingId` block; a manual
  block on the same court/date is untouched; re-cancel is a no-op for the (absent) block.
- T9 `group_subscription_id` batch untouched: cancelling one training in a monthly batch frees its
  auto-block but does not cancel sibling-date bookings (regression guard for the monthly invariant).
- T10 contract tests: `courtBlockSchema` accepts null and uuid `groupTrainingId`; `createCourtBlockSchema`
  rejects/omits `groupTrainingId`; `generateAllResultSchema` and `reassignCourtBlockSchema` validate;
  `generateMonthSchema` accepts optional `courtId`.

Admin (apps/admin):

- T11 client.ts: `generateAllGroups` and `reassignCourtBlock` reject a malformed API response (contract
  guard); `generateMonth` sends `courtId` only when chosen.
- T12 Trainings/CourtBlocks render: generate-all shows the per-group summary; an auto-block is visually
  distinguished and its "change court" action calls `reassignCourtBlock`.

## Dependencies

- Feature 4 (30-min granularity) — landed; this builds on its helpers and 30-min-aware blocks.
- Rebuild order: edit `packages/db` + `packages/types` → generate & commit migration → rebuild
  `@beosand/types` (and `@beosand/db`) → API → admin → i18n.

## Open questions (each with a chosen default)

1. **Where does `courtIsFreeForSlots` live now that two modules need it?** Default: lift it into
   `packages/types/src/helpers.ts` as a pure `courtFreeForSlots(courtId, slots, occupants[])` and have
   `court-requests.service.ts` consume it (remove the local copy per the refactor rule).
2. **Idempotency mechanism for one-block-per-training.** Default: partial unique index on
   `group_training_id`; service still checks before insert so the error path is a clean no-op.
3. **One group failing in generate-all.** Default: per-group transaction; record that group's partial
   result and continue, never abort the whole batch.
4. **Reassign scope.** Default: endpoint works for any block; the UI surfaces it primarily for
   auto-blocks (manual blocks can already be deleted + recreated).
5. **Auto-block window source.** Default: the group's `startTime`/`endTime` copied onto the training
   (already how trainings are generated); auto-block spans exactly that window.

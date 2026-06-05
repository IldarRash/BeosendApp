# Feature: 30-minute granularity (court rental, court blocks, group trainings)

## Goal

Move every court/training time off the whole-hour grid onto a **30-minute** grid, in all three
places the owner confirmed:

1. **Court rental (client, court-requests)** — start times on any `:00` or `:30` boundary within
   working hours; durations `1 | 1.5 | 2` hours; price = `durationHours × hourly rate` computed
   server-side.
2. **Court blocks (admin)** — start and end on any `:00`/`:30` boundary, `end > start`, inside
   working hours.
3. **Group trainings** — `startTime`/`endTime` on any `:00`/`:30` boundary, `end > start`.

The 6-courts-per-hour occupancy limit moves from a whole-hour model to a **30-minute slot** model
with minute-based half-open `[start, end)` overlap. The availability read (C3) and the confirm
re-check (C4) MUST keep sharing the **same** generalized helper so they can never diverge. The
court-load grid cells become 30-minute slots.

This is a granularity change only: money is still whole RSD computed server-side, court numbers are
still never shown before admin confirmation, assignment is still admin-only, and the working-hours
window (`COURT_OPEN_HOUR=8`, `COURT_CLOSE_HOUR=21`) is unchanged.

## Spec / invariant refs

- `CLAUDE.md` product invariants: 6-per-hour hard server rule; admin-only manual assignment; clients
  request a *time* only and never see a court number; money is whole RSD computed server-side.
- `.claude/rules/zod-contracts.md` (one schema per entity, pure math in `helpers.ts`),
  `.claude/rules/drizzle-migrations.md` (schema + types in lockstep, commit the migration),
  `.claude/rules/nestjs-layering.md` (limit logic in the service/helper, not bot/admin/controller).

## Build-on-top note (in-flight branch)

`feature/court-load-redesign` has uncommitted work touching the court files (contracts, helpers,
court-requests/courts services, courts.repository, admin `CourtLoad.tsx`/hooks/client,
`apps/bot/src/court-load.spec.ts`, i18n). The current tree is **hour-based** (`courtDurationHours =
1|2`, `freeCourtsByHour`, `courtHoursCovered`, `courtLoadGrid` over whole hours, `hourRangesOverlap`,
grid cells keyed by `hour`). Build the 30-min change on top of that current tree; **replace** the
hour-based math rather than adding a parallel path.

---

## Core model decision: minutes are the unit

All slot math becomes **minute-since-midnight** based. Two derived helpers convert `"HH:MM"` ⇄
minutes. The 30-minute slot index is `minutes / 30`. A duration of `1 | 1.5 | 2` hours is
`60 | 90 | 120` minutes = `2 | 3 | 4` slots.

`durationHours` stays the contract field name and the client-facing/price unit (fractional now);
internally the helpers convert it to minutes. This keeps churn small (no rename across contracts,
services, i18n, admin, bot) while making 1.5h representable.

---

## Contract changes — `packages/types`

### `common.ts` (shared time primitives — new, pure)

Add two pure converters used by every slot helper (no new regex; `timeString` already accepts `:30`):

```ts
/** Minutes since midnight for an "HH:MM" string. 14:30 → 870. */
export function minutesOfDay(time: string): number;

/** "HH:MM" for minutes since midnight. 870 → "14:30". Caller keeps it < 24h. */
export function timeOfMinutes(minutes: number): string;

/** Slot width for the 30-minute court/training grid. */
export const SLOT_MINUTES = 30;

/** True when minutes land on a 30-minute boundary (minute ∈ {0,30}). */
export function isSlotAligned(time: string): boolean;
```

(If a non-empty pure helper belongs in `helpers.ts` rather than `common.ts` to avoid Nest/DB-free
ambiguity, put `minutesOfDay`/`timeOfMinutes`/`isSlotAligned` in `helpers.ts` and keep only
`SLOT_MINUTES` constant in `common.ts`. Pick one location and reuse it everywhere — do not duplicate.)

### `court-contracts.ts`

- Replace the duration union with three half-hour steps:

```ts
export const courtDurationHours = z.union([z.literal(1), z.literal(1.5), z.literal(2)]);
export type CourtDurationHours = z.infer<typeof courtDurationHours>;
```

- Add a 30-min-alignment refinement to the client request schemas so a non-aligned start is rejected
  at the contract boundary (server still re-validates working hours). On `previewCourtRequestSchema`
  (and therefore `createCourtRequestSchema`, which aliases it):

```ts
startTime: timeString.refine(isSlotAligned, "start must be on a 30-minute boundary")
```

- The `hourAvailabilitySchema` / `courtAvailabilitySchema` C3 read becomes **slot**-based. Rename the
  per-slot entity and field semantics (keep the file's single-definition rule):

```ts
export const slotAvailabilitySchema = z.object({
  startTime: timeString,            // the slot's start, "HH:MM" on a :00/:30 boundary
  freeCourts: z.number().int().nonnegative()
});
export type SlotAvailability = z.infer<typeof slotAvailabilitySchema>;

export const courtAvailabilitySchema = z.object({
  date: dateString,
  slots: z.array(slotAvailabilitySchema)   // was `hours`
});
```

  Drop the integer `hour` field (it cannot represent `:30`). `startTime` is now the only slot key.

- The court-load grid cell becomes a 30-min slot keyed by `startTime` (drop the integer `hour`):

```ts
export const courtLoadCellSchema = z.object({
  startTime: timeString,                    // slot start, the cell key (was `hour`)
  state: courtLoadCellState,
  requestId: uuid.nullable()
});
```

  `courtLoadGridSchema` keeps `openHour`/`closeHour` (whole-hour window bounds are fine as window
  metadata); the rows' `cells` are now one per 30-min slot across `[openHour:00, closeHour:00)`.

- `courtRequestPreviewSchema`, `courtRequestSchema`, `courtRequestAdminViewSchema` are unchanged in
  shape; `durationHours` now carries `1 | 1.5 | 2` and `endTime` may end on `:30`.

### `helpers.ts` (the shared slot math — replaces the hour-based path)

Replace the hour-based occupancy helpers with one minute/slot-based model. **Both** C3 (read) and C4
(confirm re-check) call `freeCourtsBySlot`; the per-court load grid and the per-court freeness check
call the same overlap notion.

- Generalize price to fractional hours (already multiplies; just widen the type):

```ts
export function courtPriceRsd(durationHours: CourtDurationHours, ratePerHour = COURT_RATE_RSD_PER_HOUR): number;
// 1 → 2000, 1.5 → 3000, 2 → 4000. Must stay integer RSD (the products are integers here).
```

- Replace `courtHoursCovered` with a slot-cover helper:

```ts
/** The 30-min slot start times an occupant covers, e.g. 17:30 + 1.5h → ["17:30","18:00","18:30"]. */
export function courtSlotsCovered(startTime: string, durationMinutes: number): string[];
```

  (Keep durations as **minutes** inside helpers: `durationMinutes = durationHours * 60`. A small
  `durationMinutesOf(durationHours)` converter may live alongside.)

- Replace `hourRangesOverlap` with a minute-based half-open overlap (C5 block guard, and reused by
  per-court freeness):

```ts
/** True when [aStart,aEnd) and [bStart,bEnd) overlap, by minute. 17:30–19:00 vs 19:00–20:00 → false. */
export function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean;
```

- Replace `freeCourtsByHour` with the slot version (the single 6-per-slot rule):

```ts
export function freeCourtsBySlot(input: {
  activeCourtCount: number;
  openHour: number;
  closeHour: number;
  confirmed: readonly CourtOccupant[];   // { startTime, durationHours }
  blocks: readonly CourtOccupant[];      // expanded or expressed in minutes
}): Map<string, number>;                 // key = slot start "HH:MM"
```

  `CourtOccupant` keeps `{ startTime: string; durationHours: CourtDurationHours }` for confirmed
  requests. Blocks (which may not be a clean `1|1.5|2`) are passed as their own minute span — add a
  sibling occupant shape or expand blocks into per-slot occupants of one `SLOT_MINUTES` each (mirror
  the existing `toHourlyOccupants` pattern, now `toSlotOccupants`).

- Replace `courtLoadGrid` to emit one cell per 30-min slot. `CourtCellOccupant` carries a minute
  span; `occupiedHoursByCourt` becomes `occupiedSlotsByCourt` keyed by slot-start string. The doc
  invariant stays: a `free` cell is exactly a court/slot C3 counts as free (same `courtSlotsCovered`
  / `timeRangesOverlap` notion as C4).

- Add `freeForDuration` analogue (currently in the service) consistent with slots: min free over the
  slots a duration covers. Keep it where it lives (service `freeForDuration`) but re-point it at
  `courtSlotsCovered`.

> Remove `courtHoursCovered`, `hourRangesOverlap`, `freeCourtsByHour`, and the hour-keyed
> `courtLoadGrid`/`occupiedHoursByCourt` in the same change — do not leave the hour-based path.

---

## DB — `packages/db`

`court_requests.duration_hours` is currently `integer` (`schema.ts:202`) — it **cannot** store `1.5`.

**Migration needed (one column type change):** change `duration_hours` to a fractional type.
Decision: `numeric(3, 1)` (stores 1.0 / 1.5 / 2.0; `durationHours` field name unchanged end-to-end).
Drizzle reads `numeric` as a string, so the repository must `Number(row.durationHours)` before
`courtDurationHours.parse(...)`. (Alternative — add a `duration_minutes integer` column and derive
hours — is more churn across contracts/i18n; rejected. Default chosen: `numeric(3,1)`.)

`court_blocks.start_time` / `end_time` and `groups.start_time` / `end_time` are already `time`
columns and already store `:30` — **no migration** for blocks or groups. Generate the migration with
`pnpm --filter @beosand/db db:generate` and commit the SQL with the schema change.

Keep `packages/db` and `packages/types` in lockstep: `durationHours` is `1|1.5|2` in both.

---

## API service edits — `apps/api`

### `court-requests.service.ts` (C2 / C3 / C4)

- `getAvailability` (C3): build slots over `[COURT_OPEN_HOUR:00, COURT_CLOSE_HOUR:00)` in 30-min
  steps via `freeCourtsBySlot`; emit `{ startTime, freeCourts }` for each slot with `freeCourts > 0`.
  Drop `hourToTime`/integer `hour`.
- `assertWithinWorkingHours`: replace the `minutes !== 0` rejection with `isSlotAligned(startTime)`;
  the over-close check becomes `minutesOfDay(startTime) + durationMinutes > COURT_CLOSE_HOUR*60`.
- `previewRequest` / `createRequest`: unchanged flow; price via `courtPriceRsd` (now fractional),
  `isSlotAvailable` uses `freeCourtsBySlot` + slot-based `freeForDuration`. `endTimeFor` becomes
  `timeOfMinutes(minutesOfDay(startTime) + durationMinutes)`.
- `freeCourts` (C4 offer) and `confirmRequest` (C4 write): replace `courtHoursCovered` with
  `courtSlotsCovered`; `courtIsFreeForHours` → `courtIsFreeForSlots` using `timeRangesOverlap`
  (or slot-set intersection). Both still call the **same** `freeCourtsBySlot` as C3.
- `toOccupant(s)` / `toHourlyOccupants*`: parse duration via `Number(row.durationHours)` (numeric→
  string) then `courtDurationHours.parse`; expand blocks into per-`SLOT_MINUTES` occupants.

### `courts.repository.ts` + `courts.service.ts` (C6 grid)

- `CourtOccupancyRow.durationHours` becomes a number derived from the time span in **minutes** for
  blocks: `hourSpan` → `slotSpanMinutes(startTime, endTime)` (no longer floored to whole hours).
- `getLoadGrid`: call the slot-based `courtLoadGrid`; map each cell to `{ startTime, state,
  requestId }` (drop integer `hour` and `hourToTime`). Window bounds `openHour`/`closeHour` stay.
- `confirmedCourtOccupancyForDate`: `Number(row.durationHours)` for the numeric column.

### `court-blocks.service.ts` (C5)

- `assertValidRange`: replace the `:00`-only check with `isSlotAligned(startTime) &&
  isSlotAligned(endTime)`, keep `start < end` (compare minutes, not hours) and the working-hours
  bound (`minutesOfDay(start) >= OPEN*60`, `minutesOfDay(end) <= CLOSE*60`).
- Overlap guard uses `timeRangesOverlap` (minute-based) instead of `hourRangesOverlap`; `endTimeOf`
  is no longer needed since the repo returns the real `endTime`.

### `groups.service.ts`

- `assertTimeOrder` already enforces `end > start` (lexicographic on `"HH:MM"`, correct for
  same-format strings). Add `isSlotAligned` checks on `startTime` and `endTime` for create and
  update so group times must be on a 30-min boundary. (The `groupSchema`/`createGroupSchema` may also
  carry the refinement; enforce in the service per layering rule.)

---

## Admin — `apps/admin`

- **`CourtLoad.tsx`**: cells now keyed by `cell.startTime` (drop `cell.hour`). `hourLabel(cell)`
  already returns `cell.startTime` — keep using `startTime` for the column header and `key`. The grid
  now has ~26 columns (08:00…20:30); confirm the existing `datatable__scroll` handles horizontal
  scroll. No occupancy math added (still pure render of API cells).
- **`CourtBlocks.tsx`** + **`Groups.tsx`**: pass `step={1800}` to the `TimeField`s
  (`startTime`/`endTime`) so the native time spinner steps in 30-min increments. Add `step?: number`
  passthrough on `TimeField` (it already spreads `...rest` into `TextField` — verify the prop reaches
  the `<input>`). Server still validates alignment; the step is a UX affordance only.
- **`client.ts`** / **`useCourtRequests.ts`**: no signature change; the contracts they import
  (`courtLoadGridSchema`, `courtRequestAdminViewSchema`) change shape but the client just re-parses.
- The court-request **detail duration** label (`admin.courtRequests.durationHours` / `detailDuration
  Hours`) must render `1.5` correctly — verify the i18n interpolation prints `1.5 ч` (no integer
  coercion).

## Bot — `apps/bot`

- **`court.ts`**:
  - `courtTimeKeyboard`: render `availability.slots` (was `hours`) by `startTime`; payload becomes
    `court:time:<HH:MM>:<YYYY-MM-DD>` (already uses `startTime`, fine for `:30`). Budget the keyboard
    width — ~26 slots; keep the existing 3-per-row layout (more rows is acceptable).
  - `courtDurationKeyboard`: now offers `1 | 1.5 | 2` from `courtDurationHours.options`. The callback
    `court:dur:<1|1.5|2>:<date>:<HH:MM>` and `parseDuration`/`parseConfirm` must parse `1.5`
    (`Number(...)` already does; ensure the literal cast `as CourtDurationHours` accepts 1.5).
  - i18n: add `bot.court.duration.1.5` ("1.5 часа" / sr / en) alongside `duration.1` / `duration.2`,
    and keep `bot.court.durationHours` generic (`{hours} ч`).
- **`court-load.ts`** + **`court-load.spec.ts`**: the grid is now 30-min slots. The monospace text
  grid header/columns derive from `grid.rows[0].cells[].startTime` (no integer `hour`). Update the
  spec's `cells(...)` builder and assertions to slot start-times; widen test windows accordingly.
- **`index.ts`**: court-rent + court-load handlers re-point to the renamed `slots` field and updated
  parsers; no domain math added.

---

## Invariants this feature must preserve

- 6-per-30-min-slot limit is computed **only** by `freeCourtsBySlot`, shared by C3 read and C4 write.
- Clients never receive a court number before admin confirmation (unchanged).
- Assignment is admin-only; admin endpoints stay gated by `ADMIN_TELEGRAM_IDS` in the service.
- Money is whole RSD computed server-side (`1.5 × 2000 = 3000`).
- A block/request ending exactly when another starts does **not** overlap (half-open `[start,end)`).

## Acceptance criteria

1. Client can book a court starting at `08:30`, `17:30`, etc.; a `08:15` start is rejected (400).
2. Client can pick a `1.5h` duration; the preview shows `15:00–16:30` and `3000 RSD`.
3. A start whose end exceeds `21:00` (e.g. `20:00 + 1.5h`) is rejected.
4. C3 availability lists 30-min slots with correct free-court counts; C4 confirm re-check refuses a
   slot that filled meanwhile, using the same helper.
5. Admin can create a court block `17:30–19:00`; `17:15` or `end ≤ start` is rejected. A confirmed
   request `19:00–20:00` does not clash with that block.
6. Group create/update accepts `18:00–19:30` and rejects `18:15` or `end ≤ start`.
7. The admin court-load grid renders 30-min columns; `request` cells still open the detail popup; no
   court number leaks on a client path.
8. The bot court-load text grid renders 30-min columns; bot duration keyboard offers `1 / 1.5 / 2`.

## Test list (exact)

Pure helpers (`packages/types/src/helpers.spec.ts`, `common.spec.ts`):

- `minutesOfDay`/`timeOfMinutes` round-trip; `isSlotAligned("08:30")=true`, `"08:15"=false`.
- `courtSlotsCovered("17:30", 90)` → `["17:30","18:00","18:30"]`; `courtSlotsCovered("08:00",60)` →
  `["08:00","08:30"]`.
- `courtPriceRsd(1.5)` → `3000`; `courtPriceRsd(1)` → `2000`; `courtPriceRsd(2)` → `4000` (integer).
- `timeRangesOverlap("17:30","19:00","19:00","20:00")` → `false` (touching is not overlap);
  `timeRangesOverlap("17:30","19:00","18:30","19:30")` → `true`.
- `freeCourtsBySlot`: with `activeCourtCount=6` and confirmed/blocks across `:30` boundaries, the
  per-slot free counts are correct, floored at 0, and never exceed active courts.
- `courtLoadGrid` (slot version): a `1.5h` confirmed request marks exactly its 3 slots `request`;
  a block marks its slots `block`; everything else `free`; `free` cells match C3-free slots.

API services:

- court-requests C3↔C4 **consistency**: a slot reported free by `getAvailability` is confirmable;
  once confirmed, the same slot is reported not-free and a second confirm 409s (same helper).
- `previewRequest`/`createRequest`: `1.5h` price is `3000`; `08:30` start accepted; `08:15` rejected
  (400); `20:00 + 1.5h` rejected (400, over close).
- court-blocks: `17:30–19:00` created; `17:15` rejected; `end ≤ start` rejected; block vs touching
  `19:00–20:00` request → no clash; block overlapping `18:30–19:30` request → clash (409).
- groups: create/update accepts `18:00–19:30`; rejects `18:15` start and `end ≤ start`.
- numeric column round-trip: a `1.5h` request persists and reads back as `durationHours === 1.5`.

Bot/admin:

- `apps/bot/src/court.spec.ts`: duration keyboard offers `1/1.5/2`; `parseDuration`/`parseConfirm`
  round-trip `1.5`; time keyboard renders `:30` slots from `availability.slots`.
- `apps/bot/src/court-load.spec.ts`: 30-min slot columns rendered; update `cells()` builder.
- `apps/admin/src/pages/CourtLoad.spec.tsx`: renders slot columns keyed by `startTime`.
- `apps/admin` CourtBlocks/Groups: `TimeField` carries `step={1800}` (render assertion).

## Dependencies / sequencing

Contracts (`packages/types`) first → rebuild `@beosand/types` dist → DB schema + migration →
API services (court-requests C3/C4, courts grid, court-blocks, groups) → admin + bot in parallel.
Rebuild shared packages before downstream typecheck/test.

## Open questions (each with a chosen default)

1. **DB representation of fractional duration.** Default: `numeric(3,1)` on `court_requests`
   (`durationHours` field name kept; repo coerces string→number). Alternative `duration_minutes`
   rejected as more churn.
2. **Helper location for `minutesOfDay`/`timeOfMinutes`/`isSlotAligned`.** Default: `helpers.ts`
   (pure, unit-tested there) with `SLOT_MINUTES` constant in `common.ts`. Keep one home; no dupes.
3. **Block durations that aren't `1|1.5|2`.** Default: blocks carry an arbitrary minute span (any
   `:30`-aligned `start<end`); only client *requests* are constrained to `1|1.5|2`. The grid/limit
   math handles arbitrary block spans via per-slot expansion.
4. **C3 slot field rename `hours`→`slots`.** Default: rename (the integer `hour` cannot express
   `:30`). Update bot/admin readers in the same change; no parallel field.

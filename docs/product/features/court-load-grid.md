# C6 — Court load grid (admin)

**Status.** Planned (this brief). C1–C5 are implemented; C6 is the remaining read-only admin view.

**Goal.** Give the admin a per-day view of which courts are taken (by a confirmed request or a block)
and which are free, across the 08:00–21:00 working window, so they can distribute players sensibly.

**Spec refs.** Edition 2 — "Просмотр загрузки". Depends on C1 (courts), C3 (availability math),
C4 (confirmed requests), C5 (blocks).

## Smallest correct slice

One read-only, admin-only endpoint that returns a courts × working-hours grid for a single date,
derived purely from confirmed requests + blocks; plus a compact text-grid bot view behind the admin
menu. No write path, no schema change.

## Contracts & tables

**Tables (read-only, all already exist):** `courts` (active set), `court_requests` (status
`confirmed`, with `court_id`), `court_blocks`.

**Contracts to ADD in `packages/types/src/court-contracts.ts`** (reuse `dateString`, `timeString`,
`uuid` from `common.ts`; the cell uses the existing `COURT_OPEN_HOUR`/`COURT_CLOSE_HOUR` window):

- `courtLoadQuerySchema = z.object({ date: dateString })` — query for the grid read.
  (Note: identical in shape to the existing `courtAvailabilityQuerySchema`; reuse that one instead of
  duplicating if preferred — do not declare a second date-only query schema needlessly.)
- `courtLoadCellState = z.enum(["free", "request", "block"])` — what holds an hour on a court.
- `courtLoadCellSchema = z.object({ hour: z.number().int(), startTime: timeString, state: courtLoadCellState })`
- `courtLoadRowSchema = z.object({ courtId: uuid, courtNumber: z.number().int().min(1), cells: z.array(courtLoadCellSchema) })`
- `courtLoadGridSchema = z.object({ date: dateString, openHour: z.number().int(), closeHour: z.number().int(), rows: z.array(courtLoadRowSchema) })`
- Export inferred types: `CourtLoadQuery`, `CourtLoadCellState`, `CourtLoadCell`, `CourtLoadRow`, `CourtLoadGrid`.
- Export from `packages/types/src/index.ts` (already barrels `court-contracts`).

This is an **admin-only** DTO: it carries court ids and numbers and MUST never be returned on a client
path (same rule as `courtRequestAdminViewSchema`).

**No DB schema change.** All occupancy is already persisted; the grid is a pure projection.

## Pure helper (reuse, don't re-derive)

Add ONE pure helper to `packages/types/src/helpers.ts`, unit-testable without Nest/DB, so the grid and
C3/C4 cannot diverge:

- `courtLoadGrid(input: { courts: {id,number}[]; openHour; closeHour; confirmed: {courtId,startTime,durationHours}[]; blocks: {courtId,startTime,durationHours}[] }): { courtId; courtNumber; cells: {hour;state}[] }[]`
  For each active court and each hour in `[openHour, closeHour)`: `block` if a block covers that
  court/hour, else `request` if a confirmed request covers that court/hour, else `free`. Use the
  existing `courtHoursCovered` to expand spans. This is the per-court analogue of `freeCourtsByHour`
  and the same notion of occupancy as `courtIsFreeForHours` in the C4 service — keep the rule here so
  the read paths agree by construction.

## API

Module: `apps/api/src/modules/courts/` (extend the existing `CourtsController`/`CourtsService`;
do **not** create a new module).

- `GET /courts/load?date=YYYY-MM-DD` → `CourtLoadGrid`.
  - Controller: thin. Parse `x-telegram-id` header (existing `telegramIdHeader` convention), validate
    `date` with `courtLoadQuerySchema` (or reuse `courtAvailabilityQuerySchema`); call one service
    method; return the DTO.
  - Service (`CourtsService.getLoadGrid(callerTelegramId, date)`): **first** `isAdmin(env, …)` →
    `ForbiddenException` for non-admins (mirror `listActiveCourts`); then read active courts +
    confirmed per-court occupancy for the date + blocks per-court for the date; build the grid via the
    `courtLoadGrid` helper; `courtLoadGridSchema.parse(...)` before returning.
  - Repository (`CourtsRepository`): add two reads — confirmed per-court occupancy for a date and
    blocks per-court for a date. These already exist verbatim in
    `CourtRequestsRepository.confirmedCourtOccupancyForDate` / `blocksByCourtForDate` and in
    `CourtBlocksRepository`. **Reuse:** either inject `CourtRequestsRepository` style readers or copy
    the exact two queries into `CourtsRepository`; do not invent a third occupancy notion. Court `time`
    columns come back as `HH:MM:SS` — slice to `HH:MM` as the other court repos do. Blocks’ duration
    is derived from `endTime - startTime` (same `hourSpan` rule already used).

## Bot flow

`apps/bot` (interaction layer only — no math, no court-number logic beyond rendering the admin DTO).

- New file `apps/bot/src/court-load.ts`:
  - `COURT_LOAD_ACTIONS = { open: "court_load:open", datePrefix: "court_load:date:" }` (namespaced,
    payloads small — only an ISO date, well under 64 bytes).
  - `courtLoadDateKeyboard(dates)` — reuse the existing `courtDateOptions` from `court.ts` for the date
    list.
  - `courtLoadGridText(grid: CourtLoadGrid): string` — compact monospace text grid: header row of
    hour columns (08..20), one row per `Корт №N` with a glyph per cell (e.g. `·` free, `R` confirmed
    request, `B` block) and a short legend. MVP = text grid (see open question).
  - `COURT_LOAD_TITLE`, `COURT_LOAD_NOT_ADMIN_TEXT` constants.
- `ApiClient.getCourtLoad(adminId, date): Promise<CourtLoadGrid>` — `GET /courts/load?date=…` with the
  `x-telegram-id` header; validate the response with `courtLoadGridSchema`.
- `apps/admin` menu: add `ADMIN_ACTIONS.courtLoad = "court_load:open"` and a button in
  `adminMenuKeyboard()` ("📊 Загрузка кортов (админ)").
- `apps/bot/src/index.ts`: register handlers for `COURT_LOAD_ACTIONS.open` (admin-gated client-side,
  show date picker) and `court_load:date:<date>` (fetch grid, render text). Re-gate is enforced by the
  API regardless.

## Invariants

- **Single most important:** the grid is admin-only and read-only, and every cell is derived purely
  from `confirmed` court_requests + court_blocks using the same occupancy notion as C3/C4 — so a
  `free` cell in the grid is exactly a court/hour that C3 counts as free and that C4 would allow an
  assignment onto. No new source of truth, no write.
- Reflects the 08:00–21:00 working window (`COURT_OPEN_HOUR`..`COURT_CLOSE_HOUR`).
- A confirmed request and a block both render as occupied on the right court and the exact hours they
  span (multi-hour blocks/2h requests fill every covered hour).

## Unsafe / forbidden path (must be rejected & tested)

A **non-admin** Telegram id calling `GET /courts/load?date=…` MUST get `ForbiddenException` (403) and
**no court identities/occupancy in the response** — this view exposes court numbers, which clients must
never see. The admin gate runs in the service before any DB read (mirror `listActiveCourts`). Also:
pending/rejected/cancelled requests must NOT occupy a cell (only `confirmed` reserves a court).

## Acceptance criteria

- The grid shows every active court across all working hours for the chosen date.
- A confirmed request and a block both render as occupied on the correct court and hours; a 2h
  request / multi-hour block fills every hour it covers.
- Free cells match C3’s availability for that date (a court/hour is `free` in the grid iff it
  contributes to C3’s free-court count).
- A non-admin caller is rejected with 403 and receives no court data.

## Tests

- `packages/types` (pure helper): `courtLoadGrid` composition for a fixture with one confirmed request
  + one block on different courts/hours — correct `free`/`request`/`block` per cell; spans fill all
  covered hours; pending/rejected requests do not occupy.
- `apps/api` (service): admin gate (non-admin → `ForbiddenException`); grid for the fixture above;
  **consistency with C3** — the count of `free` cells per hour equals `freeCourtsByHour` for the same
  date/data.
- `apps/bot`: `courtLoadGridText` renders the expected glyphs/legend for a small grid (pure render
  test, no network).

## Dependencies

C1 (courts), C3 (availability/free-court math), C4 (confirmed requests), C5 (blocks). All implemented.

## Open questions (with chosen defaults)

1. **Rendering format in Telegram** — text grid vs generated image. **Default: compact monospace text
   grid for MVP** (per brief). Image generation deferred.
2. **Grid query schema** — add a dedicated `courtLoadQuerySchema` vs reuse `courtAvailabilityQuerySchema`
   (identical shape). **Default: reuse `courtAvailabilityQuerySchema`** to avoid a parallel date-only
   schema; add a dedicated one only if a field diverges later.
3. **Occupancy reads location** — duplicate the two reads into `CourtsRepository` vs share
   `CourtRequestsRepository`. **Default: add the two reads to `CourtsRepository`** (keeps the courts
   module self-contained) but copy the exact existing query bodies so behavior matches C3/C4.

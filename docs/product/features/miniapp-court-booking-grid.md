# Mini App court booking grid

## Goal

Replace the Mini App court-rental linear time/duration/court picker with a client-facing court-by-time
grid. The grid lets a client choose date and duration, tap a free court/start cell, optionally add
more courts at the same start/duration, then continue through the existing server preview and create
flow.

## Spec refs

- Approved plan: client-facing court/day grid similar to admin `CourtLoad`, with court rows and
  30-minute start columns.
- `docs/product/feature-roadmap.md`: Court rental includes client requests, multi-court holds, admin
  confirmation/rejection, blocks, and court load views; Mini App includes court request.
- `docs/architecture/domain-model.md`: `CourtRequestCourt` is the source of multi-court occupancy.
- `docs/architecture/database.md`: court availability is derived from active courts, confirmed/pending
  request holds, court blocks, and generated group-training blocks.
- Reference UI/contracts: `packages/types/src/court-contracts.ts`,
  `apps/miniapp/src/screens/CourtRequestScreen.tsx`, `apps/admin/src/pages/CourtLoad.tsx`.

## Contracts and tables

- Reuse existing request contracts: `previewCourtRequestSchema`, `createCourtRequestSchema`,
  `courtRequestPreviewSchema`, `courtDurationHours`, `courtNumber`, `slotAlignedTime`.
- Reuse `courtAvailabilityQuerySchema` only if the grid is date-only. Preferred smallest correct
  addition is a client-redacted grid query with `date` and `durationHours`, because cell availability
  depends on the chosen duration.
- Add a client-only redacted grid contract if needed, for example:
  - `courtClientGridQuerySchema`: `date`, `durationHours`.
  - `courtClientGridCellSchema`: `startTime`, `available: boolean`.
  - `courtClientGridRowSchema`: `courtNumber`, `cells`.
  - `courtClientGridSchema`: `date`, `durationHours`, `workingHours`, `openTime`, `closeTime`, `rows`.
- Do not return admin-only `CourtLoadGrid`, court ids, request ids, training ids, block ids,
  unassigned trainings, or unavailable reasons on any client path.
- Tables read: `courts`, `court_blocks`, `court_requests`, `court_request_courts`, and generated
  group-training blocks via existing court availability logic. Tables written only by create:
  `court_requests`, `court_request_courts`.

## API

- `GET /court-requests/client-grid?date=YYYY-MM-DD&durationHours=N`
  - Auth/input follows the existing Mini App court request client conventions.
  - Response is the redacted client grid above.
  - Rows are active court numbers. Columns are 30-minute start times inside effective working hours
    where `start + duration <= closeTime`.
  - `available` is true only when that specific court is free for every covered 30-minute segment.
    All other states collapse to `available: false`.
- `POST /court-requests/preview`
  - Keep existing contract. Mini App sends `telegramId`, `date`, `startTime`, `durationHours`,
    `courtNumbers`.
  - Server computes price and returns authoritative availability.
- `POST /court-requests`
  - Keep existing contract. Create rechecks availability in the write transaction and creates pending
    holds atomically.

## Mini App flow

- Date is chosen first from the existing offered date window.
- Duration is chosen before the grid; changing date or duration clears the selected start/courts.
- The grid renders courts as rows and 30-minute starts as columns using effective working hours.
- Free cells are tappable. Unavailable cells are red and disabled, with no reason shown.
- First tap selects `{startTime, durationHours, courtNumber}`.
- Tapping another free court in the same start-time column toggles it into/out of the selection.
- Tapping a free cell in a different start-time column resets selection to that start and court.
- Continue is enabled only when at least one court is selected.
- Preview and submit screens stay server-authoritative; a preview unavailable result or submit `409`
  returns the user to a calm "pick another slot" state.

## Invariants

- Server is the source of truth for availability, working hours, and price; Mini App never computes
  price or decides final availability.
- Pending client requests hold selected courts and make those cells unavailable to other clients.
- Confirmed requests, pending holds, manual blocks, generated training blocks, inactive courts, and
  out-of-window starts are all unavailable to clients with the same red state.
- Client grid redacts occupancy reasons and all internal ids.
- Create remains atomic: recheck every selected court over every covered 30-minute segment before
  writing `court_requests` and `court_request_courts`.

## Acceptance criteria

- A client can pick date and duration, see a court/time grid, select one or more free courts at the
  same start time, preview the server price, and submit a pending request.
- The grid includes no starts where the chosen duration would end after close time.
- Unavailable cells are visibly disabled/red and expose no reason, ids, client names, request links,
  training details, or block details.
- Selecting a different start time clears previous selected courts.
- Preview/create still reject a slot that became unavailable after the grid loaded.
- Existing bot court request flow remains compatible with omitted `courtNumbers`.

## Tests

- Contract tests for the new redacted grid query/response, including duration coercion and 30-minute
  alignment.
- API/service tests that map request, hold, block, training, inactive, and free cells into only
  `available: true/false`.
- API/service tests that exclude starts where `start + duration > closeTime`.
- Privacy test that the client grid response contains no ids or unavailable reasons.
- Create/preview conflict tests for a slot taken after the grid was loaded.
- Mini App tests for selection reset by date/duration/start change, same-column multi-court toggling,
  disabled unavailable cells, and preview payload court numbers.

## Dependencies and defaults

- Depends on the existing court rental domain, multi-court holds, working-hours resolution, preview,
  create, and admin court-load availability logic.
- Default: implement a new client-redacted grid contract/API instead of reusing admin `CourtLoadGrid`.
- Default: grid rows include active courts only; inactive courts are not selectable and should not be
  presented as bookable inventory.
- Default: duration is chosen before grid load so the server can mark each court/start cell for the
  full requested interval.
- Default: keep current offered date window from `CourtRequestScreen`.
- Default: no production-code behavior changes outside the Mini App court request flow and the new
  redacted read API.

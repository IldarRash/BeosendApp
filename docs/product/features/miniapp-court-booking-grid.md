# Mini App court booking grid

## Goal

Replace the Mini App court-rental linear time/duration/court picker with a compact month calendar,
restyled duration selector, and client-facing court-by-time grid. The grid lets a client choose date
and duration, tap a free court/start range, optionally add more courts at the same start/duration,
then continue through the existing server preview and create flow.

## Spec refs

- Approved plan: Mini App compact month calendar, restyled duration selector, full-duration selected
  range highlight, visible disabled overflow starts, and admin request action linking into Court Load.
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
- Use the client-redacted grid contract:
  - `courtClientGridQuerySchema`: `date`, `durationHours`.
  - `courtClientGridCellState`: add/keep states for `free`, `unavailable`, and `overflow`.
  - `courtClientGridCellSchema`: `startTime`, `endTime`, `state`.
  - `courtClientGridRowSchema`: `courtNumber`, `cells`.
  - `courtClientGridSchema`: `date`, `durationHours`, `workingHours`, `rows`.
- Do not return admin-only `CourtLoadGrid`, court ids, request ids, training ids, block ids,
  unassigned trainings, or unavailable reasons on any client path.
- Tables read: `courts`, `court_blocks`, `court_requests`, `court_request_courts`, and generated
  group-training blocks via existing court availability logic. Tables written only by create:
  `court_requests`, `court_request_courts`.
- Admin navigation uses existing `courtRequestAdminViewSchema` and `courtLoadGridSchema`; no new
  admin data exposure is required for the deep link.

## API

- `GET /court-requests/client-grid?date=YYYY-MM-DD&durationHours=N`
  - Auth/input follows the existing Mini App court request client conventions.
  - Response is the redacted client grid above.
  - Rows are active court numbers. Columns are 30-minute start times inside effective working hours,
    including starts where `start + durationHours > closeTime`.
  - A cell is `free` only when the requested duration fits before close time and that court is free
    for every covered 30-minute segment.
  - A cell is `overflow` when the start is inside working hours but the requested
    duration would end after close time. It is visible and disabled with distinct styling.
  - Occupied, blocked, held, inactive, and otherwise unavailable starts use `unavailable`; no
    unavailable reason or internal id is returned.
- `POST /court-requests/preview`
  - Keep existing contract. Mini App sends `telegramId`, `date`, `startTime`, `durationHours`,
    `courtNumbers`.
  - Server computes price and returns authoritative availability.
- `POST /court-requests`
  - Keep existing contract. Create rechecks availability in the write transaction and creates pending
    holds atomically.
- Admin route `/court-load?date=YYYY-MM-DD&requestId=<uuid>`
  - No new API endpoint is required.
  - Court Load seeds its date from `date` and highlights the matching request interval when
    `requestId` is present in the loaded grid.

## Mini App flow

- Date is chosen first from an embedded compact month calendar using the existing offered date
  window; the horizontal date strip is removed.
- Duration is chosen before the grid using the restyled selector; changing date or duration clears
  the selected start/courts.
- The grid renders courts as rows and 30-minute starts as columns using effective working hours.
- Free cells are tappable. Unavailable cells are red and disabled, with no reason shown. Overflow
  cells are disabled with a distinct style, separate from occupied/unavailable cells.
- First tap selects `{startTime, durationHours, courtNumber}`.
- Tapping another free court in the same start-time column toggles it into/out of the selection.
- Tapping a free cell in a different start-time column resets selection to that start and court.
- The selected visual state spans every covered 30-minute segment for the selected duration on every
  selected court, not only the first start cell.
- Continue is enabled only when at least one court is selected.
- Preview and submit screens stay server-authoritative; a preview unavailable result or submit `409`
  returns the user to a calm "pick another slot" state.

## Admin flow

- In the admin court request queue/detail, add an action that navigates to
  `/court-load?date=YYYY-MM-DD&requestId=<requestId>`.
- Court Load initializes its date filter from the `date` query parameter.
- When the loaded grid contains the request id, Court Load highlights the request's interval across
  all held/assigned courts while preserving the existing request detail behavior.
- If the request id is absent from the loaded grid, Court Load still opens on the requested date and
  shows the normal grid without an error state.

## Invariants

- Server is the source of truth for availability, working hours, and price; Mini App never computes
  price or decides final availability.
- Pending client requests hold selected courts and make those cells unavailable to other clients.
- Confirmed requests, pending holds, manual blocks, and generated training blocks are all unavailable
  to clients with the same red state; inactive courts are omitted from client rows.
- Starts outside effective working hours are omitted.
- Starts inside working hours that cannot fit the selected duration before close time remain visible
  but disabled with the distinct overflow state.
- Client grid redacts occupancy reasons and all internal ids.
- Create remains atomic: recheck every selected court over every covered 30-minute segment before
  writing `court_requests` and `court_request_courts`.

## Acceptance criteria

- A client can pick date and duration, see a court/time grid, select one or more free courts at the
  same start time, preview the server price, and submit a pending request.
- The date selector is an embedded compact month calendar, not the old horizontal date strip.
- The duration selector uses the approved restyled presentation and still offers the existing
  duration choices.
- The selected range highlights the full selected duration across every selected court.
- Starts where the chosen duration would end after close time remain visible, disabled, and visually
  distinct from unavailable/occupied cells.
- Unavailable cells are visibly disabled/red and expose no reason, ids, client names, request links,
  training details, or block details.
- Selecting a different start time clears previous selected courts.
- Preview/create still reject a slot that became unavailable after the grid loaded.
- Existing bot court request flow remains compatible with omitted `courtNumbers`.
- Admin court request action opens `/court-load?date=YYYY-MM-DD&requestId=...`; Court Load uses that
  date and highlights the matching request interval when present.

## Tests

- Contract tests for the new redacted grid query/response, including duration coercion and 30-minute
  alignment.
- API/service tests that map request, hold, block, training, inactive, free, and overflow cases into
  only the client-safe states, with inactive courts omitted.
- API/service tests that return overflow cells for starts where
  `start + duration > closeTime`.
- Privacy test that the client grid response contains no ids or unavailable reasons.
- Create/preview conflict tests for a slot taken after the grid was loaded.
- Mini App tests for selection reset by date/duration/start change, same-column multi-court toggling,
  disabled unavailable cells, disabled overflow cells, full-duration range highlighting, compact month
  calendar selection, restyled duration selector, and preview payload court numbers.
- Admin tests for the court request action URL, Court Load date seeding from query params, and
  request interval highlighting from `requestId`.

## Dependencies and defaults

- Depends on the existing court rental domain, multi-court holds, working-hours resolution, preview,
  create, and admin court-load availability logic.
- Default: implement a new client-redacted grid contract/API instead of reusing admin `CourtLoadGrid`.
- Default: grid rows include active courts only; inactive courts are not selectable and should not be
  presented as bookable inventory.
- Default: duration is chosen before grid load so the server can mark each court/start cell for the
  full requested interval.
- Default: keep current offered date window from `CourtRequestScreen`.
- Default: overflow is a client-safe state because it reveals only working-hours fit, not
  occupancy details.
- Default: no domain behavior changes outside the Mini App court request flow, the redacted read API,
  and the admin request-to-Court-Load navigation/highlight.

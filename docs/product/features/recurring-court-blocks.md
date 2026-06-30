# Recurring court blocks

## Goal

Allow an admin to create a series of manual court blocks from the web admin console by choosing one
court, a date range, weekdays, a time window, and a reason. The API creates one normal
`court_blocks` row per matching date, so existing availability and load-grid behavior keep working.

## Spec refs

- Roadmap court domain C5: admin manual court blocks.
- Roadmap court domain C6: court load grid reflects blocks.
- User request: support repeated blocks over multiple days.

## Contracts & tables

- `packages/types/src/court-contracts.ts`
  - Add `createRecurringCourtBlocksSchema`.
  - Response is `CourtBlock[]`.
- `packages/db/src/schema.ts`
  - No new table or column.
  - Reuse `court_blocks`; each occurrence is a normal manual block with `groupTrainingId = null`.

## API

- `POST /court-blocks`
  - Existing single-block create remains unchanged.
- `POST /court-blocks/recurring`
  - Body: `{ courtId, from, to, daysOfWeek, startTime, endTime, reason }`.
  - `from..to` is inclusive; `daysOfWeek` uses ISO weekdays (`1 = Monday ... 7 = Sunday`).
  - Admin-only via `x-telegram-id`.
  - All-or-error: if any selected date conflicts with an existing confirmed request or block on the
    same court, create zero blocks and return an error that names the conflicting date/time.
  - Returns the created `CourtBlock[]`.

## Admin flow

- On `/court-blocks`, the existing “Новая блокировка” modal gets a repeat mode.
- Single mode sends the current single-date payload.
- Repeat mode asks for start date, end date, weekdays, time window, and reason, then calls
  `POST /court-blocks/recurring`.
- On success, invalidate court-block list and court-load grid queries and show how many blocks were
  created.

## Invariants

- Admin-only writes are enforced in the service before DB reads/writes.
- Blocks must stay inside court working hours and on the 30-minute grid.
- A manual block may not overlap a confirmed booking or another block on the same court.
- The client-facing court availability and admin load grid must reflect created rows without new
  special-case logic.

## Acceptance criteria

- Admin can create a recurring block for a date range and selected weekdays.
- Every matching date creates one visible manual block.
- If one date conflicts, no rows from the series are created.
- Existing delete and range list behavior works for recurring-created blocks.

## Tests

- Contract accepts a valid recurring request and rejects empty weekdays, `from > to`, bad times, and
  unknown fields.
- Service creates blocks for only the selected weekdays in the inclusive range.
- Service rejects non-admin callers before DB writes.
- Service rejects a conflicting series without inserting partial rows.
- Admin page sends the recurring payload and renders conflict errors.

## Dependencies

- Existing court blocks, court list, and court load features.

## Open questions

- Conflict policy: all-or-error.
- Repeat shape: date range plus weekdays.

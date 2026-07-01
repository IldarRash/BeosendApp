# Admin Training Roster Management

## Goal

Let a manager remove a client from a training directly in the admin roster modal. Removal is a
soft-cancel of the existing booking: keep the booking row for history, recompute the training
`bookedCount`/`status`, and let the existing waitlist promotion path fill the freed seat.

Existing add-person/manual booking stays the add path and is reused or lightly refreshed only where
the roster modal needs current data after add/remove.

## Spec refs

- `docs/product/feature-roadmap.md`: Stage 1 training booking/cancellation (TZ 4.1, 4.2, 11), Stage 2
  waitlist promotion (TZ 9), manager console roster operations (TZ 14, 15).
- `docs/product/features/admin-console.md`: M2 operations, especially `GET /trainings/:id/roster`.
- `docs/product/features/walkin-manual-booking.md`: existing admin add-person/manual booking flow.
- `docs/architecture/domain-model.md` and `docs/architecture/database.md`: Group -> Trainings ->
  Bookings backbone, server-owned capacity/status recompute, booking rows preserved.

## Contracts & tables

- Reuse `packages/types/src/training-contracts.ts`:
  - `trainingRosterSchema` / `rosterParticipantSchema` for modal rows.
  - `bookingSchema` as the cancel response.
  - `createManualBookingSchema` remains the add-person contract.
- No new DB table or migration expected.
- Touched tables at runtime:
  - `bookings.status`: set the target booking to `cancelled`.
  - `trainings.booked_count` and `trainings.status`: recomputed in the same transaction.
  - `waitlist`: may change only through existing post-cancel promotion.

## API

- Keep `GET /trainings/:id/roster -> TrainingRoster`.
- Reuse `POST /bookings/:id/cancel -> Booking` for roster removal.
  - Path `:id` is the `bookingId` from `RosterParticipant`.
  - Empty body; response validates against `bookingSchema`.
  - Service must keep the current soft-cancel semantics: lock booking/training, reject
    non-cancellable statuses, mark one booking `cancelled`, decrement count, recompute status, then
    run waitlist promotion after commit.
- Keep `POST /bookings/manual -> Booking` for add-person; do not add a parallel booking route.

## Admin Flow

1. Manager opens a training detail/roster modal.
2. Roster rows show the existing participant data plus a remove action for cancellable
   `booked`/`pending` rows.
3. Clicking remove opens a small confirmation naming the client and training date/time.
4. Confirm calls `POST /bookings/:bookingId/cancel`.
5. On success the modal refreshes roster, training detail/list occupancy, and waitlist queue. The
   removed row disappears because rosters exclude cancelled bookings; any promoted waitlist client
   appears after refetch.

## Invariants

- No hard delete: booking history, `groupSubscriptionId`, source, and payment fields remain.
- One booking only: monthly subscription siblings are not touched.
- Capacity/status math remains server-side and transactional; the admin app never decrements counts
  locally.
- Waitlist promotion is the existing post-commit path; cancellation stands even if promotion or
  notification fails.
- Removal is for seat-holding bookings only (`booked` or `pending`). `cancelled`, `attended`,
  `no_show`, and `waitlist` rows are not removable from this modal.
- Admin authorization is enforced server-side. The browser only sends the verified session token.

## Acceptance Criteria

- A manager can remove a `booked` participant from the roster modal and see the refreshed roster and
  occupancy without closing the modal.
- Removing from a full training flips it to open unless waitlist promotion refills the seat.
- Removing one date from a monthly booking cancels only that booking row; the rest of the
  subscription remains booked.
- If the training has an active waitlist, the existing promotion flow is allowed to promote the head
  entry and the modal refresh shows the resulting roster/queue.
- Non-admin callers cannot remove someone else's booking through the admin surface.
- Attempts to remove an already cancelled, attended, no-show, or waitlist row surface the server
  error and do not alter counts.
- Add-person remains the existing manual booking flow; no duplicate add-person implementation is
  introduced.

## Tests

- API service/controller: admin cancels another client's `booked`/`pending` booking; `bookedCount`
  and status recompute; monthly siblings stay unchanged; forbidden caller gets 403; non-cancellable
  statuses get 409.
- API service: waitlist promotion is invoked after successful cancel and never before commit.
- Admin ApiClient/hook: `cancelBooking(bookingId)` calls `POST /bookings/:id/cancel` and validates
  `bookingSchema`.
- Admin UI: roster modal renders remove actions only for cancellable rows, confirms before mutation,
  invalidates roster/trainings/detail/waitlist, and shows server errors verbatim.
- Running-app check: remove from a full training with a waiting entry and verify roster, occupancy,
  and queue update from the API.

## Dependencies

- Existing admin auth/session bridge and roster modal from `admin-console` M0-M2.
- Existing manual add-person flow from `walkin-manual-booking`.
- Existing booking cancellation and waitlist promotion services.
- Handoff: `backend-implementer` for any missing admin cancel tests/API client contract notes,
  `frontend-implementer` for modal actions and invalidation, `test-writer` for coverage.
  `bot-implementer` has no UI work unless product later asks for bot-side manager removal.

## Open Questions

- Endpoint shape: add an admin-specific route or reuse the current cancel route? Default: reuse
  `POST /bookings/:id/cancel`.
- Removed-client notification: send a new cancellation DM? Default: no new notification/template in
  this slice; waitlist promotion notifications keep working as they do today.
- Who can remove from the admin modal: admins only or trainer-of-training too? Default: admins/managers
  only through the verified admin console.
- Which rows are removable? Default: only seat-holding `booked` and `pending` bookings.
- Add-person inside the roster modal? Default: keep the existing add-person/manual booking entry
  point; if surfaced inside the modal, it must launch the same flow and contracts.

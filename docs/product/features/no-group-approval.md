# Feature: No approval for new group-training bookings

## Goal

Client bookings for group trainings are confirmed immediately. A single visit to a group training and
a monthly group subscription no longer wait for admin/trainer approval.

## Spec refs

- Training booking domain: clients book school trainings, either one concrete training or a whole
  month of a group.
- Mandatory model: **Group -> Trainings -> Bookings**.
- Owner-requested change: narrow the previous pending-confirmation behavior so new group-training
  bookings are final at creation time.

## Contracts & tables

No schema, migration, or contract changes.

- `packages/types/src/training-contracts.ts`: existing `Booking` and `GroupBookingResult` contracts
  stay unchanged.
- `packages/db/src/schema.ts`: `bookings.status` still includes `pending` for legacy rows and the
  existing confirm/decline flow.

## API

- `POST /bookings/single`
  - Request stays `createSingleBookingSchema`.
  - Accepts only current public client-bookable group-training slots: today/future date, `open`,
    free capacity, non-hidden active group, active trainer, and active level.
  - Returns a `Booking` with `status = "booked"` immediately.
- `POST /bookings/group`
  - Request stays `createGroupBookingSchema`.
  - Rejects non-client-bookable monthly targets before writes: hidden groups, inactive groups,
    inactive trainers, and inactive levels cannot create bookings, waitlist rows, or bonus credits.
  - Returns `GroupBookingResult`; every row in `created` is already `status = "booked"`.
  - `waitlisted` and `skipped` behavior stays unchanged.
- Legacy decision endpoints remain for existing pending rows:
  - `POST /bookings/:id/confirm`
  - `POST /bookings/:id/decline`
  - `POST /bookings/subscription/:groupSubscriptionId/confirm`
  - `POST /bookings/subscription/:groupSubscriptionId/decline`

## Bot / Mini App flow

- After confirming a single group-training slot, the user sees the normal booked/success result.
- After confirming a monthly group subscription, the user sees the booked subscription result with
  the created count, waitlisted dates, and skipped dates from `GroupBookingResult`.
- New bookings do not generate an admin approval DM or trainer/admin confirm-decline keyboard.

## Invariants

- Capacity locking, duplicate guards, `bookedCount` updates, and `open <-> full` recompute stay
  unchanged.
- Stale or forged public booking IDs cannot bypass the same visibility/active-status filters used
  by the client-facing catalogue.
- A legacy `pending` booking still holds a seat, counts toward capacity, can be cancelled by the
  client, and can be confirmed or declined by trainer/admin.
- Declining a legacy pending row still frees the held seat and runs the existing waitlist promotion.
- Court requests stay pending/admin-decided; individual training requests stay notification-only and
  unchanged.

## Acceptance criteria

1. `POST /bookings/single` creates a `booked` row immediately and sends the existing booking
   confirmation path, with no pending/admin approval notification.
2. `POST /bookings/group` creates monthly subscription rows as `booked` immediately and sends the
   existing group confirmation path, with no subscription approval notification.
3. Full/cancelled/duplicate/stale-forged cases keep the existing conflict, waitlist, and skipped
   behavior; no hidden/inactive group, trainer, or level is bookable and no seat is oversold.
4. Legacy pending single bookings and subscriptions can still be confirmed/declined through the
   existing endpoints; non-pending rows are rejected as not decidable.
5. No DB migration, Zod contract change, or status enum removal is introduced.
6. Bot and Mini App success states show immediate confirmed booking/subscription copy, not
   awaiting-approval copy, for new bookings.

## Tests

- Repository SQL guards: public single booking requires today/future open grouped training with free
  capacity plus non-hidden active group, active trainer, and active level; monthly group booking
  requires active non-hidden group with active trainer and active level.
- API `createSingle`: returns `status = "booked"`, increments/recomputes capacity exactly once, sends
  booking confirmation, rejects stale/forged IDs for hidden/inactive/past/non-group slots without an
  insert, and does not call pending/admin approval notifications.
- API `createGroupBooking`: created rows are all `booked`, confirmation summary is sent for created
  rows, hidden groups and inactive trainer/level targets reject before booking/waitlist/bonus-credit
  side effects, no admin approval DM is sent, and existing waitlisted/skipped cases still pass.
- Legacy decision endpoints: seeded `pending` single/subscription rows can be confirmed/declined;
  already `booked` rows return the existing conflict path.
- Bot and Mini App booking flows render the immediate success/result state and keep conflict/waitlist
  handling unchanged.

## Dependencies

None.

## Open questions

None. Default: do not migrate historical `pending` rows; leave them decidable through the legacy
confirm/decline endpoints.

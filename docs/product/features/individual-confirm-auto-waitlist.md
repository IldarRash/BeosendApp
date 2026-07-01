# Individual Confirm + Auto-Waitlist

## Goal

Clients can request a one-off individual training with a selected trainer. The
request is durable and must be confirmed or declined by the selected trainer or
an admin. Separately, `POST /bookings/single` auto-waitlists a client when the
selected visible group training is full, while preserving the existing booking
shape for successful bookings.

## Contracts

- `individualTrainingRequestSchema`: pending/confirmed/declined request row with
  `clientId`, `trainerId`, `date`, `startTime`, `endTime`, nullable `trainingId`,
  `createdAt`, nullable `decidedAt`, and nullable `decidedBy`.
- `individualRequestSchema`: body for `POST /trainers/:id/individual-request`,
  strict `{ telegramId, date, startTime, endTime }`, with `endTime > startTime`.
- `individualRequestResultSchema`: durable request id plus delivery status.
- `individualRequestDecisionResultSchema`: confirmed result carries the decided
  request, created individual training, and owner booking; declined result
  carries only the decided request.
- `singleBookingResultSchema`: union of existing `Booking` for a booked seat, or
  `{ status: "waitlisted", waitlistEntry, position }` for auto-waitlist.

## Database

- New table `individual_training_requests`.
- New enum `individual_training_request_status` with `pending`, `confirmed`,
  `declined`.
- Foreign keys: request `client_id -> clients.id`, `trainer_id -> trainers.id`,
  nullable `training_id -> trainings.id`.

## API Behavior

- `POST /trainers/:id/individual-request`
  - Validates the strict body contract at the controller boundary.
  - Resolves actor from `x-client-telegram-id ?? x-telegram-id`.
  - Requires `body.telegramId` to equal the resolved actor.
  - Service resolves the caller's client by `telegram_id`, rejects missing client,
    missing/inactive trainer, past date, and invalid time range.
  - Creates a pending durable request before notification.
  - Sends a trainer DM when the trainer has a numeric `telegramId`; otherwise
    sends admin fallback DMs. Buttons use `confirm:ind:<requestId>` and
    `decline:ind:<requestId>`.

- `POST /trainers/individual-requests/:requestId/confirm`
  - Empty strict body.
  - Authorizes admin or the selected trainer by `telegram_id`.
  - Locks the request. A non-pending request returns 409.
  - In one transaction creates exactly one individual training and one owner
    booking, then links the request to the training and marks it confirmed.
  - Sends the client booking-confirmed notification after commit.

- `POST /trainers/individual-requests/:requestId/decline`
  - Empty strict body.
  - Authorizes admin or the selected trainer by `telegram_id`.
  - Locks the request. A non-pending request returns 409.
  - Marks the request declined only. No training or booking is created.

- `POST /bookings/single`
  - Still returns the existing `Booking` shape for a successful booked seat.
  - For a full visible group training, appends a plain waitlist entry and returns
    `{ status: "waitlisted", waitlistEntry, position }`.
  - Does not auto-waitlist duplicates, cancelled/completed rows,
    hidden/inactive/non-visible rows, past rows, or individual/non-group rows.

- `PATCH /trainings/:id/price`
  - Admin-only.
  - Strict body `{ priceSingleRsd: rsd | null }`.
  - Applies only to individual trainings (`groupId = null` and `clientId` set);
    group/non-individual targets return 400.
  - Cancelled/completed targets return 409 and are not mutated.

- `PATCH /trainings/:id/price-series`
  - Admin-only; same strict body as the single price edit.
  - Applies only to a future individual series/month resolved through the owner
    booking's `groupSubscriptionId`, matching the time-series resolver.
  - Mutates the target plus future non-terminal siblings only; past targets are
    rejected with 409 so history cannot be silently rewritten.
  - One-off individuals without a subscription link fall back to the target only.

- `DELETE /trainings/:id/series`
  - Admin-only.
  - Applies only to a future individual series/month resolved through the owner
    booking's `groupSubscriptionId`.
  - Soft-cancels future non-terminal targets through the same single-training
    cancel path: bookings are cancelled, court blocks freed, and affected clients
    notified. Past targets are rejected with 409.

- `POST /bookings/manual`
  - Admin/trainer manual booking keeps normal group capacity behavior.
  - For an individual training only, a full confirmed owner session can accept one
    extra manually added participant by expanding capacity inside the same
    transaction before the shared seat write.
  - Duplicate-client guard still runs before expansion; the second participant gets
    a normal `booked` single booking.

## Invariants

- Client writes remain self-only through `telegram_id` ownership checks.
- Request decisions are made only by the selected trainer or admin.
- Confirm is atomic: request lock, individual training, owner booking, and request
  link/decision commit together.
- Double decisions fail with 409 and create no duplicate training or booking.
- Individual training status is recomputed server-side from capacity/booked count.
- Individual price and series-cancel writes are individual-only and future-only.
- Auto-waitlist never consumes capacity and never inserts an overflow booking.
- Manual second-participant expansion is individual-only; group trainings still
  reject when full.
- Existing group/month waitlist behavior is unchanged.

## Acceptance Criteria

- Contracts parse valid individual requests, durable request rows, decision
  results, and the single-booking waitlisted result; invalid time ranges and
  unknown fields are rejected.
- Trainer request tests cover missing client/trainer, past date, trainer-first
  DM, admin fallback, username-only trainer fallback, and unavailable delivery.
- Decision tests cover selected-trainer/admin authorization, confirm creates one
  training plus one owner booking, decline creates none, and already-decided rows
  409.
- Single-booking tests cover booked success, full visible group auto-waitlist,
  duplicate waitlist 409, and non-visible/non-group/past/terminal rejection.
- `packages/db/drizzle/0021_plain_zaran.sql` is generated from the schema change.

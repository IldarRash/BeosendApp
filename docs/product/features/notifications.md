# T2.2 — Notifications

**Goal.** Send the required automatic messages: booking confirmation, 24 h and 3 h reminders, waitlist
slot, and training cancellation. This slice delivers the two events whose triggers already exist
end-to-end — **booking confirmation** and the **24 h / 3 h reminders** — plus a reusable, idempotent
`NotificationsService` the future cancellation-fan-out (T1.12) and waitlist-slot (T2.1) features call.

**Spec refs.** ТЗ §15.4, §16; UX §14.

## Smallest correct slice

Outbound only. A new `notifications` Nest module owns every outbound Telegram send and the
`notifications` log. The bookings flow calls it after a commit; a scheduler drives the reminders. No
bot handlers, no contracts, no schema change.

## Contracts & tables (already exist — reuse, do not re-create)

- `notificationType` Zod enum — `packages/types/src/training-contracts.ts`
  (`booking-confirmed`, `reminder-24h`, `reminder-3h`, `waitlist-slot`, `training-cancelled`).
- `notifications` table — `packages/db/src/schema.ts`
  (`id`, `type`, `clientId`, `trainingId` nullable, `sentAt`). The send log = the idempotency key.
- `TELEGRAM_BOT_TOKEN` — already in the env contract (`packages/config/src/env.ts`). The API sends
  outbound directly with this token.

**No schema change. No new contract.** (If a future slice needs a `dedupeKey`/window column it is out
of scope here; the `(clientId, trainingId, type)` triple plus a per-window `sentAt` check is enough.)

## API / runtime — `apps/api/src/modules/notifications/`

- **`NotificationsRepository`** — the only DB access to `notifications` (and read-only joins for
  recipient selection). Methods:
  - `hasBeenSent(clientId, trainingId, type)` — exists-check against the log (idempotency).
  - `logSent({ type, clientId, trainingId })` — insert one row; `sentAt` defaults to now.
  - `findDueReminders(type, windowStart, windowEnd)` — returns, for trainings whose start
    (`date` + `startTime`) falls in the window and whose status is `open|full` (never
    `cancelled|completed`), each `booked` booking's `clientId` + the client's `telegramId` +
    training render fields (date, start/end, trainer name, level name) **left-joined to the
    `notifications` log so already-sent rows for that `type` are excluded in SQL**.
  - `findRecipientsByClientIds(trainingId, clientIds, type)` — render fields + `telegramId` for the
    given clients on one training, **regardless of current booking status** (the cancel tx flips the
    bookings to `cancelled` before the fan-out runs), excluding those already logged for `type` (used
    by the cancellation fan-out with the clientIds the cancel tx captured).
- **`TelegramSender`** (small provider) — `sendMessage(telegramId, text)` via a `fetch` POST to
  `https://api.telegram.org/bot<token>/sendMessage`. Token from injected `Env`. No grammY dependency
  in the API. Never logs the token; logs failures via Nest `Logger`.
- **`NotificationsService`** — owns the domain logic:
  - `sendBookingConfirmation(clientId, trainingId)` — idempotent per
    `(clientId, trainingId, 'booking-confirmed')`: skip if already logged, else render the UX §14
    template, send, then `logSent`. Tolerates a send failure (log + return) — a committed booking is
    never undone because Telegram was unreachable.
  - `sendDueReminders(type, now)` — pure-ish driver: compute the window from `now`, fetch due
    recipients, send + log each, one row per `(client, training, type)`. Returns a count for the
    scheduler log.
  - `sendTrainingCancelled(trainingId)` — fan-out to every `booked` client of the training, idempotent
    per `(client, training, 'training-cancelled')`. **Exposed now** so T1.12 (the training-cancel
    write) can call it; not triggered by any endpoint in this slice.
- **`NotificationsScheduler`** (`@nestjs/schedule` `@Cron`) — every 5 min calls
  `sendDueReminders('reminder-24h', now)` and `sendDueReminders('reminder-3h', now)`. Window =
  target ± 15 min (default; see open questions). Wire `ScheduleModule.forRoot()` once in
  `AppModule`.
- **Booking confirmation hook** — `BookingsService.createSingle` and `createGroupBooking` call
  `NotificationsService.sendBookingConfirmation` **after the transaction commits**, fire-and-forget
  (awaited but failure-tolerant). For a group booking, send one confirmation per created booking (or a
  single batch-summary confirmation — see open questions). Import `NotificationsService` into
  `BookingsModule` (and export it from `NotificationsModule`).

### Endpoints

**None.** This feature adds no HTTP route. All sends are server-internal (booking flow + scheduler).
Confirmation is sent inline by the booking flow (T1.8/T1.9); cancellation fan-out is invoked by T1.12;
waitlist-slot by T2.1.

## Bot flow

Outbound only. Messages match the UX §14 templates (date / level / trainer / time). The bot process
keeps handling inbound updates; the API owns every outbound send. No bot handler, keyboard, or
`ApiClient` change in this slice.

## Invariants

- **Idempotent per `(client, training, type)` via the `notifications` log — never double-send.** This
  is the single most important invariant: a reminder window that overlaps two scan ticks, a re-run
  group booking, or a retried send must not produce a second message; the exists-check/left-join
  anti-join against the log guarantees at-most-once per type.
- Sends are **server-side** (API holds the bot token); the bot never sends domain notifications.
- Reminders only target trainings that are still `open|full`; a `cancelled`/`completed` training is
  never reminded.
- A Telegram send failure is logged, never fatal, and never rolls back a committed booking.

## Acceptance criteria

- Booking (single or group) yields a confirmation message, exactly once per booking.
- A training ~24 h / ~3 h out yields exactly one reminder per booked client per window, even across
  multiple scan ticks.
- `sendTrainingCancelled` notifies all of a training's booked clients exactly once (covered by tests;
  triggered for real by T1.12).

## Tests

- Service (unit, mocked repo + sender):
  - **Idempotency**: second `sendBookingConfirmation`/`sendDueReminders` call within a window sends
    nothing (no duplicate log).
  - **Recipient selection by window**: with a fixed clock, only trainings inside ±15 min of the 24 h /
    3 h target are reminded; `cancelled`/`completed` excluded.
  - **Cancellation fan-out**: every booked client gets one `training-cancelled`, idempotently.
  - **Failure tolerance**: a thrown sender does not throw out of the booking confirmation path.
- Scheduler logic unit-tested with an injected/fixed `now`.
- `TelegramSender`: URL/payload shape and that the token never appears in thrown errors/logs.

## Dependencies

- T1.8 / T1.9 (bookings) — confirmation hook. Present.
- T1.4 (trainings) — reminder source rows. Present.
- Used by T2.1 (waitlist-slot) and T1.12 (training-cancel triggers the fan-out).

## Open questions (with chosen defaults)

1. **Reminder scan interval / window tolerance.** Default: scan every 5 min, target ± 15 min window;
   the log dedupe makes the window width safe.
2. **Group-booking confirmation: one message per created date or one batch summary?** Default: **one
   batch-summary confirmation** per `groupSubscriptionId` (a single message listing the month), to
   avoid flooding the client with N messages; logged once against the first/earliest training in the
   batch with type `booking-confirmed`. (If per-date is preferred, switch to one `booking-confirmed`
   row per created training.)
3. **Quiet hours / no reminder for a training already started?** Default: skip any training whose
   start is already in the past at scan time; no quiet-hours suppression in this slice.

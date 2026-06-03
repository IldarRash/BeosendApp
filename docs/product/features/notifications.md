# T2.2 — Notifications

**Goal.** Send the required automatic messages: booking confirmation, 24 h and 3 h reminders, waitlist
slot, and training cancellation.

**Spec refs.** ТЗ §15.4, §16; UX §14.

**Contracts & tables.** `notificationType` (`packages/types`); `notifications` table (send log for
idempotency + analytics).

**API / runtime.** `apps/api/src/modules/notifications/`:
- A `NotificationsService` that sends outbound Telegram messages via the bot token (grammY `Api` or
  fetch) to a client's `telegram_id`, and records a row in `notifications`.
- A `@nestjs/schedule` job (e.g. every few minutes) that finds trainings starting in ~24 h / ~3 h with
  active `booked` clients not yet notified for that type, and sends reminders.
- Confirmation is sent inline by the booking flow (T1.8/T1.9); cancellation broadcasts to all booked
  clients of a cancelled training; waitlist-slot is sent by T2.1.

**Bot flow.** Outbound only; messages match the UX §14 templates (date/level/trainer).

**Invariants.** Idempotent per (client, training, type) via the `notifications` log — never double-send
a reminder. Sends are server-side; the bot process handles inbound, the API handles outbound.

**Acceptance criteria.**
- Booking yields a confirmation.
- A training ~24 h / ~3 h out yields exactly one reminder per booked client per window.
- Cancelling a training notifies all its booked clients.

**Tests.** Service: idempotency (no duplicate within a window), recipient selection by window,
cancellation fan-out. Scheduler logic unit-tested with a fixed clock.

**Dependencies.** T1.8/T1.9 (bookings), T1.4 (trainings); used by T2.1.

**Open questions.** Reminder scan interval / window tolerance. Default: scan every 5 min, ±15 min
window.

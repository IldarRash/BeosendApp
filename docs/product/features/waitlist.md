# T2.1 — Waitlist

**Goal.** When a training is full, let a client join a waitlist; on a cancellation, notify and promote
the head, falling through to the next if they don't confirm in time.

**Spec refs.** ТЗ §9; UX §12. Invariants: CLAUDE.md (capacity/status recompute, ownership by
telegram_id, bot is interaction-only).

## Status of contracts & tables (mostly exist — reuse)

Already present, do NOT recreate:

- `packages/types/src/training-contracts.ts`: `waitlistStatus`
  (`waiting | notified | promoted | expired | cancelled`), `waitlistEntrySchema`, `WaitlistEntry`,
  and the `waitlist-slot` member of `notificationType`.
- `packages/db/src/schema.ts`: the `waitlist` table (`id, clientId, trainingId, position, status,
  addedAt`) and the `waitlist_status` / `notification_type` enums.

**To ADD:**

1. Contract request schema (new, in `training-contracts.ts`):
   `createWaitlistEntrySchema = z.object({ clientId: uuid, trainingId: uuid }).strict()` +
   `CreateWaitlistInput` type. (Mirror `createSingleBookingSchema`.)
2. DB field (genuinely required): `waitlist.notifiedAt timestamptz null`. The expiry sweep must know
   when a `notified` entry's confirmation window opened; `addedAt` is the queue time, not the notify
   time, so a new nullable column is required. Add it to the `waitlist` table AND to
   `waitlistEntrySchema` (`notifiedAt: z.string().datetime().nullable()`), then
   `corepack pnpm --filter @beosand/db db:generate` and commit the generated SQL.
3. Config (not a DB field): `WAITLIST_WINDOW_MINUTES` in `packages/config/src/env.ts`
   (`z.coerce.number().int().positive().default(30)`) — the confirmation-window length (open
   question default: 30 min).

## API — new module `apps/api/src/modules/waitlist/`

Files: `waitlist.controller.ts`, `waitlist.service.ts`, `waitlist.repository.ts`, `waitlist.module.ts`
(+ specs). Register `WaitlistModule` in `app.module.ts`. The module imports `NotificationsModule`
(for the promotion send) and provides `ClientsRepository` (ownership re-resolve).

Endpoints (controller thin; parse `x-telegram-id`, Zod-validate, call one service method — same shape
as `bookings.controller.ts`):

- `POST /waitlist` — body `{ clientId, trainingId }`. Service: assert ownership by telegram_id; load
  training FOR UPDATE; reject with **409 if the training is bookable** (waitlist is only for full
  slots) and reject duplicates (one active entry per client per training); append at
  `max(position)+1`. Returns the created `WaitlistEntry`.
- `POST /waitlist/:id/accept` — header `x-telegram-id`. Service: in one transaction, load the entry
  FOR UPDATE; assert ownership; require `status = notified` and the window
  (`now <= notifiedAt + WAITLIST_WINDOW_MINUTES`) still open (else 409/expire); **re-check capacity
  on the training FOR UPDATE — a seat must still be free** (`isBookable`); create a `booked` booking
  (`type: "single"`, `source: "telegram"`), increment `bookedCount`, recompute status
  (`recomputeTrainingStatus`), mark the entry `promoted`. Returns the created `Booking`.

Internal (NOT an HTTP endpoint): `WaitlistService.promoteNext(trainingId)` — find the head
`waiting` entry by lowest position, mark it `notified`, set `notifiedAt = now`, and trigger the
waitlist-slot notification (with the inline confirm button). Called from
`BookingsService.cancelBooking`'s existing post-commit seam (after the seat is freed and committed).
Wire bookings → waitlist via DI (add `WaitlistService` provider; avoid a circular module import by
keeping `promoteNext` dependency-light).

Expiry: a scheduler (reuse the `@Cron` pattern from `notifications.scheduler.ts`, e.g. every minute)
calls `WaitlistService.sweepExpired(now)` — for each `notified` entry past its window, mark `expired`
and call `promoteNext` for that training (promote the next head). Idempotent and self-tolerant.

## Notifications (extend, don't fork)

- Add `waitlistSlotMessage(recipient)` to `notification-messages.ts` and
  `NotificationsService.sendWaitlistSlot(clientId, trainingId, replyMarkup)` that sends the
  `waitlist-slot` message **with an inline "Подтвердить" button**, logging against
  (clientId, trainingId, `waitlist-slot`). Reuse `findClientTrainingRecipients` for render fields
  (the entry's training is full, so reminder/booked-only lookups don't fit — fetch the training
  render fields directly or relax the lookup; keep it in the repository).
- `TelegramSender.sendMessage` must accept an **optional `replyMarkup`** parameter (extend the
  existing method — do not add a parallel sender) so the promotion message can carry the inline
  confirm button. The button's callback_data is `waitlist:accept:<entryId>` (prefix 16 + uuid 36 = 52
  bytes, under 64).

## Bot flow (interaction only)

- Full slot: replace the placeholder `bookingFullKeyboard()` in `apps/bot/src/slots.ts` so the
  "Встать в лист ожидания" button carries `waitlist:join:<trainingId>`; add parse + handler. The bot
  forwards IDs only — the API decides eligibility.
- Promotion: the API push message carries the inline "✅ Подтвердить" button
  (`waitlist:accept:<entryId>`). Route both `waitlist:join:*` and `waitlist:accept:*` in
  `apps/bot/src/index.ts` (same dispatch table as booking callbacks); on accept success show the
  booking-success card, on 409 show "место уже занято / окно истекло" and a path back to the menu.
- `ApiClient`: add `joinWaitlist({ clientId, trainingId }, telegramId)` (parse `waitlistEntrySchema`,
  surface 409 as a typed result like `createSingleBooking`) and
  `acceptWaitlist(entryId, telegramId)` (parse `bookingSchema`, 409 → typed conflict result).

## Invariant (the one this feature must protect)

**Acceptance re-checks capacity atomically: a waitlist entry is promoted to a `booked` booking only
inside a transaction that locks the training FOR UPDATE and re-confirms a seat is still free, then
recomputes bookedCount + status (open ⇔ full).** Promotion never oversells; positions stay contiguous
per training and promotion respects order (lowest position first).

## Unsafe / forbidden path (must be tested and rejected)

`POST /waitlist` for a training that is **still bookable** (status `open` with free seats) must be
rejected with a 409 — the waitlist exists only for full trainings; a client must never sit on a
waitlist for a slot they could book directly. (Plus: a client cannot accept/join on another client's
behalf — ownership re-resolved from telegram_id — and an accept after the window or after the seat is
re-taken is rejected.)

## Acceptance criteria

- Joining a full training records position N (contiguous, one entry per client/training).
- A cancellation frees a seat and notifies position 1 with an inline confirm button.
- Accepting within the window books the client (atomic capacity re-check + recompute) and marks the
  entry `promoted`.
- No response within `WAITLIST_WINDOW_MINUTES` expires the entry and promotes the next head.
- Joining a still-bookable slot is rejected (409).

## Tests

- Service unit/integration: append/position contiguity; one-entry-per-client; promote order
  (lowest position first); accept books + increments + recomputes status; accept rejected when no
  seat free / window expired / not owner; reject join on a bookable training; sweep expires + promotes
  next.
- Contract: `createWaitlistEntrySchema` (rejects unknown fields); `waitlistEntrySchema` with
  `notifiedAt`.
- Bot: callback parse for `waitlist:join` / `waitlist:accept`; full-slot keyboard renders the join
  button.

## Dependencies

T1.8/T1.11 (bookings — capacity recompute + cancellation seam, both present), T2.2 (notifications —
present; extend with `waitlist-slot` message + inline-keyboard send).

## Open questions

- Confirmation window length. **Default: 30 minutes**, via `WAITLIST_WINDOW_MINUTES` (config).
- Sweep cadence. **Default: every 1 minute** (`@Cron`), so a 30-min window expires within ~1 min of
  the deadline.

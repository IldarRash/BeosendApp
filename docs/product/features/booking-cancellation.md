# T1.11 — Booking cancellation

**Goal.** Cancel a booking from the bot — one training, or a single date of a monthly group without
dropping the rest — freeing the seat and triggering waitlist logic.

**Spec refs.** ТЗ §11; UX §11.

**Contracts & tables.** `bookingSchema`; reads/writes `bookings` + `trainings` (+ `waitlist` via T2.1).

**API.** `apps/api/src/modules/bookings/`:
- `POST /bookings/:id/cancel` → in one transaction: set the booking `cancelled`, decrement the
  training's `booked_count`, recompute status (`full → open` if a seat freed). Then hand off to the
  waitlist promotion (T2.1) if anyone is waiting.

**Bot flow.** "📋 Мои записи" → "❌ Отменить" → "Вы уверены?" → "Да, отменить" → confirmation, with
🏐 Записаться снова / 📋 Мои записи / 🏠 Главное меню.

**Invariants.** Caller can cancel only their own booking. Cancelling one date of a group touches just
that booking (matched by id), leaving siblings sharing `group_subscription_id` intact. Seat freeing +
recompute are atomic and precede waitlist promotion.

**Acceptance criteria.**
- Cancelling frees exactly one seat; a `full` training flips back to `open` and reappears in slots.
- Cancelling one group date leaves the other dates of that subscription booked.
- A client cannot cancel someone else's booking.

**Tests.** Service: single cancel recompute, group single-date cancel keeps siblings, ownership check,
atomicity; waitlist promotion invoked when present.

**Dependencies.** T1.8 / T1.9; integrates with T2.1.

**Open questions.** Cancellation cutoff (e.g. no cancel within 3 h)? Default: none in MVP; add later if
the school requests it.

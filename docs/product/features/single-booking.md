# T1.8 — Single booking

**Goal.** Book one training: list → confirm → booked, with server-side capacity recompute and a clean
"full" path.

**Spec refs.** ТЗ §4.1, §8; UX §4–5.

**Contracts & tables.** `createSingleBookingSchema`, `bookingSchema` (`packages/types`);
`recomputeTrainingStatus` helper; `bookings` + `trainings` tables.

**API.** `apps/api/src/modules/bookings/`:
- `POST /bookings/single` → `{ clientId, trainingId }`. In one transaction: verify the training is
  `open` with free seats, insert a `booked` booking (`type=single`), increment `booked_count`, and
  recompute status. Reject (409) if full/cancelled or already booked by this client.

**Bot flow.** From the slot card → "Записаться" → confirmation card (date/level/trainer/free seats) →
"✅ Подтвердить запись" → success message with 📋 Мои записи / 🏐 Еще тренировки / 🏠 Главное меню.

**Invariants.** Booking acts only on the caller's own client (by `telegram_id`). No booking onto a
full/cancelled training. Capacity recompute + status flip are atomic. One active booking per client
per training.

**Acceptance criteria.**
- Booking decrements free seats; the 6th booking on a capacity-6 training flips it to `full` and it
  disappears from available slots.
- Booking a full training returns a typed conflict and the bot offers waitlist (T2.1).
- A client cannot double-book the same training.

**Tests.** Service: success recompute, full → conflict, duplicate → conflict, foreign client →
forbidden; transactional count integrity.

**Dependencies.** T1.5 (slots), T1.6 (client).

**Open questions.** None.

# T2.4 — Free-slot broadcasts

**Goal.** Let the manager compose and send a Telegram broadcast of free slots (today / tomorrow / week
/ freed-up), with an inline "Записаться" per slot.

**Spec refs.** ТЗ §12; UX §13.

**Contracts & tables.** `broadcastType`, `broadcastSchema` (`packages/types`); `broadcasts` table
(records send + recipient count for analytics).

**API.** `apps/api/src/modules/broadcasts/` (admin):
- `GET /broadcasts/preview?type` → the composed message text + the bookable slots it covers (reuses
  T1.5 availability).
- `POST /broadcasts/send` → `{ type }` sends to the target audience and logs a `broadcasts` row.

**Bot flow.** Manager picks a broadcast type → preview ("Свободные места сегодня: 18:00 Beginner — 2
места …") → send. Each slot line carries an inline "Записаться" that deep-links into the single-booking
flow (T1.8).

**Invariants.** Admin-only. Slots in the message are bookable at send time (status `open` + seats).
The inline book button funnels into the normal booking flow (which re-checks availability) — the
broadcast itself never books.

**Acceptance criteria.**
- "Today" broadcast lists exactly today's bookable slots with correct free counts.
- Tapping a slot's "Записаться" opens the confirmation for that training.
- A `broadcasts` row records type, recipient count, and time.

**Tests.** Service: slot selection per type, message formatting, audience count, admin gate. Bot:
inline-book deep link.

**Dependencies.** T1.5 (availability), T1.8 (booking).

**Open questions.** Audience for broadcasts. Default: all active clients (segmentation is T3.2).

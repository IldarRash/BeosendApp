# T1.10 — My bookings

**Goal.** Let a client see their upcoming trainings, future group bookings, and past trainings, with a
cancel action on future ones.

**Spec refs.** ТЗ §10; UX §10.

**Contracts & tables.** Reuse `bookingSchema` + a view contract (`myBookingItemSchema` with
training date/time/level/trainer + booking id/status). Reads `bookings` joined to `trainings`.

**API.** `apps/api/src/modules/bookings/`:
- `GET /bookings/mine?clientId&scope=upcoming|past` → enriched booking items, ordered.

**Bot flow.** "📋 Мои записи" → upcoming list, each with "❌ Отменить" (→ T1.11). Sections for
future-group and past. "⬅️ Назад".

**Invariants.** Returns only the caller's own bookings (by `telegram_id` → client). Cancel is offered
only for future, `booked` items. Past items show outcome (`attended`/`no_show`) when set.

**Acceptance criteria.**
- Upcoming and past are separated correctly relative to now.
- Each future booking exposes a cancel action; past ones don't.
- A client sees only their own bookings.

**Tests.** Service scoping (upcoming/past), ordering, ownership. Bot: list/keyboard render.

**Dependencies.** T1.8 / T1.9 (bookings exist).

**Open questions.** None.

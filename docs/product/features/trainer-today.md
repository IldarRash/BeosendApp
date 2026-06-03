# T2.3 — Trainer: today

**Goal.** A trainer sees their trainings for today with the roster and headcount, and can mark
attendance after the session.

**Spec refs.** ТЗ §13; UX §15.

**Contracts & tables.** Roster view contract (training + participants[]); reads `trainings` +
`bookings` + `clients`; updates `bookings.status` to `attended` / `no_show`.

**API.** `apps/api/src/modules/trainings/` (+ trainer guard):
- `GET /trainers/me/today?telegramId` → today's trainings for the trainer with headcount.
- `GET /trainings/:id/roster` (trainer/admin) → participant list.
- `POST /bookings/:id/attendance` (trainer/admin) → `{ status: attended|no_show }`.

**Bot flow.** "Мои тренировки сегодня" → list (time/level/headcount) → "Посмотреть список" → participant
names → mark присутствие / no-show.

**Invariants.** Trainer access is gated by matching `trainers.telegram_id`; a trainer sees only their
own trainings/rosters. Attendance is settable only on the trainer's own trainings and only for
today/past sessions.

**Acceptance criteria.**
- A trainer with a set `telegram_id` sees only their today trainings and rosters.
- Marking attended/no-show updates the booking and is reflected in analytics (T3.1).
- A non-trainer / other trainer is forbidden.

**Tests.** Service: today filter by trainer, roster ownership, attendance transition, authorization.

**Dependencies.** T1.2 (trainer `telegram_id`), T1.8/T1.9 (bookings).

**Open questions.** None.

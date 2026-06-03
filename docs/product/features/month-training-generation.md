# T1.4 — Month training generation

**Goal.** Generate concrete `trainings` for a group across a chosen month from its weekdays — the
automation the whole system rests on (15.1).

**Spec refs.** ТЗ §3.5, §15.1, §18.

**Contracts & tables.** `generateMonthSchema` (`packages/types`); `monthTrainingDates` helper
(already implemented + tested); `trainings` table.

**API.** `apps/api/src/modules/trainings/`:
- `POST /trainings/generate` (admin) → body `{ groupId, year, month }`. Creates one `open` training
  per matching date, copying capacity/trainer/times from the group. Idempotent: skips dates that
  already have a training for that group.
- `GET /trainings?from&to&groupId?` → trainings in a range (for admin views).

**Bot flow.** Triggered from A1 ("create schedule for month").

**Invariants.** Admin-only. Uses `monthTrainingDates(group.daysOfWeek, year, month)`. Re-running for
the same month must not duplicate trainings. Generated trainings start `open` with `booked_count = 0`.

**Acceptance criteria.**
- Generating Mon+Wed for June 2026 creates 9 trainings (5 Mondays + 4 Wednesdays).
- Re-running the same month adds none.
- Each training copies the group's capacity, trainer, and times.

**Tests.** Helper already covered; service: count for a known month, idempotency, field copy, non-admin
rejected.

**Dependencies.** T1.3 (groups).

**Open questions.** Past dates within the chosen month — skip or include? Default: skip dates before
today.

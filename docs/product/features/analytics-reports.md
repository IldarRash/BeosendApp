# T3.1 — Analytics & reports

**Goal.** Turn the captured data into the reports the spec lists: popular slots, average fill, trainer
load, cancellations, no-shows, client activity, and broadcast effectiveness.

**Spec refs.** ТЗ §17.

**Contracts & tables.** Report DTO contracts (`packages/types`); reads `bookings`, `trainings`,
`waitlist`, `broadcasts`, `notifications`, `clients`, `trainers`. No new write tables (the data is
already captured by Stages 1–2).

**API.** `apps/api/src/modules/analytics/` (admin), read-only aggregations:
- `GET /analytics/popular-slots`, `/fill-rate`, `/trainer-load`, `/cancellations`, `/no-shows`,
  `/client-activity`, `/broadcast-effectiveness`, each accepting a date range.

**Bot flow.** Surfaced to managers via A1 (summary messages) — full dashboards are out of scope here.

**Invariants.** Admin-only. Read-only — analytics never mutates domain state. Aggregations are derived
from authoritative tables (status fields, `booked_count`, attendance, send logs).

**Acceptance criteria.**
- Fill rate = booked/capacity averaged across trainings in range.
- Trainer load = sessions + participants per trainer in range.
- No-show / cancellation counts match the booking statuses.
- Broadcast effectiveness correlates `broadcasts` sends with subsequent bookings.

**Tests.** Service: each aggregation against a seeded fixture with known expected numbers; admin gate.

**Dependencies.** Stages 1–2 (the data sources).

**Open questions.** Broadcast→booking attribution window. Default: bookings within 24 h of a send.

# T1.3 — Groups management

**Goal.** Create and edit groups — the recurring slots (level, weekdays, time, trainer, capacity,
single + monthly RSD prices) that drive training generation.

**Spec refs.** ТЗ §3.4.

**Contracts & tables.** `groupSchema`, `createGroupSchema` (`packages/types`); `groups` table.

**API.** `apps/api/src/modules/groups/`:
- `GET /groups` → active groups (for the client "join a group" list, with seats remaining derived
  from upcoming trainings).
- `POST /groups` (admin), `PATCH /groups/:id` (admin) → create/edit incl. capacity & prices.

**Bot flow.** Client side consumes `GET /groups` in T1.9. Authoring is in A1.

**Invariants.** Admin-only writes. `daysOfWeek` uses ISO 1–7 (Mon–Sun). `endTime > startTime`.
Capacity > 0. Prices are integer RSD. Editing a group does **not** retroactively rewrite already
generated trainings (those carry their own capacity/trainer) unless explicitly regenerated.

**Acceptance criteria.**
- Admin creates "Intermediate, Mon+Wed, 20:00" with capacity and prices; it appears in `GET /groups`.
- Invalid times/empty weekdays/zero capacity are rejected with a typed error.
- Non-admin cannot create/edit.

**Tests.** Contract validation (times, weekdays, capacity, prices); service create/edit; non-admin
rejected.

**Dependencies.** T1.1 (levels), T1.2 (trainers).

**Open questions.** Does editing capacity propagate to future trainings? Default: no automatic
propagation; A1 offers an explicit "change capacity" action on a training.

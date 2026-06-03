# T1.2 — Trainers reference

**Goal.** Manage trainers (name, main/guest type), the pool groups and trainings reference.

**Spec refs.** ТЗ §3.3.

**Contracts & tables.** `trainerSchema`, `createTrainerSchema` (`packages/types`); `trainers` table
(`telegram_id?` enables the trainer UI in T2.3).

**API.** `apps/api/src/modules/trainers/`:
- `GET /trainers` → active trainers.
- `POST /trainers` (admin) → add (the spec requires adding new trainers).
- `PATCH /trainers/:id` (admin) → edit type/status/`telegram_id`.

**Bot flow.** Managed via the admin console (A1); referenced when creating groups and rendering slots.

**Invariants.** Admin-only writes. A trainer gains the trainer UI only once their `telegram_id` is set.

**Acceptance criteria.**
- Seeded trainers (Milena, Danilo) returned by `GET /trainers`.
- Admin can add a guest trainer; it appears in the list.
- Setting `telegram_id` later enables T2.3 for that trainer.

**Tests.** Service create/list/edit; type enum validation; non-admin rejected.

**Dependencies.** Foundation only.

**Open questions.** None.

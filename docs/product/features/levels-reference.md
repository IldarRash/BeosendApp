# T1.1 — Levels reference

**Goal.** Manage the level catalogue (Beginner/Intermediate/Advanced) used by clients and groups.

**Spec refs.** ТЗ §3.2.

**Contracts & tables.** `levelSchema`, `createLevelSchema` (`packages/types`); `levels` table
(already in schema + seed).

**API.** `apps/api/src/modules/levels/`:
- `GET /levels` → active levels (for onboarding + group creation).
- `POST /levels` (admin) → create. `PATCH /levels/:id` (admin) → rename / set status.

**Bot flow.** No standalone screen; levels feed onboarding (T1.6) and group creation (A1).

**Invariants.** Admin-only writes (`ADMIN_TELEGRAM_IDS`). Inactive levels are hidden from clients.

**Acceptance criteria.**
- Seeded levels are returned by `GET /levels`.
- Non-admin cannot create/modify a level.
- Inactive level is excluded from the client-facing list.

**Tests.** Service: create/list/deactivate; contract valid/invalid; non-admin rejected.

**Dependencies.** Foundation only.

**Open questions.** None.

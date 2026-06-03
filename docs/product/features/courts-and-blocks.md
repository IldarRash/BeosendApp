# C1 — Courts & blocks

**Goal.** Establish the court reference (6 courts) and the admin block mechanism the rest of Edition 2
builds on.

**Spec refs.** Edition 2 — general parameters.

**Contracts & tables.** `courtSchema`, `courtBlockSchema`, `createCourtBlockSchema`, and the court
constants (`COURT_COUNT`, `COURT_RATE_RSD_PER_HOUR`, open/close hours) — already in
`packages/types/src/court-contracts.ts`; `courts` + `court_blocks` tables (courts seeded 1–6).

**API.** `apps/api/src/modules/courts/`:
- `GET /courts` → active courts (admin/internal).
- block CRUD is implemented in C5; this feature provides the reference + read APIs.

**Bot flow.** None client-facing (clients never see courts). Used by C3/C4/C6.

**Invariants.** Exactly the active courts count as capacity for the per-hour limit. Clients never
receive court identities from these endpoints.

**Acceptance criteria.**
- Seed creates courts 1–6.
- `GET /courts` returns active courts and is not exposed to client flows.

**Tests.** Seed count; contract validation for blocks.

**Dependencies.** Foundation.

**Open questions.** Court working hours (07:00 vs 08:00 first slot). Default: 08:00–21:00, last start
20:00 (1 h) / 19:00 (2 h) — encoded in `court-contracts.ts`.

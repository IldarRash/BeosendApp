# C3 — Court availability (6-per-hour limit)

**Goal.** Enforce that no clock hour can have more confirmed bookings than there are courts, and hide
fully-booked hours from clients.

**Spec refs.** Edition 2 — "Важная логика": max 6 confirmed per hour.

**Contracts & tables.** `courtHoursCovered` helper; reads `courts`, `court_requests` (confirmed),
`court_blocks`.

**API.** `apps/api/src/modules/court-requests/`:
- `GET /court-requests/availability?date` → for each working hour, the number of free courts
  (`activeCourts − confirmedRequests − blocks`), so the client UI (C2) only offers available start
  times.
- The confirm path (C4) re-checks this in-transaction.

**Bot flow.** Drives the start-time choices in C2 — occupied hours are not offered.

**Invariants.** Free-courts-per-hour = active courts minus confirmed requests covering that hour minus
blocks covering it. A 2 h request needs both hours free. This is the single source of the limit;
confirmation cannot exceed it even under concurrency (checked inside the confirm transaction).

**Acceptance criteria.**
- With 6 courts, the 7th overlapping confirmation for an hour is impossible.
- An hour with 6 confirmed (or blocked) shows 0 free and is not offered.
- A 2 h slot is unavailable if either hour is full.

**Tests.** Helper covers hour coverage; service: free-count math with confirmed + blocks, 2 h spanning,
the 7th-confirmation rejection.

**Dependencies.** C1, C2; consumed by C4.

**Open questions.** None.

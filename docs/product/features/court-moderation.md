# C4 — Court moderation (admin)

**Goal.** Let the admin review a pending court request, see which courts are free that hour, and either
confirm with a court assignment or reject — notifying the client either way.

**Spec refs.** Edition 2 — admin interface.

**Contracts & tables.** `confirmCourtRequestSchema`; reads/writes `court_requests`, reads `courts`,
`court_blocks`.

**API.** `apps/api/src/modules/court-requests/` (admin):
- `GET /court-requests?status=pending` → queue.
- `GET /court-requests/:id/free-courts` → courts free for that request's hours (C3).
- `POST /court-requests/:id/confirm` → `{ courtId, decidedBy }`: in one transaction re-check the hour
  limit + that the chosen court is free, set `confirmed`, assign `court_id`, stamp `decided_*`, then
  notify the client with the court number.
- `POST /court-requests/:id/reject` → set `rejected`, notify "нет свободных мест, выберите другое
  время".

**Bot flow.** Admin sees a request (date/time/price) with [Подтвердить] → choose a free court button →
done; or [Отклонить]. Client receives the success ("Корт №X, итог: X RSD") or the rejection message.

**Invariants.** Admin-only. Court assignment is manual (admin picks the court). Confirmation re-checks
the 6-per-hour limit and the chosen court's freeness atomically; never over-assign. The client only
learns the court number on confirmation.

**Acceptance criteria.**
- Confirming assigns the chosen court, flips to `confirmed`, and notifies the client with that number.
- Rejecting notifies the client with the "choose another time" message.
- Confirming a court already taken that hour, or exceeding the limit, is rejected.

**Tests.** Service: confirm assigns + notifies, double-assign rejected, over-limit rejected, reject
notifies, admin gate.

**Dependencies.** C2, C3; notifications pattern from T2.2.

**Open questions.** None.

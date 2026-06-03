# C5 — Court manual block (admin)

**Goal.** Let the admin reserve a specific court for a time range (training, tournament, repair) so the
system treats it as unavailable.

**Spec refs.** Edition 2 — "Ручное бронирование сетки".

**Contracts & tables.** `createCourtBlockSchema`, `courtBlockSchema`; `court_blocks` table.

**API.** `apps/api/src/modules/courts/` (admin):
- `POST /court-blocks` → `{ courtId, date, startTime, endTime, reason }`.
- `GET /court-blocks?date` and `DELETE /court-blocks/:id`.

**Bot flow.** Admin chooses a court, date, time range, and reason; the block appears in the load grid
(C6) and reduces free courts in availability (C3).

**Invariants.** Admin-only. A block reduces the per-hour free-court count in C3 and prevents a
confirmation onto that court/hour in C4. Blocks may not overlap an existing confirmed request on the
same court (reject or warn).

**Acceptance criteria.**
- Blocking court 3 for 18:00–20:00 makes those hours show one fewer free court.
- C4 cannot assign court 3 during the block.
- Removing the block restores availability.

**Tests.** Service: block reduces free count, prevents assignment, overlap guard, admin gate.

**Dependencies.** C1; affects C3/C4.

**Open questions.** Allow blocking a whole day quickly? Default: single range per call; repeat for more.

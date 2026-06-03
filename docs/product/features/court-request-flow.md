# C2 — Court request flow (client)

**Goal.** Let a client request a court for a time: pick date → start time → duration (1 or 2 h), see an
RSD price preview, and submit a request that goes to the admin for approval.

**Spec refs.** Edition 2 — client interface.

**Contracts & tables.** `createCourtRequestSchema`, `courtRequestSchema`; `courtPriceRsd` /
`courtHoursCovered` helpers; `court_requests` table.

**API.** `apps/api/src/modules/court-requests/`:
- `POST /court-requests/preview` → `{ date, startTime, durationHours }` returns the RSD price and
  whether the hour is still available (C3) — no write.
- `POST /court-requests` → creates a `pending` request with the server-computed `price_rsd`.

**Bot flow.** Client picks date → start time (within working hours) → 1 ч / 2 ч → preview ("Дата:
15.06, Время: 14:00–16:00 (2 часа). Итого: 4 000 RSD") → "Отправить заявку" → "Заявка отправлена на
подтверждение администратору. Ожидайте уведомления с номером корта".

**Invariants.** Client never sees/chooses a court number. Price is computed server-side
(`courtPriceRsd`); the client-sent amount is ignored. Start time must be within working hours and leave
room for the duration before close. Requests start `pending`.

**Acceptance criteria.**
- 2 h preview shows 4 000 RSD; 1 h shows 2 000 RSD.
- Submitting creates a `pending` request with no `court_id`.
- A start time that overruns closing is rejected.

**Tests.** Service: price computation, working-hours validation, pending creation without court;
contract validation (duration ∈ {1,2}).

**Dependencies.** C1; availability check from C3.

**Open questions.** First slot 07:00 vs 08:00 — default 08:00 (see C1).

# T2.1 — Waitlist

**Goal.** When a training is full, let a client join a waitlist; on a cancellation, notify and promote
the head, falling through if they don't confirm in time.

**Spec refs.** ТЗ §9; UX §12.

**Contracts & tables.** `waitlistEntrySchema`, `waitlistStatus` (`packages/types`); `waitlist` table.

**API.** `apps/api/src/modules/waitlist/`:
- `POST /waitlist` → `{ clientId, trainingId }` appends at the next position (only if full).
- Internal `promoteNext(trainingId)` (called by cancellation T1.11): mark head `notified`, send the
  waitlist-slot notification (T2.2), and start a confirmation window.
- `POST /waitlist/:id/accept` → within the window, create a `booked` booking + recompute; mark
  `promoted`. On timeout → `expired`, promote the next.

**Bot flow.** Full slot → "Встать в лист ожидания". On promotion, the client gets a notification with
an inline "Подтвердить" valid for the window.

**Invariants.** Positions are contiguous per training. Only one entry per client per training.
Promotion respects order. Acceptance re-checks capacity atomically (a seat must still be free).

**Acceptance criteria.**
- Joining a full training records position N.
- A cancellation notifies position 1; accepting books them and frees the queue head.
- No response within the window expires the entry and notifies the next.

**Tests.** Service: append/position, promote order, accept books + recompute, timeout → next, one entry
per client.

**Dependencies.** T1.8/T1.11 (bookings), T2.2 (notifications).

**Open questions.** Confirmation window length. Default: 30 minutes (config).

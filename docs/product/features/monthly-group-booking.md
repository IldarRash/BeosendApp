# T1.9 — Monthly group booking

**Goal.** Book a client into a group for a whole month — one booking per training date, created as a
linked batch (15.3).

**Spec refs.** ТЗ §4.2, §15.3; UX §7–9.

**Contracts & tables.** `createGroupBookingSchema`, `bookingSchema` (`packages/types`); `bookings`
(shared `group_subscription_id`) + `trainings`.

**API.** `apps/api/src/modules/bookings/`:
- `POST /bookings/group` → `{ clientId, groupId, year, month }`. In one transaction: find the group's
  trainings in that month, create a `group`-type booking per training that has a free seat (sharing a
  new `group_subscription_id`), increment counts, recompute each status. Returns the created set and
  any skipped (full) dates.

**Bot flow.** "👥 Записаться в группу" → group list (seats remaining) → pick group → pick month →
confirmation ("Всего тренировок в месяце: N") → "✅ Подтвердить запись" → success.

**Invariants.** All bookings of one subscription share `group_subscription_id` so a single date can be
cancelled later (T1.11) without dropping the rest. Each training recomputes independently. Acts on the
caller's own client. Skips (doesn't fail) dates with no free seat; reports them.

**Acceptance criteria.**
- Booking a Mon+Wed group for a month creates a booking per generated date, all sharing one
  subscription id.
- A full date in the month is skipped and reported, not fatal.
- Counts/statuses recompute for every affected training.

**Tests.** Service: batch size matches month dates, shared subscription id, full-date skip, atomicity,
foreign client → forbidden.

**Dependencies.** T1.4 (generation), T1.3 (groups), T1.6 (client).

**Open questions.** Generate-on-demand if a month wasn't pre-generated? Default: require the month to
be generated (A1/T1.4) first; otherwise return a typed error.

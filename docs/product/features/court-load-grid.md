# C6 — Court load grid (admin)

**Goal.** Give the admin a per-day view of which courts are taken (by confirmed requests or blocks) and
which are free, so they can distribute players sensibly.

**Spec refs.** Edition 2 — "Просмотр загрузки".

**Contracts & tables.** A grid DTO (courts × working hours → free | request-id | block); reads
`courts`, `court_requests` (confirmed), `court_blocks`.

**API.** `apps/api/src/modules/courts/` (admin):
- `GET /courts/load?date` → for each court and each working hour, its state (free / occupied by a
  request / blocked).

**Bot flow.** Admin picks a date → a compact grid/text per court and hour (e.g. court rows, hour
columns), highlighting free vs occupied.

**Invariants.** Admin-only, read-only. Derived purely from confirmed requests + blocks; consistent with
C3's free-court math. Reflects the 08:00–21:00 working window.

**Acceptance criteria.**
- The grid shows every court across working hours for the chosen date.
- A confirmed request and a block both render as occupied on the right court/hours.
- Free cells match C3's availability for that date.

**Tests.** Service: grid composition for a fixture with one confirmed request + one block; consistency
with the C3 free-count.

**Dependencies.** C1, C3, C4, C5.

**Open questions.** Rendering format in Telegram (text grid vs generated image). Default: compact text
grid for MVP.

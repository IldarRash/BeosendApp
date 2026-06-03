# T1.5 — Available slots

**Goal.** Show clients only bookable trainings, each as a slot card (date, weekday, time, trainer,
level, free seats, price). This is the bot's headline feature (ТЗ §5).

**Spec refs.** ТЗ §5, §8; UX §3.

## Agreed implementation plan (planner)

**Smallest correct slice.** Client read-only path: `GET /trainings/available` → `SlotCard[]`, wired
into the bot `menu:available` handler as a list of slot-card buttons with a back/home footer. The
"Записаться" action is a no-op stub here (booking lands in T1.8); this slice only lists bookable
slots end-to-end.

### Module
`apps/api/src/modules/trainings/` (existing). No new module.

### Endpoint
- `GET /trainings/available?from?&to?&levelId?` → `SlotCard[]`.
  - Client-facing, NOT admin-gated. No `x-telegram-id` ownership check (the result is the same
    public catalogue for every client; it leaks no per-user data — no rosters, no other clients'
    bookings, no court numbers).
  - Defaults: `from` = today, `to` = today + 14 days (open question resolved: 14-day window).
  - Returns trainings that are **`isBookable`** (status `open` AND `freeSeats > 0`), whose
    `date >= today` (past excluded; if `from < today`, clamp to today), that have a `groupId`
    (a card needs level + single price, which live on the group; ad-hoc group-less trainings are
    excluded from the client catalogue), and whose group/level/trainer rows are `active`.
  - Ordered by `date ASC, startTime ASC`.
  - `levelId` optionally filters by the group's level.

### Contracts (packages/types/src/training-contracts.ts)
- **Reuse** `slotCardSchema` / `SlotCard` (already defined) and the `isBookable` / `freeSeats`
  helpers (already defined).
- **Add** `availableSlotsQuerySchema` (all fields optional): `{ from?: dateString, to?: dateString,
  levelId?: uuid }`, plus `type AvailableSlotsQuery = z.infer<...>`. Export from index (covered by
  `export *`).
- No DB schema change. No new entity fields. Money (`priceSingleRsd`) and free seats are computed
  server-side and only displayed by the bot.

### Helper (packages/types/src/helpers.ts)
- **Add** a pure, exported `isoWeekdayOf(isoDate: string): DayOfWeek` (the existing `isoWeekday`
  takes a `Date` and is module-private). The service uses it to fill `slotCard.dayOfWeek` from the
  training date. Unit-tested in `helpers.spec.ts`.

### Repository (trainings.repository.ts)
- **Add** `listAvailable(from, to, levelId?)`: single query joining
  `trainings → groups → trainers → levels`, filtering `trainings.date BETWEEN from AND to`,
  `trainings.status = 'open'`, `trainings.bookedCount < trainings.capacity`,
  `trainings.groupId IS NOT NULL`, group/trainer/level `status = 'active'`, optional
  `groups.levelId = levelId`; ordered by date then startTime. Returns rows carrying
  `trainingId, date, startTime, endTime, trainerName, levelName, capacity, bookedCount, status,
  priceSingleRsd`. Time columns normalized `HH:MM:SS` → `HH:MM` as in `toTraining`. No business
  rules in the repo.

### Service (trainings.service.ts)
- **Add** `listAvailable(query: AvailableSlotsQuery): Promise<SlotCard[]>` (no actor — public read).
  - Resolve window: `from = max(query.from ?? today, today)`, `to = query.to ?? today + 14d`;
    reject `to < from` with `BadRequestException`.
  - Defence in depth: even though the SQL filters, re-assert `isBookable({capacity, bookedCount,
    status})` per row before mapping (the `open`/`full` + free-seats invariant lives in the
    service, not only in SQL).
  - Map each row to a `SlotCard`: `freeSeats(...)` for seats, `isoWeekdayOf(date)` for weekday,
    `priceSingleRsd` straight from the group. Validate the array against `z.array(slotCardSchema)`
    before returning so the bot only ever receives contract-valid cards.

### Controller (trainings.controller.ts)
- **Add** `@Get("available")` — thin: Zod-validate the query with `availableSlotsQuerySchema`, call
  `trainings.listAvailable(query)`, return. Place its route so `available` is not shadowed by the
  bare `@Get()` admin list (distinct static path segment, no conflict).

### Bot (apps/bot)
- **ApiClient** (`api-client.ts`): add `listAvailableSlots(query?: { from?; to?; levelId? }):
  Promise<SlotCard[]>` validating the response with `z.array(slotCardSchema)`. No auth header needed.
- **navigation.ts**: replace the `MENU_ACTIONS.availableTrainings` stub with a real handler that
  calls `api.listAvailableSlots()`, renders each card as a line (weekday, date, time, trainer,
  level, free seats, RSD price — all from the API; no math in the bot) plus a per-slot button, and
  the `backHomeKeyboard()` footer. Empty list → friendly "нет доступных тренировок" + footer.
- **Callback action**: add a namespaced constant `book:start:<trainingId>` for the per-slot
  "Записаться" button (handled in T1.8; here it may answer with a "скоро" placeholder). Keep
  callback_data ≤ 64 bytes (a single UUID fits).
- The handler signature currently passes only `(ctx, deps)`; thread the `ApiClient` to this handler
  (extend `MenuHandlerDeps` with `api` or pass `api` through the dispatch) without changing other
  handlers' behavior.

### Invariants (this feature)
- **Only `isBookable` slots are ever returned** — `status === 'open'` AND `freeSeats > 0`. A full or
  cancelled or completed training never appears; freeing a seat (booking cancel → recompute in
  T1.8) makes it reappear. This is the single load-bearing invariant.
- Free seats and price are server-computed; the bot only displays them. Past trainings excluded.

### Unsafe / forbidden path (must be rejected)
- A `full` (or `cancelled`/`completed`, or `open`-but-zero-free-seats) training **must not** appear
  in `GET /trainings/available`. Test that a training at capacity is absent and that flipping one
  seat free brings it back. (Also: group-less ad-hoc trainings and inactive-group trainings are
  excluded.)

### Acceptance criteria
- A full training does not appear; freeing a seat makes it appear again.
- Cards show correct free seats, trainer, level, single price (RSD), weekday derived from the date.
- Past trainings (and those outside the window) are excluded; results ordered by date then time.
- `to < from` → 400.

### Tests
- `helpers.spec.ts`: `isoWeekdayOf` for known dates (incl. Sunday → 7).
- `training-contracts.spec.ts`: `availableSlotsQuerySchema` accepts empty/partial, rejects bad
  date/uuid.
- `trainings.service.spec.ts`: filters out non-`open` and zero-seat rows; excludes past; window
  defaulting and `to<from` rejection; correct `SlotCard` mapping and ordering (repo mocked).
- Bot: card/keyboard render for a sample `SlotCard[]` and the empty-list case.

### Dependencies
- T1.4 (trainings exist), T1.7 (menu). Booking action itself is T1.8.

**Open questions.** Default window length — **resolved: next 14 days** (overridable via `from`/`to`).

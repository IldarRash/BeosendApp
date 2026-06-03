# C3 — Court availability (6-per-hour limit)

**Goal.** Enforce that no clock hour can have more confirmed bookings than there are active courts,
and expose per-hour free-court counts so clients are only offered start times that can actually be
confirmed. This is the single source of the limit; C4 (confirm) reuses the same computation inside
its transaction.

**Spec refs.** Edition 2 — "Важная логика": max 6 confirmed per hour.

## Slice scope (smallest correct vertical slice)

Read-only availability for one date, plus the reusable per-hour free-court computation. This is the
foundation C2 (client request flow) consumes for start-time choices and C4 (admin confirm) re-checks
in-transaction. The confirm/write path itself is C4 and is out of scope here.

## Contracts & tables

All needed contracts and tables already exist — **no schema change, no new DB field**.

- Reuse `packages/types/src/helpers.ts` → `courtHoursCovered(startTime, durationHours)` for the hours
  a request/block covers.
- Reuse `packages/types/src/court-contracts.ts` constants `COURT_OPEN_HOUR` (8), `COURT_CLOSE_HOUR`
  (21), `courtDurationHours`, `courtRequestStatus`.
- Reads `courts` (active), `court_requests` (status `confirmed`), `court_blocks`. All three tables
  already exist in `packages/db/src/schema.ts`.

### New contracts to add to `packages/types/src/court-contracts.ts`

Only the availability response/request shapes (none exist yet):

- `courtAvailabilityQuerySchema = z.object({ date: dateString })`
- `hourAvailabilitySchema = z.object({ hour: z.number().int(), startTime: timeString, freeCourts: z.number().int().nonnegative() })`
- `courtAvailabilitySchema = z.object({ date: dateString, hours: z.array(hourAvailabilitySchema) })`
  with inferred type `CourtAvailability`.

Export these from `packages/types/src/index.ts` (already `export *`s court-contracts, so just adding
to the file is enough).

### Pure helper to add to `packages/types/src/helpers.ts`

Add `freeCourtsByHour` so the per-hour math is unit-testable without Nest/DB and is shared by the
availability read (C3) and the confirm re-check (C4):

```
freeCourtsByHour(input: {
  activeCourtCount: number;
  openHour: number;        // COURT_OPEN_HOUR
  closeHour: number;       // COURT_CLOSE_HOUR
  confirmed: { startTime: string; durationHours: CourtDurationHours }[];
  blocks:    { startTime: string; durationHours: CourtDurationHours }[];
}): Map<number, number>    // hour → free courts (>= 0)
```

Implementation: for each working hour `h` in `[openHour, closeHour)`, free = `activeCourtCount` minus
the number of confirmed requests whose `courtHoursCovered` includes `h`, minus the number of blocks
covering `h`, floored at 0. (Blocks are stored with `startTime`/`endTime`; the repo derives
`durationHours` from the time span, or the helper takes a `coveredHours` set directly — pick the
former so the helper stays pure and reuses `courtHoursCovered`.)

A duration's availability is `min` of `freeCourtsByHour` over the hours it covers; a 2 h slot is
unavailable if either hour is full. This `min`-over-covered-hours rule lives in the service when
building `hours[]` start-time offers, and is the rule C4 re-checks.

## API

Module `apps/api/src/modules/court-requests/` (one module per domain). Standard
controller → service → repository layering.

- `GET /court-requests/availability?date=YYYY-MM-DD`
  - Controller: Zod-validate the query with `courtAvailabilityQuerySchema`; call one service method;
    return the `courtAvailabilitySchema`-validated result.
  - Service `getAvailability(date)`: load active court count, confirmed requests for the date, blocks
    for the date; call `freeCourtsByHour`; for each working hour where `freeCourts > 0` and the slot
    can still finish before `COURT_CLOSE_HOUR`, emit an `{ hour, startTime, freeCourts }` entry.
    Money is not involved here.
  - Repository: the only DB access. Add the read methods (`countActiveCourts()`,
    `confirmedRequestsForDate(date)`, `blocksForDate(date)`). Re-export any missing Drizzle operators
    (`and`, `gte`, `lt`, `inArray`) from `packages/db/src/index.ts` so apps/api goes through
    `@beosand/db` only.
  - **Confirm path (C4) re-uses `freeCourtsByHour` inside its transaction** — C3 must not duplicate
    the limit logic anywhere else.

Wiring: register `CourtRequestsModule` in `apps/api/src/app.module.ts`. (Note: `app.module.ts`
currently imports a `CourtsModule` that does not yet exist on disk — that is C1's module. C3 adds
`CourtRequestsModule`; if `CourtsModule` is still missing when C3 lands, the brief's dependency on C1
is the blocker to flag.)

## Bot flow

C3 is consumed by C2's start-time selection — it does not add a new top-level menu entry itself.
Needed plumbing in `apps/bot`:

- `ApiClient.getCourtAvailability(date: string): Promise<CourtAvailability>` — GET the endpoint,
  parse the response with `courtAvailabilitySchema` before returning.
- C2's court-request handler renders only the returned `hours[]` as start-time buttons (occupied
  hours are absent), namespaced callback data (e.g. `court:time:<HH:MM>`); the bot does no
  availability math and never shows a court number.

## Invariants

**The single most important invariant:** free-courts-per-hour = active courts − confirmed requests
covering that hour − blocks covering that hour, and confirmation can never exceed it for any
overlapping hour (the 7th confirmation for a 6-court hour is impossible). A 2 h request needs both
covered hours free. C3 is the read side; the rule is enforced authoritatively in C4 inside the
confirm transaction using the same `freeCourtsByHour` helper.

## Unsafe / forbidden path

A confirm that would push any overlapping hour above the active-court count must be rejected
(`ConflictException`) — including the 7th confirmation for a full hour and a 2 h slot where only one
of the two hours has capacity. The availability read must also never include such hours, and must
never expose court numbers. (The reject is enforced in C4 but the C3 helper + repo reads are what it
relies on; C3's tests cover the math, C4's cover the in-transaction reject.)

## Acceptance criteria

- With 6 active courts, the 7th overlapping confirmation for an hour is impossible (helper returns 0
  free for that hour; confirm rejects).
- An hour with 6 confirmed (or covered by blocks) shows `freeCourts = 0` and is not offered.
- A 2 h slot is unavailable if either covered hour is full.
- The availability response never includes a court id/number.

## Tests

- `packages/types/src/helpers.spec.ts`: `freeCourtsByHour` — base count, confirmed reducing a single
  hour, a 2 h confirmed reducing both covered hours, blocks reducing an hour, floor at 0, and the
  `min`-over-covered-hours rule for a 2 h offer.
- `apps/api` court-requests service spec: `getAvailability` builds correct free counts from confirmed
  + blocks, drops fully-booked hours, drops 2 h start times whose second hour is full, and excludes
  late start times that would run past `COURT_CLOSE_HOUR`.

## Dependencies

C1 (courts module / seed of 6 courts), C2 (client request flow that consumes the start times).
Consumed by C4 (admin confirm re-checks the same helper in-transaction). Blocker to flag if the C1
`CourtsModule` referenced by `app.module.ts` is still absent when C3 is implemented.

## Open questions

None. Defaults recorded: working hours from `COURT_OPEN_HOUR`/`COURT_CLOSE_HOUR`; blocks reduce
availability the same way confirmed requests do; only `confirmed` requests count against capacity
(`pending` does not reserve a court).

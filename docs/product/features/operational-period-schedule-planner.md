# Operational-period schedule planner

## Goal

Replace the admin planner's calendar-month boundary with one server-owned operational period whose inclusive start and end dates drive display, recurrence materialization, conflict evaluation, and generation. Preserve the existing approve/generate/publish lifecycle while making school days off and overlap with earlier plans explicit before repeated generation.

## Spec refs

- Factory workflow `beosand-period-planner-20260828`, revision 5, and its author decisions for a four-week default, editable boundaries, a maximum inclusive length of 84 calendar days, inclusive-length navigation, days off, and visible partial/full overlap.
- `docs/product/features/monthly-schedule-planner.md`: implemented lifecycle, diagnostics, hidden generation, publication, propagation, visibility, and notification invariants remain the baseline except where this brief replaces the month boundary.
- `docs/architecture/overview.md`: API owns validation, date math, transactions, availability, and notifications; clients render validated shared contracts.
- `docs/architecture/domain-model.md`: groups remain recurring intent, trainings concrete dated instances, and generated group trainings retain linked court blocks.
- `docs/architecture/database.md`: dates and clock times remain separate Postgres values; availability derives from courts, requests, blocks, and trainings.
- `apps/admin/PRODUCT.md` and `apps/admin/DESIGN.md`: the planner is a dense, accessible operations workspace exposing server provenance without deriving domain state in React.
- Current anchors: `packages/types/src/monthly-schedule-contracts.ts`, `monthly_schedule_*`, `trainings.monthly_schedule_entry_id`, `apps/api/src/modules/monthly-schedule`, `apps/admin/src/api/client.ts`, `apps/admin/src/hooks/useMonthlySchedulePlan.ts`, and `apps/admin/src/pages/SchedulePlanner.tsx`.
- The tree has no `docs/product/feature-roadmap.md`; this follow-up is scoped against the implemented planner and clean `feature/backfill-published-monthly-plans` baseline at `a1d032e`.

## Smallest correct slice

1. Migrate each monthly plan to the exact inclusive first/last dates of its stored Belgrade year/month and make dates the only domain key used by new reads/writes.
2. Add plan-scoped day-off dates, overlap summaries/read-only overlap entries, period-aware materialization and diagnostics, and explicit overlap acknowledgement on generation.
3. Replace month/year controls and the month grid with start/end controls, inclusive-length previous/next navigation, day-off marking, and non-color-only overlap presentation.
4. Keep approval, hidden generation, publication, propagation, notifications, client visibility, and legacy non-planner training-generation APIs behaviorally unchanged.

Do not combine this with cancellation/deletion of existing trainings, lifecycle redesign, or a general calendar refactor outside the planner.

## Contracts & tables

### Shared contracts

Evolve `packages/types/src/monthly-schedule-contracts.ts` so planner shapes no longer accept or expose `year/month` as period identity:

- Add strict `operationalPeriodSchema` with ISO `startDate/endDate`, `endDate >= startDate`, and an inclusive length from 1 through 84 calendar days. Both dates are inclusive; an 85-day or longer period is invalid.
- Change create/query inputs to that shape. Initial admin selection is Belgrade today through today plus 27 calendar days; server validates every submitted boundary.
- Replace plan `year/month` with `startDate/endDate`; timezone remains `Europe/Belgrade`. Equal boundaries and valid periods with zero entries are valid.
- Add strict `updateMonthlySchedulePeriodSchema` for atomic boundary change.
- Add `schedulePlanDayOffSchema` (`id`, `planId`, `date`) and strict mark/unmark validation. A marker is planning intent, not training status.
- Add `schedulePlanOverlapSchema` with other plan ID, boundaries, status, inclusive intersection, and summary counts; add a read-only overlap-entry projection sufficient to render prior plan data without presenting it as current-plan data.
- Extend the plan view with `daysOff`, `overlaps`, `overlapEntries`, and server-decided `hasOverlap`. Day-off and overlap can coexist and neither replaces the other.
- Add diagnostic codes `plan-overlap`, `overlap-acknowledgement-required`, and `day-off`. These are informational/warning facts; `existing-training-collision` stays blocking.
- Add strict generation input `{ acknowledgedOverlapPlanIds: uuid[], overlapFingerprint: string | null }`. The fingerprint is derived from the sorted current overlap IDs, revisions, and boundaries; both the IDs and fingerprint are compared with a fresh server read at generation time.
- Change delivery audit shapes from copied `year/month` to `periodStart/periodEnd`.
- Add pure helpers for inclusive date enumeration, recurrence within valid boundaries, inclusive length, and shifting by that length. Use ISO calendar-date arithmetic independent of local time so DST cannot add/drop/repeat dates. Every helper that materializes planner dates must either receive previously validated boundaries or reject a length above 84 rather than partially enumerate it. Keep generic month helpers for non-planner consumers.

Prefer neutral exported names for touched contracts. Current `MonthlySchedule*` names may remain as deprecated aliases over one schema family during cutover.

### Tables and migration

- Alter `monthly_schedule_plans` in place: add/backfill non-null `start_date/end_date`, add `CHECK (end_date >= start_date)`, exact-pair uniqueness, and intersection index; then drop unique `(year,month)` and old columns. Distinct unequal plans may overlap.
- Add `monthly_schedule_plan_days_off`: UUID PK, cascading plan FK, calendar date, audit timestamps, unique `(plan_id,date)`; mark/unmark is idempotent.
- Boundary edits before generation atomically rematerialize entries. Stored day-off rows outside the changed range are inert; display/generation intersects markers with the current range.
- Preserve entry UUIDs and `trainings.monthly_schedule_entry_id`; never recreate generated trainings/court blocks during migration.
- Replace delivery `year/month` with backfilled `period_start/period_end`.
- Retain physical `monthly_schedule_*` names and the training provenance column in this smallest slice to avoid identity-only migration. No code may infer month behavior from those names.

No booking, waitlist, payment, group, training, or court-block domain field change is required.

## API

Keep admin-only `/monthly-schedule-plans` for compatibility while replacing month coordinates:

| Method and path | Request | Response and behavior |
| --- | --- | --- |
| `GET /monthly-schedule-plans?startDate=&endDate=` | strict period | Exact-range plan or `null`; view includes every other intersecting plan and read-only overlap entries. |
| `POST /monthly-schedule-plans` | `{ startDate, endDate }` | Idempotently create/return exact range. A different overlapping range creates a distinct draft with overlap facts. |
| `PATCH /monthly-schedule-plans/:id/period` | period | Before generation: change boundaries, rematerialize, increment revision, return fresh overlap/day-off facts. |
| `PUT /monthly-schedule-plans/:id/days-off/:date` | none | Idempotently mark and remove/rematerialize ungenerated intent for that date; real trainings stay untouched. |
| `DELETE /monthly-schedule-plans/:id/days-off/:date` | none | Idempotently unmark/rematerialize ungenerated intent; never restores/cancels/deletes a real training. |
| Existing template endpoints | existing inputs | Materialize only inside boundaries, excluding in-range day-offs. |
| `POST /monthly-schedule-plans/:id/generate` | acknowledgement IDs plus fingerprint | Lock/re-read plan, overlaps, dates, resources. Incomplete/stale acknowledgement returns validated `409`; otherwise current atomic hidden generation applies. |
| Existing approve/publish/delivery endpoints | existing inputs | Preserve behavior over valid 1..84-day boundaries; responses use period fields. |

- `400` rejects malformed/nonexistent dates, reversed ranges, and inclusive lengths of 85 days or more before plan lookup, creation, rematerialization, conflict evaluation, or generation. One-day and zero-entry valid periods are allowed, and an invalid request has no partial effects.
- Existing `403`, `404`, resource `409`, locking, idempotency, and complete diagnostics remain.
- Exact create-or-get is concurrency-safe via unique pair; overlapping unequal ranges are allowed.
- Inclusive overlap is `other.start_date <= current.end_date AND other.end_date >= current.start_date`, excluding current plan.
- Create, boundary update, and generation share one stable planner-range transaction lock before plan-row locks, so unequal intersecting ranges cannot race the acknowledgement check. Acknowledgement never downgrades collision/resource diagnostics; changed overlap membership, revision, or boundaries require renewed acknowledgement.
- Day-off writes after generation may change the marker but never existing trainings; only not-yet-run generation observes it.
- Boundaries are immutable after `generatedAt`, preserving generated membership/history.

## Admin flow

The `/schedule-planner` route remains. Exact copy/style belong to `ui-designer`:

1. Default to Belgrade today through today plus 27 days; show both dates and inclusive length across month/year.
2. Either boundary is editable before generation within a 1..84-day inclusive period. Reversal or a resulting 85-day-or-longer range shows a clear shared/API error without losing the last valid view or partially planning dates.
3. Previous/next shifts both boundaries by inclusive current length, without month snapping or millisecond math.
4. Render every inclusive date, including partial weeks/cross-year spans. Zero-entry ranges keep controls usable with explicit empty state.
5. Mark/unmark visible day off with text/icon plus color. Overlap may coexist; current-plan generation omits date; copy says existing trainings are unchanged.
6. Show partial/full overlap at range and date level, naming other periods/intersections. Prior entries are distinct, read-only, inspectable, and never replaced.
7. Generation confirmation names acknowledged plans and explains collisions still block. Stale overlap retains context and requires refreshed acknowledgement.
8. Preserve template editing, conflict inspection, action sequence, and loading/pending/error/offline/refetch behavior. React renders server truth.

Keyboard/focus, screen-reader labels, reduced motion, responsive safety, RU/SR/EN copy, and non-color-only statuses remain required.

## Bot flow

No bot command or interactive bot flow is added.

- Bot/Mini App/client reads still exclude hidden trainings.
- A day-off marker is never a client cancellation and emits no cancellation/publication/broadcast/reminder/booking event.
- Published trainings enter existing client flows unchanged.
- Propagation notifications use period boundaries in admin audit data; recipient behavior/privacy otherwise stays unchanged.

## Invariants

### Period/date math

- Server-valid Belgrade calendar dates are inclusive and ordered.
- Inclusive length is always between 1 and 84 calendar days. Contract/controller validation rejects 85+ before repository mutation, materialization, conflict queries, or generation so an oversized request has no partial effects.
- Default is 28 inclusive dates; navigation preserves count through month/year ends, leap days, and DST.
- Materialization, diagnostics, locks, publication reads, and summaries share exact boundaries; no planner code reconstructs a month.
- Plans may have zero templates/entries. Approval may still require content; viewing/editing valid empty ranges is allowed.

### Days off

- At most one marker per plan/date; day-off and overlap are independent.
- Only in-range markers affect materialization/generation; outside-range markers are inert.
- Mark/unmark never mutates an existing training/court block.

### Overlap/lifecycle

- One plan per exact pair; unequal plans may overlap.
- Return every intersection without merging/hiding/overwriting/transferring prior entries; overlap entries are read-only provenance.
- Overlap is not blocking, but generation requires acknowledgement of current complete set and never bypasses collisions.
- Existing lifecycle, revisions, hidden generation, publication, idempotency, propagation, history, and notifications remain.
- Generated plan boundaries are immutable in this slice; schedule-field propagation remains supported.

## Acceptance criteria

- Initial planner shows 28 inclusive days beginning on Belgrade today.
- Either boundary changes before generation across month/year while the resulting inclusive range remains at most 84 days; all display/domain operations use the range.
- Reversal and 85+ inclusive days reject clearly with no plan, entry, day-off, conflict, or training mutation; one-day and zero-occurrence valid ranges render.
- An exactly 84-day period can be planned and generated, subject to existing lifecycle, acknowledgement, and resource checks.
- Previous/next shifts by inclusive length through leap day and Belgrade DST.
- In-range day-offs visibly generate no new training; outside-range markers suppress nothing.
- Marking a date with real training leaves training/block unchanged and communicates non-cancellation.
- Partial overlap, containment, and simultaneous day-off+overlap are separately visible.
- Prior entries remain inspectable/distinct and are never hidden/replaced.
- Generation fails until current overlaps are acknowledged; collisions still atomically block afterward.
- Migrated plans retain entry/training provenance and lifecycle/visibility/notification behavior.
- Non-admin access remains forbidden, clients see no planner-only data, and admin parses shared contracts.

## Tests

- **Contracts/helpers:** invalid/reversed/equal dates, default 28, inclusive lengths 1/28/84 accepted and 85 rejected, inclusive recurrence, cross-month/year/leap day, Belgrade DST, navigation preserving each selected valid length.
- **Migration/DB:** exact backfill, UUID preservation, exact uniqueness, allowed overlap, check, day-off uniqueness, delivery backfill, rollback.
- **Repository/service:** intersection/containment, create race, rematerialization, empty range, exact 84-day range, in/out day-offs, simultaneous states, stale/incomplete/complete acknowledgement, blocking collision, locks, and proof that 85+ never reaches repository/materialization/conflict/generation work.
- **Unsafe paths:** non-admin writes; generated boundary edit; reversed or 85+ range; oversized create/update/generate causing any partial plan/entry/training effects; generation on day off; day-off mutating real training/block; acknowledgement bypass; client leakage.
- **Lifecycle:** action order, hidden generation, eligible publication, double submit, propagation, history, notification dedupe, legacy compatibility.
- **Admin:** controls, cross-year grid, shift, empty state, toggle, overlap variants, simultaneous markers, prior entries, stale refresh, state retention, a11y, narrow viewport, parse errors.
- **Runtime:** seeded local rows only; inspect linked DB state. Do not publish real user-facing trainings without just-in-time authorization.

Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, including `@beosand/admin`.

## Risks

- Variable-span calendars, recurrence materialization, overlap projections, and diagnostics grow with period length. The hard 84-day inclusive contract is the protection boundary: validate it before reads or writes, keep queries bounded to the validated dates, and test response/render density at exactly 84 days.
- Frontend-only length checks can drift or be bypassed. Shared contracts and API validation are authoritative; the admin check is immediate feedback only.
- A boundary edit can cross from valid to oversized. Treat the submitted pair atomically and retain the last valid plan view; never clamp to 84, truncate entries, or apply only one boundary.

## Dependencies

- Implemented monthly planner and hidden-training provenance/visibility.
- `packages/db/drizzle/0035_backfill_published_monthly_plans.sql` / `a1d032e` precedes this migration so published trainings have provenance.
- Reuse existing availability, working hours, conflicts, history preservation, publication events, and outbox.
- No external provider, bot command, pricing rule, or production-data action.

## Decisions & assumptions

### Author decisions

- Default four weeks; either boundary may be any valid date provided the inclusive period is 1..84 calendar days; range drives display/generation; navigation shifts by and preserves that valid inclusive length.
- Exactly 84 days is allowed. An 85-day or longer request is rejected clearly before planning or generation with no partial effects.
- Day-offs skip new generation without cancelling/removing existing trainings.
- Partial/full overlap is visible with message and never hides/replaces prior data.
- Empty valid ranges, simultaneous states, overlap warning, and DST-safe math are required.

### Safe implementation assumptions

- Initial four weeks begins on Belgrade today, matching the current-window default.
- Day-offs are plan-scoped because this slice does not establish school-wide closure/cancellation.
- Boundaries lock after generation to preserve current membership/cardinality and avoid invented booking/payment/cancellation behavior.
- Existing route/table/module names may remain for compatibility; dates alone define behavior.
- `ui-designer` owns copy/treatment; semantic states, acknowledgement, and accessibility are fixed.

## Selected-role handoff

- `architect` next: migration/backfill/rollback, uniqueness/overlap locks, rematerialization transaction, DST-safe 1..84 validation boundary, bounded query/materialization shape, acknowledgement race, aliases/cutover, and history proof.
- `backend-implementer`: contracts/helpers, schema/migration, repository/service/controller, delivery audit fields; contracts/migration first.
- `ui-designer`: range workspace, up-to-84-day calendar, clear oversized-range error, day-off/overlap language, provenance, acknowledgement, accessibility/responsiveness.
- `frontend-implementer`: typed client/hooks/page after contracts/design; React computes no domain state.
- `test-writer`: focused date/migration/API concurrency/lifecycle/admin/visibility/forbidden-path coverage.
- `reviewer`: boundary consistency, preservation, acknowledgement/no replacement, history, and removal of month-derived behavior.
- `security-reviewer`: authorization, visibility, resource integrity, booking/payment history.
- `app-runner`: seeded authenticated admin/API/DB checks and full gates without production publication.
- `github-bot` and `deployer` only on root request; this brief authorizes no public/production action.

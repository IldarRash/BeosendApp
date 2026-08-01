# Unified Mini App "My records"

## Goal

Expand the Mini App `Мои записи` screen so its existing Upcoming and Past tabs show the caller's
group bookings and active waitlist, confirmed individual trainings, and court-rental history. The API
owns identity, status/date classification, and display-safe rental data; the Mini App only validates,
localizes, and renders the typed result.

The smallest end-to-end slice preserves `GET /bookings/mine`, `GET /waitlist/mine`, and the existing
calendar-oriented `GET /court-requests/mine`, then adds a separate scope-aware court-request history
read for `Мои записи`. This avoids widening the calendar feed to cancelled rows or changing any
availability/occupancy behavior.

## Spec refs

- Workflow `beosand-my-records-unified-20260801`, revision 2: approved scope and author decisions.
- `docs/architecture/overview.md`: the API is the domain source of truth; UI clients parse shared Zod
  contracts and do not compute availability, money, or domain status.
- `docs/architecture/domain-model.md`: individual confirmation produces a training; court requests
  carry date/time, duration, requested court count, price, status, and court assignments.
- `docs/architecture/database.md`: individual confirmation creates the final training; pending and
  confirmed court requests affect availability, while terminal request history remains persisted.
- Current product behavior in `MyBookingsScreen` / `MyBookingsView`: Upcoming/Past tabs, training
  detail navigation, subscription grouping, standalone bookings, and active waitlist rendering.

This checkout has no `docs/product/feature-roadmap.md` or separate product spec. The approved workflow
package, architecture documents, shared contracts, and current implementation are therefore the
authoritative evidence for this brief.

## Contracts & tables

### Shared contracts

- In `packages/types/src/training-contracts.ts`, extend `myBookingItemSchema` with a server-derived
  `trainingKind: "group" | "individual"`. Keep `trainingContextLabel` for group names and existing
  consumers, but do not require the Mini App to infer an individual training from the English literal
  `"Individual"`.
- In `packages/types/src/court-contracts.ts`, add a strict history query contract with
  `scope: "upcoming" | "past"`. The history response remains an array of
  `myCourtRequestItemSchema`, which already carries `id`, `date`, `startTime`, `endTime`,
  `durationHours`, `priceRsd`, `status`, `courtCount`, and display court numbers.
- Keep all response parsing in the Mini App ApiClient. Do not introduce frontend-only duplicates of
  booking, scope, court-request, or status types.

### Existing tables read

- `bookings`, `trainings`, `groups`, `trainers`, and `levels` for group and confirmed-individual
  booking rows.
- `waitlist` and existing joined training/group data for active caller waitlist rows.
- `court_requests`, `court_request_courts`, `courts`, and `clients` for caller-owned rental history.

No schema edit or migration is required. Do not change price snapshots, capacity counters, court
holds, court blocks, availability reads, or financial recomputation.

## API

### Existing reads retained

- `GET /bookings/mine?clientId=<uuid>&scope=upcoming|past`
  - Preserve its response and ownership rules, with the additive `trainingKind` field.
  - A confirmed individual request is represented only by its existing owner booking. Do not query or
    merge `individual_training_requests`, so pending/declined requests cannot appear and the confirmed
    training cannot be duplicated.
  - Derive `trainingKind` from authoritative training relations: an owner-linked, groupless training
    is `individual`; a group-linked training is `group`.
- `GET /waitlist/mine`
  - Preserve current active-waitlist semantics and Upcoming-only subscription/standalone rendering.
- `GET /court-requests/mine`
  - Preserve this endpoint as the calendar feed. It continues excluding cancelled requests and keeps
    its current redaction/availability semantics.

### New history read

- `GET /court-requests/mine/history?scope=upcoming|past`
  - Authentication: resolve the actor exclusively from the verified client Telegram header/session,
    then resolve the active `clients.id` server-side. The request accepts no `clientId`, Telegram id,
    price, or court identity from the caller.
  - Response: `MyCourtRequestItem[]`, validated by the shared schema.
  - Upcoming classification: only `pending` or `confirmed` rows whose `date >= today`.
  - Past classification: `pending` or `confirmed` rows whose `date < today`, plus every `rejected` or
    `cancelled` row regardless of its date.
  - Ordering: Upcoming ascending by date/start time; Past descending by date/start time, with a stable
    id tie-breaker if needed.
  - Use the same server-side `today` boundary as `GET /bookings/mine` so one tab cannot classify
    trainings and rentals against different dates.
  - Return only rows for the resolved caller. Court display uses the request's retained
    `courtNumbers` when available and always includes `courtCount`; the Mini App falls back to a
    localized court-count label for legacy or rejected rows whose released court join is empty.

The history repository method must be separate from the current calendar repository read. Adding
cancelled rows to the calendar query, or reusing history output for calendar occupancy/availability,
is forbidden.

## Bot / Mini App flow

The Telegram bot is unchanged.

Mini App flow (two to three taps):

1. Open `Мои записи`; Upcoming is selected by default and loads bookings, active waitlist, and the
   Upcoming rental-history scope.
2. Tap Past to load past bookings and the Past rental-history scope, including all rejected and
   cancelled rentals.
3. Tap a training booking, including an individual one, to open the existing training detail. Rental
   cards are read-only and have no detail navigation, cancel, reschedule, or edit action.

Keep the current subscription card grouping and standalone waitlist section. Add rental cards to the
same tab body without converting rental rows into training rows. Each rental card shows localized
date/time, court number(s) or court count fallback, formatted RSD price, and a localized status for
`pending`, `confirmed`, `rejected`, or `cancelled`. Individual booking cards use `trainingKind` to show
a localized individual-training label and still open the existing training detail.

Loading, error, and empty state are tab-wide:

- While required booking or rental data for the active tab is unresolved, show the existing loading
  treatment rather than a false empty state.
- A required booking/rental request or contract failure shows the localized error state. The active
  waitlist remains supplementary as today: its failure must not hide otherwise valid records.
- Upcoming is empty only when bookings, active waitlist, and Upcoming rentals are all empty. Past is
  empty only when both past bookings and Past rentals are empty.

## Invariants

- **Caller ownership:** both booking and rental reads resolve/recheck the authenticated caller at the
  API boundary. No client-supplied id may widen the result.
- **One confirmed individual record:** the owner booking is the only projection. Individual request
  history is out of scope and never merged.
- **Backend classification:** date/status membership and ordering are API decisions. The Mini App must
  not reclassify rejected/cancelled future rentals or use local time to choose a tab.
- **Calendar/history isolation:** `GET /court-requests/mine` stays calendar-specific and excludes
  cancelled rows. The new history read may include terminal rows but must never feed availability,
  grid, load, or court-hold calculations.
- **Availability integrity:** only existing pending/confirmed request occupancy affects availability.
  This slice performs no court-request mutation and no recompute.
- **Money integrity:** render the stored server-provided `priceRsd`; do not recalculate rental price in
  the Mini App.
- **Thin UI:** Mini App logic may select localized copy and presentation only. Training kind, rental
  status, ownership, temporal scope, court count/numbers, and price come from validated API data.
- **Existing booking behavior:** group/subscription grouping, active waitlist, training navigation,
  booking cancellation from training detail, and query invalidation remain unchanged.

## Acceptance criteria

- Upcoming shows existing group bookings, confirmed individual owner bookings, active waitlist, and
  caller-owned pending/confirmed rentals dated today or later.
- Past shows existing past bookings, caller-owned past pending/confirmed rentals, and every
  caller-owned rejected/cancelled rental even when its date is today or in the future.
- A confirmed individual request appears exactly once, with a localized individual type label, and
  opens the existing training detail. Pending or declined individual requests never appear.
- Each rental card shows localized date/time, court number(s) or a court-count fallback, formatted
  stored price, and localized status. It exposes no training-detail navigation or mutation control.
- Switching Upcoming/Past requests the matching server scope; the Mini App does not move records
  between tabs itself.
- Subscription grouping, booked dates, waitlisted dates, standalone bookings, standalone waitlist,
  training detail, and booking cancellation continue to behave as before.
- Empty, loading, and error states account for both bookings and rentals and do not report empty while
  either required source is unresolved.
- A caller cannot retrieve another client's bookings or rental history by changing a query, header
  fallback, cached client id, or response shape.
- Existing calendar views receive the same `GET /court-requests/mine` semantics as before: cancelled
  history does not reappear and no terminal request changes availability.
- No database migration, financial recomputation, capacity recomputation, or court-availability rule
  changes land with this slice.

## Tests

### Shared contracts

- `myBookingItemSchema` accepts only `group|individual` for `trainingKind` and rejects missing/unknown
  values; update all typed fixtures that parse this shared contract, including bot fixtures.
- The rental-history query accepts only `upcoming|past`, rejects extra fields, and preserves all four
  court-request statuses in the response contract.

### API

- Booking service/repository tests derive `group` and `individual` correctly; confirmed individual
  owner booking returns once and no individual request row is read/merged.
- Rental history Upcoming includes today/future pending/confirmed and excludes past or terminal rows.
- Rental history Past includes past pending/confirmed and all rejected/cancelled regardless of date;
  ordering is deterministic.
- Controller/service tests prove actor resolution, no accepted client id, owner-only repository scope,
  403 for an unregistered caller, and contract-valid court count/numbers/price/status output.
- Repository tests prove the history predicate includes cancelled rows only on the history path while
  the existing calendar predicate still excludes cancelled rows.
- Regression tests prove cancelled/rejected history never participates in request-hold occupancy,
  client grid, free-court, availability, or load reads.

### Mini App

- ApiClient/hook tests call the new history endpoint with the selected scope and reject malformed
  responses.
- Flow/render tests cover a mixed Upcoming tab, a mixed Past tab, a localized individual label with
  existing detail navigation, and read-only rental cards for every status.
- Preserve subscription plus waitlist grouping tests and prove an individual record is not duplicated.
- Cover court-number rendering and the court-count fallback when `courtNumbers` is empty.
- Cover combined empty, loading, booking-error, rental-error, and supplementary waitlist-error states.
- Verify rental cards have no cancel/reschedule/edit control and clicking them does not open training
  detail.

Run the repository definition of done after focused tests:
`pnpm typecheck && pnpm lint && pnpm test && pnpm build`, including `@beosand/admin`, then verify the
Mini App screen against a running API with representative rows in both tabs. If runtime data cannot be
prepared without mutating shared state, report the exact blocker and use fixture-backed UI verification.

## Dependencies

- Existing Mini App onboarding/session identity resolution and typed ApiClient.
- Existing `GET /bookings/mine`, `GET /waitlist/mine`, `GET /court-requests/mine`, and
  `GET /trainings/:id/client-detail` behavior.
- Existing individual-request confirmation invariant that creates exactly one owner booking.
- Existing court-request persistence, retained cancellation rows, court join data, and RSD price.
- Existing RU/SR/EN Mini App catalogs and My Bookings card/state primitives.

No dependency exists on a migration, client rental mutation flow, request-history UI outside
`Мои записи`, calendar redesign, or any availability/pricing change.

## Decisions & assumptions

- **Individual scope:** only confirmed individual trainings are shown, through the existing owner
  booking; pending/declined request history is excluded. Approved by the author.
- **Rental scope:** all statuses are shown. Pending/confirmed use the date boundary; rejected/cancelled
  always belong to Past. Approved by the author.
- **Rental interaction:** cards are read-only, with no client cancellation, reschedule, edit, or
  training navigation. Approved by the author.
- **Preservation:** current group, subscription, waitlist, training-detail, and booking-cancel behavior
  remains. Approved by the author.
- **Endpoint isolation:** a dedicated rental-history read is safer and smaller than widening the
  calendar feed or replacing the bot-consumed bookings response with a cross-domain union. Supported
  by current consumers and the explicit calendar/history isolation constraint.
- **Court display:** show retained display numbers when the API has them; otherwise show the request's
  authoritative court count. This is required because rejected requests release their court joins and
  legacy requests may legitimately have no numbers.
- **Date boundary:** use the same backend `today` convention already used by My Bookings. A timezone
  policy change is outside this slice; the implementation must at least share one boundary across both
  record types.
- **Visual scope:** reuse the established My Bookings list/card/state design. No broader Mini App or
  calendar redesign is required.

## Selected-role handoff

1. `backend-implementer`: own shared contracts plus `apps/api` booking-kind projection and the isolated
   court-request history endpoint/repository path. Do not change schema, availability, or money logic.
2. `frontend-implementer`: own Mini App ApiClient/hooks, localized rental/individual presentation, and
   combined tab states while preserving training detail and subscription/waitlist behavior.
3. `test-writer`: add focused shared-contract, backend ownership/classification/isolation, and Mini App
   regression coverage alongside implementation.
4. `security-reviewer`: verify identity cannot be spoofed, terminal history cannot affect availability,
   and no mutation or cross-client data is exposed.
5. `reviewer`: check contract compatibility (including bot fixtures), no duplicates, classification,
   localization, empty/loading/error behavior, and scope cleanliness.
6. `app-runner`: run focused and repository-wide checks and perform Mini App/API verification without
   mutating shared production state.

No bot implementer, database migration owner, UI designer, GitHub role, or deployer is required by the
approved implementation scope unless a later global workflow handoff explicitly adds that work.

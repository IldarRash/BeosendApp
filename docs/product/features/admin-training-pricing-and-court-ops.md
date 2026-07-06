# Feature: Admin training pricing and court operations

## Goal

Give admins clearer court operations and configurable monthly training pricing: court blocks show
their stored reason in admin court views, confirmed court-rental requests can be reassigned to a
different free court set, and subscription/payment rows show API-computed per-booking price snapshots
with an explanation.

This is a planning brief only. Should the full agent flow be run for this feature after user review?
No implementation-plan approval is implied until the user explicitly says to proceed.

## Spec refs

- Recovered request: show stored court-block reason, allow admin court reassignment for court rental
  requests/bookings, and add editable monthly training pricing tiers.
- `docs/product/feature-roadmap.md`: shipped admin subscriptions, court rental moderation, court
  blocks, court load views, and generated training/payment status domains.
- `docs/admin-guide.md`: admin console renders API state; money, court availability, statuses, and
  notifications are server-owned.
- `docs/architecture/overview.md`: API owns prices, payment status, court availability, and domain
  decisions; admin renders validated Zod contracts.
- `docs/architecture/domain-model.md`: `CourtBlock`, `CourtRequest`, `CourtRequestCourt`, `Group`,
  `Training`, `Booking`, and `Waitlist`.
- `docs/architecture/database.md`: `court_blocks.reason` already exists; court availability derives
  from active courts, court blocks, generated group-training blocks, and pending/confirmed request
  holds.
- Adjacent briefs:
  - `docs/product/features/admin-court-cancel-bookable-subscription-months.md`
  - `docs/product/features/miniapp-training-detail-calendar-export-admin-courts.md`
  - `docs/product/features/miniapp-court-booking-grid.md`

## Contracts & tables

- `packages/types/src/court-contracts.ts`
  - Reuse `courtBlockSchema.reason`; extend `courtLoadCellSchema` or add a matching admin detail
    contract so `block`/`training` cells can display the stored `court_blocks.reason` without client
    paths ever exposing reasons.
  - Add `reassignCourtRequestSchema`: `{ courtIds: uuid[] }`, strict, min 1, max `COURT_COUNT`.
  - Reuse `courtRequestSchema`, `courtRequestAdminViewSchema`, and `courtRequestStatus`.
- `packages/types/src/training-contracts.ts`
  - Replace or extend `subscriptionSummarySchema` with pricing explanation fields:
    `monthlyPricingCountContext`, `storedBookingPricesRsd`, `totalRsd`, `pricingScope`, and
    `pricingBreakdown`.
  - Add booking-level pricing explanation fields where subscription rows expose booking details:
    `bookingOrdinalInMonth`, `pricingTierId`, `pricingTierLabel`, `pricingTierRange`,
    `priceSnapshotRsd`, and `pricingSnapshotSource`.
  - Add `trainingPricingTierSchema`, `createTrainingPricingTierSchema`,
    `updateTrainingPricingTierSchema`, `trainingPricingTiersSchema`, and a small validation result
    contract if the API needs to return overlap/gap errors.
- `packages/db/src/schema.ts`
  - Reuse: `court_blocks.reason`, `court_requests`, `court_request_courts`, `courts`, `bookings`,
    `trainings`, `groups`, and `waitlist`.
  - Add `training_pricing_tiers`:
    `id`, `label`, `min_trainings`, `max_trainings` nullable for open-ended upper bound,
    `price_per_training_rsd`, `sort_order`, `status`, `created_at`, `updated_at`.
  - Add per-booking price snapshot columns to `bookings` by default:
    stored price in RSD, tier id/label/range used at booking time, booking ordinal in the client's
    calendar month, and snapshot timestamp/source. Use a separate ledger table only if architecture
    finds an existing audit pattern that makes it necessary.
  - Keep `groups.priceMonthRsd` for legacy group metadata and old screens, but monthly subscription
    totals in `/subscriptions` no longer use it as the primary pricing source.

## API

- `GET /courts/load?date=YYYY-MM-DD`
  - Response remains `courtLoadGridSchema` or a compatible extension.
  - Admin-only block/training cells include enough server-owned detail to show `court_blocks.reason`.
    Client court grid contracts stay redacted and must not expose reasons.
- `GET /court-blocks?...`
  - Existing admin list already returns `CourtBlock.reason`; Court Blocks page remains the canonical
    table view for block reasons.
- `PATCH /court-requests/:id/courts`
  - Admin-only via `x-telegram-id`.
  - Body: `reassignCourtRequestSchema`.
  - Response: `courtRequestAdminViewSchema`.
  - Behavior: lock the request and date, require the supported status scope, require exactly
    `courtCount` active court ids, recheck every selected court over every covered slot against manual
    blocks, training auto-blocks, and other pending/confirmed court requests while excluding the
    request's own current join rows, then replace `court_request_courts` atomically.
- `GET /training-pricing-tiers`
  - Admin-only.
  - Response: `trainingPricingTiersSchema`, sorted by `minTrainings`.
- `PUT /training-pricing-tiers`
  - Admin-only full replacement for the active tier set, or equivalent validated batch update.
  - Body: ordered non-overlapping tiers. Default seed matches:
    1-3 trainings: 1500 RSD, 4-7: 1400 RSD, 8-11: 1300 RSD, 12+: 1200 RSD.
  - Behavior: validate positive integer ranges/prices, no overlaps, no gaps from 1 upward, at most one
    open-ended tier, and persist in one transaction.
- Booking creation APIs, including monthly multi-date booking creation
  - Existing endpoint shapes stay unless architecture finds a required response extension.
  - Behavior: when an accepted group subscription booking is created, promoted, or confirmed as
    `booked`, count how many pricing-counted group-training bookings the client already has in the
    same calendar month across all groups/trainings, then assign the next ordinal's tier price as an
    immutable booking snapshot regardless of `paymentStatus`.
  - Multi-date monthly booking operations assign snapshots sequentially by training date from
    `existingMonthlyPricingCount + 1`; only accepted booking dates receive prices. Waitlist-only,
    `pending`, cancelled, and no-show dates are not priced until they become `booked`.
- `GET /subscriptions`
  - Existing filters stay.
  - Response rows include API-owned pricing explanations based on stored booking price snapshots.
    `totalRsd` is the sum of stored prices for pricing-counted bookings in the selected
    subscription/month, not a recalculation from the current tier table and not gated by
    `paymentStatus`.
  - Explanation fields show why for each priced booking: monthly ordinal, tier range/label, stored
    price, monthly count context, and excluded waitlisted, pending, cancelled, and no-show items.
- `PATCH /subscriptions/:id/paid`
  - Existing behavior stays: mark every non-cancelled booking in that subscription batch paid/unpaid.
    Returned summary uses the new tier pricing fields, but `paymentStatus` affects only debt/payment
    tracking and never changes pricing-tier counts.

## Bot flow

- No new Telegram bot UI in this slice.
- Bot booking/subscription flows keep calling existing booking APIs. They do not compute tier prices.
- If bot client-facing payment copy later needs the same owed amount, it must call an API read using
  the same pricing helper instead of duplicating tier logic.

## Admin flow

- Court Load: block/training cells expose the stored reason in a compact detail/tooltip/drawer. Manual
  blocks show the admin-entered reason; generated group-training blocks show the stored generator
  reason.
- Court Requests: confirmed request rows get a "Change courts" action. The dialog preselects the
  currently assigned courts, lists active courts, enforces exactly `courtCount` selections in the UI,
  and submits `PATCH /court-requests/:id/courts`; the API remains authoritative.
- Pricing tiers: admins can view and edit monthly training pricing ranges and per-training prices in
  a dedicated settings area or subscriptions-adjacent panel.
- Subscriptions/payments: each person row shows the pricing-counted booking count for that calendar
  month, stored booking prices, total owed, waitlisted count, paid count, and a short "why" breakdown
  with booking ordinal, tier range/label, and monthly count context.

## Invariants

- API remains the only source of truth for money, court availability, court request decisions, and
  payment state. Admin renders values and sends typed mutations only.
- Pricing scope is fixed by user choice: count all of a client's trainings in the calendar month
  across all groups/trainings, not within one group.
- Pricing-tier count is independent of `paymentStatus`: admins do not need to mark a training paid
  for it to count toward pricing ranges. `paymentStatus` remains only for debt/payment tracking,
  including payment state and paid count.
- Pricing-counted bookings are group-training bookings with a `groupSubscriptionId` whose
  participation status is `booked` or `attended`. `cancelled`, `no_show`, `waitlist`, and `pending`
  do not count; default `pending` is not counted until it becomes `booked`.
- A booking enters the pricing count when the client is signed up/booked. It leaves the pricing count
  only when participation status becomes `cancelled`, `no_show`, or `waitlist`; completed/attended
  bookings continue to count within the month for later bookings.
- Pricing is marginal and snapshot-based: the price for a new booking is determined from the
  client's existing pricing-counted booking count in that calendar month plus the new accepted
  booking's ordinal. Example: if the client already has 3 pricing-counted July bookings, the next
  booking is #4 and uses the 4-7 tier price; if they already have 7, the next booking is #8 and uses
  the 8-11 tier price.
- Existing booking price snapshots are immutable in this slice. Editable tier changes affect future
  bookings only; `/subscriptions` must not retroactively change old booking totals when tier settings
  are edited.
- For multi-date monthly booking creation in one operation, accepted dates receive prices
  sequentially by date from the existing monthly pricing count. Waitlist-only, `pending`, cancelled,
  and no-show dates are not charged until they become `booked`.
- Tier ranges are whole-training counts and prices are whole RSD integers.
- Court request reassignment is atomic and availability-checked with the same pending/confirmed hold
  and block rules as request creation/confirmation.
- Client-facing court paths stay redacted: no block reasons, court ids, request ids, training ids, or
  private client data are returned to Mini App court grids.
- `groups.priceMonthRsd` must not be used by the new `/subscriptions` total unless a legacy fallback
  is explicitly needed and labeled.

## Acceptance criteria

- Admin Court Load or block detail shows the stored `court_blocks.reason` for occupied block/training
  cells without exposing reasons on Mini App court grid responses.
- Admin can open a confirmed court request, change its assigned courts, save, and see the request row
  and court load update to the new court set.
- Reassigning a court request to inactive, wrong-count, occupied, or invalid courts returns a typed
  error and leaves existing join rows unchanged.
- Admin can edit pricing tiers matching the example ranges and persist them.
- Tier validation rejects gaps, overlaps, negative/zero prices, non-integer bounds, duplicate open
  tiers, and a first range that does not start at 1.
- A new single-date booking gets its stored price from the next monthly ordinal across all the
  client's pricing-counted group-training bookings, for example 3 existing July bookings -> new
  booking #4 -> 4-7 tier -> 1400 RSD.
- A new multi-date monthly booking assigns stored prices sequentially by accepted training date, for
  example 7 existing July bookings -> first accepted date #8 at 1300 RSD, later accepted dates use
  their corresponding ordinals.
- Waitlist-only, `pending`, cancelled, and no-show dates do not receive owed booking prices until
  they become `booked`.
- `booked` and `attended` bookings count toward later monthly tier ordinals whether paid or unpaid.
- `/subscriptions` totals sum stored price snapshots for pricing-counted bookings and do not
  recalculate old rows when pricing tiers change later.
- Marking bookings paid/unpaid changes debt/payment tracking only and does not change pricing
  counts, ordinals, or stored price snapshots.
- Subscription rows show the stored per-booking explanation, for example "July booking #8 -> 8-11
  tier -> 1300 RSD".
- Mark-paid/unpaid still updates the existing non-cancelled bookings in the selected subscription
  batch and returns summaries with the new pricing fields.

## Tests

- Contract tests:
  - `reassignCourtRequestSchema` accepts valid court id arrays and rejects empty, oversized, malformed,
    or extra-field bodies.
  - Pricing tier schemas accept the default tiers and reject invalid ranges/prices.
  - `subscriptionSummarySchema` parses the new pricing explanation fields and rejects malformed money
    or unknown scope values.
- API court tests:
  - Court Load/admin block response includes `reason`; Mini App client grid remains redacted.
  - Court request reassignment enforces admin auth, status scope, exact `courtCount`, active courts,
    conflict checks, self-exclusion, date lock, and atomic unchanged-on-error behavior.
- API pricing/subscription tests:
  - Tier replacement validates gaps/overlaps/open-ended bounds transactionally.
  - Monthly count spans multiple groups for the same client and calendar month.
  - Pricing count ignores `paymentStatus`: unpaid `booked` rows count, and marking paid/unpaid does
    not change pricing ordinals or totals.
  - `booked` and `attended` count; `cancelled`, `no_show`, `waitlist`, and `pending` do not count by
    default.
  - Single booking creation snapshots the next ordinal's tier price: 3 existing -> #4 at 1400 RSD,
    7 existing -> #8 at 1300 RSD.
  - Multi-date monthly booking creation snapshots prices sequentially by accepted training date.
  - Cancelled, no-show, waitlist-only, and pending rows do not receive owed prices by default and do
    not change future ordinals until accepted as `booked`.
  - Boundary ordinals pick the expected tiers: 1-3, 4, 7, 8, 11, and 12+.
  - Editing tiers affects future booking snapshots only and does not change existing subscription
    totals.
  - `totalRsd` is the sum of stored booking price snapshots, not `groups.priceMonthRsd` and not
    `pricingCountedBookingCount * currentTierPrice`.
  - Mark-paid/unpaid preserves payment-state behavior while returning new pricing fields.
- Admin tests:
  - Court Load/details render block reason.
  - Court request change-courts dialog preselects current courts, enforces selection count, handles
    success and API conflict errors, and invalidates court request/load queries.
  - Pricing tier editor renders, validates local obvious errors, submits typed payload, and displays
    API validation errors.
  - Subscriptions page renders stored per-booking prices, total, tier labels/ranges, ordinals, and
    explanations.
- Review/run checks:
  - Full implementation gate remains `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
  - App runner verifies court reason display, request reassignment conflict, tier edit, and
    subscription pricing explanation in the running admin app against the API.

## Dependencies

- Existing court-request moderation module and admin CourtRequests page.
- Existing `court_blocks.reason`, Court Blocks page, and Court Load grid.
- Existing `ReassignCourtDialog` can inform UI behavior but currently targets `court_blocks`; court
  request reassignment needs its own mutation because it writes `court_request_courts`.
- Existing subscriptions module, `booking.paymentStatus`, `bookings.groupSubscriptionId`, and admin
  Subscriptions page.
- Existing typed API clients and shared Zod contract export pattern.
- DB migration tooling for the new pricing tier table and seed/default rows.
- Booking creation and waitlist-promotion paths must share the same pricing snapshot helper so a
  waitlisted or pending date receives its price only when it becomes `booked`.

## Open questions with defaults

- Court-request reassignment status scope: default to confirmed requests only. Pending requests are
  still handled by existing confirmation court selection; rejected/cancelled requests remain history.
- Reserve / non-permanent-group / pay-per-time identification: default to no special category field in
  this slice. The 1-3 tier covers the 1500 RSD pay-per-training behavior until the product defines
  explicit client/group permanence flags.
- Pricing editor location: default to a subscriptions-adjacent admin panel to keep money operations
  discoverable without adding a new top-level route.
- Pricing history: default to per-booking snapshots in this slice. Existing booking price snapshots
  are not retroactively changed when editable tier ranges/prices are updated.
- Pending status treatment: default `pending` is not pricing-counted and receives no price snapshot
  until it becomes `booked`; architecture may only change this if existing code proves `pending`
  already means accepted participation.
- Snapshot persistence shape: default to columns on `bookings` for the smallest correct slice; move
  to a separate ledger table only if architecture finds a concrete audit/history requirement.
- Existing `groups.priceMonthRsd`: default keep the field for group setup/backward compatibility but
  label monthly subscription totals as tier-priced by the API.

## Proposed full agent-flow subtasks

- `analyst`: validate admin user flows, edge cases, acceptance criteria, status-scope risks, and tier
  pricing behavior using this brief plus existing court/subscription screens.
- `architect`: finalize contracts, new table/migration shape, pricing helper boundaries, court
  reassignment transaction design, API endpoints, and role split.
- `backend-implementer`: add shared contracts, DB schema/migration/seed for tiers, pricing service
  logic, subscription response changes, court-load reason response if needed, and court-request
  reassignment endpoint with transaction/conflict checks.
- `ui-designer` / `frontend-implementer`: design and wire the admin Court Load reason display, Court
  Requests change-courts dialog, pricing tier editor, and Subscriptions pricing explanation using
  typed ApiClient calls and existing design system components.
- `test-writer`: add the contract, API, admin component, and invariant tests listed above.
- `reviewer`: review correctness, contract reuse, migration clarity, API ownership of money and
  availability, and UI/domain separation.
- `security-reviewer`: review admin authz, court availability integrity, pricing validation, payment
  mutation integrity, and client-path data leakage.
- `app-runner`: boot API/admin/DB and verify the admin flows end to end; document any precise blocker.
- `github-bot`: after user approval, create the GitHub issue/worktree before implementation and open
  the PR/cleanup after verification.

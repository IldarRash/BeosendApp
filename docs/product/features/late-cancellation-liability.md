# Group-training late-cancellation liability

## Goal

Allow a client to cancel their own future group-training booking even inside a manager-configured global late-cancellation window. The cancellation frees the seat immediately, but a financially chargeable cancellation requires an explicit full-liability warning and confirmation in both the Telegram bot and Mini App, creates an immutable liability record, and durably notifies the assigned coach.

The policy is initially disabled. This slice includes the admin policy control and an auditable liability list with client, training, cancellation time, amount, and payment state. It does not deploy the change or mutate live financial data.

## Spec refs and current evidence

- `docs/product/feature-roadmap.md` is absent at planning time, so there is no roadmap row to cite.
- Source requirements are the Factory ready package for configurable global `N` hours, continued self-cancellation, full-financial-responsibility confirmation, coach notification, and admin liability operations.
- Architecture: [overview](../../architecture/overview.md), [domain model](../../architecture/domain-model.md), and [database](../../architecture/database.md).
- Existing cancellation source: `apps/api/src/modules/bookings/bookings.service.ts`, `bookings.repository.ts`, and `bookings.controller.ts`.
- Existing monthly pricing/payment source: `apps/api/src/modules/training-pricing/*`, `apps/api/src/modules/subscriptions/*`, and immutable booking fields in `packages/db/src/schema.ts`.
- Existing durable notification source: `apps/api/src/modules/record-status/*`. Its staff-audience snapshots, known-failure retries, and terminal `ambiguous` outcome are suitable for the coach message.
- Existing confirmation surfaces: `apps/bot/src/my-bookings.ts` and `apps/miniapp/src/ui/CancelSheet.tsx`.

## Smallest correct slice

1. Persist and expose one disabled-by-default global policy.
2. Add an authoritative cancellation preview and confirmation token.
3. In the existing cancellation transaction, recompute eligibility, create at most one immutable liability, cancel the booking, free capacity, preserve monthly billing, and enqueue client and coach notification intents.
4. Render the warning/confirmation in bot and Mini App.
5. Add an admin policy editor and liability ledger. Standalone payment can be updated there; subscription payment continues to use the subscription batch as its source of truth.

Only authenticated owner self-cancellation of a future group-training booking is in scope. Staff cancellation, trainer decline, transfer, group/training cancellation, individual training, court rental, waitlist removal, and no-show handling do not create this liability.

## Contracts & tables

### Shared contracts

Add `packages/types/src/late-cancellation-contracts.ts` and export it from `packages/types/src/index.ts`.

- `lateCancellationPolicySchema`
  - `enabled: boolean`
  - `hours: integer | null`, with a bounded positive range such as `1..168`; `enabled` requires non-null `hours`
  - `version: positive integer`
  - `effectiveFrom: datetime | null`
  - `updatedAt: datetime | null`
  - `updatedBy: integer | null`
- `updateLateCancellationPolicySchema`
  - strict `{ enabled, hours }`; disabling may retain no active threshold and returns `hours: null`
- `bookingCancellationPreviewSchema`, discriminated by `kind`
  - common: `bookingId`, `trainingId`, `trainingStartsAt`, `cancellable`, and server-renderable training/client context
  - `ordinary`: no financial liability and no token
  - `liable`: `policyHours`, `cutoffAt`, `amountRsd`, `billingKind: "single" | "subscription"`, `paymentStatus: "unpaid" | "paid"`, `confirmationToken`, and token expiry
  - `waived`: late by time but no enforceable amount, with machine reason `missing-monthly-price-snapshot`; no token and no liability row
- Extend `cancelBookingSchema` with optional `lateCancellationConfirmationToken: string`. Staff `reason` remains compatible. Client code sends the token only after displaying the `liable` preview.
- `bookingCancellationResultSchema`: `{ booking, liability: lateCancellationLiabilitySchema.nullable() }`. Bot, Mini App, and API clients must migrate together from the current bare `Booking` response.
- `lateCancellationLiabilitySchema`
  - identifiers: `id`, `bookingId`, `clientId`, `trainingId`, `groupSubscriptionId`
  - display snapshots: `clientName`, training/group label, date/start/end, coach name
  - audit: `cancelledAt`, `confirmedAt`, `policyHours`, `policyVersion`, `cutoffAt`
  - money: `amountRsd`, `amountSource: "monthly-booking-snapshot" | "group-single-price"`, `billingKind`
  - payment is projected from the linked booking: `paymentStatus`, `paidAt`, `paidBy`
- `listLateCancellationLiabilitiesQuerySchema`: optional payment state, billing kind, client id, date range, offset, and bounded limit.
- `lateCancellationLiabilitiesPageSchema`: rows, total, `hasMore`, and next offset.
- `markStandaloneLateCancellationPaidSchema`: strict `{ paid: boolean }`.
- Extend `clientRecordSchema` with nullable `lateCancellationLiability` containing liability id, amount, and payment status. The cancellation status snapshot and client Telegram message must state that the seat was cancelled and full financial liability was recorded.

Errors must be typed, not inferred from free text. At minimum expose `LATE_CANCELLATION_CONFIRMATION_REQUIRED` as HTTP 409 with a fresh `liable` preview, and ordinary authorization/not-found/not-cancellable errors without leaking another client's booking.

### Persistence

Use the existing `app_settings` singleton key `group_training_late_cancellation_policy_v1`. Store the validated policy value with a monotonic version and activation time; update it under a row lock. Missing or malformed legacy data fails closed to disabled.

Add `late_cancellation_liabilities` in `packages/db/src/schema.ts` plus a generated migration:

- immutable FKs: `booking_id` unique, `client_id`, `training_id`, nullable `group_subscription_id`, and `trainer_id`;
- immutable snapshots: client name, training/group label, training date/start/end, coach name;
- `cancelled_at`, `confirmed_at`, `policy_hours`, `policy_version`, and `cutoff_at`;
- positive integer `amount_rsd` and `amount_source`;
- `billing_kind` (`single` or `subscription`);
- `created_at`.

The unique `booking_id` is the idempotency boundary. Liability facts and amount never change. Payment state is not duplicated in this table: it is read from the linked booking's existing `payment_status`, `paid_at`, and `paid_by` fields.

Add indexes for `(cancelled_at desc)`, `(client_id, cancelled_at desc)`, `(payment status through the booking join as supported by query shape)`, and `group_subscription_id`. Add positive checks for amount, policy hours, and version.

Do not backfill liabilities. Existing cancelled rows remain unchanged. Policy changes affect only cancellations committed after the new policy activation; they never rewrite an existing liability.

### Pricing and subscription accounting

- A monthly booking uses its existing immutable `priceSnapshotRsd` and records `monthly-booking-snapshot`. A legacy monthly row with a missing snapshot is `waived`: cancellation still frees the seat, but the API must not guess a punitive amount or create debt.
- A single group booking uses the authoritative group's `priceSingleRsd` recomputed under the cancellation transaction and freezes it in the liability. The token binds that amount, so a price change after preview returns a fresh 409 preview before any mutation.
- A booking already marked paid, including a bonus-credit redemption, creates a paid liability for audit and creates no additional debt.
- Subscription summaries and monthly pricing counts include active booked/attended rows plus cancelled rows that have a liability. They must never sum both the cancelled booking snapshot and its liability as two charges.
- `PATCH /subscriptions/:id/paid` updates active subscription bookings and cancelled bookings represented by a liability in the same transaction. Ordinary cancelled rows remain excluded.
- Later tier edits, policy edits, cancellation retries, and payment changes never alter the liability amount, monthly ordinal, pricing tier snapshot, or policy snapshot.

## API

### Client cancellation

- `GET /bookings/:id/cancellation-preview`
  - identity: existing verified Telegram/session actor; owner only;
  - returns the current `ordinary`, `liable`, or `waived` preview;
  - signs a short-lived HMAC token for `liable`, following the existing broadcast preview-token pattern and using server-only configured secret material;
  - token claims bind actor Telegram id, client id, booking id, training id/start, policy version/hours, cutoff, amount, billing kind, payment status, and expiry.
- `POST /bookings/:id/cancel`
  - accepts the extended cancellation input and returns `bookingCancellationResultSchema`;
  - locks booking and training, resolves the actor, requires owner self-cancellation for liability, and rejects a started/past training;
  - recomputes policy, Europe/Belgrade start instant, cutoff, amount, billing kind, and payment state under the lock;
  - late means `now >= start - N hours` and `now < start`; exactly at the cutoff is late;
  - if the recomputed result is `liable`, missing, expired, actor-mismatched, stale-policy, stale-price, or otherwise mismatched token returns 409 with the fresh preview and commits nothing;
  - with valid confirmation, inserts the unique liability, marks the one booking cancelled, decrements/recomputes capacity, captures the client cancellation status including liability, and enqueues the assigned coach's immutable staff snapshot in the same transaction;
  - `ordinary` and `waived` cancellations require no token and create no liability;
  - existing post-commit waitlist promotion and freed-slot automation run after the transaction as they do today.

### Admin policy and ledger

- `GET /settings/late-cancellation-policy`: existing admin/manager guard; returns disabled defaults when absent.
- `PATCH /settings/late-cancellation-policy`: same guard; validates and atomically increments policy version, setting a new `effectiveFrom` on enable or threshold change.
- `GET /late-cancellation-liabilities`: admin-only paginated/filterable ledger, joined to current booking payment stamps but using immutable liability display/money snapshots.
- `PATCH /late-cancellation-liabilities/:id/paid`: admin-only standalone-liability payment update. It may update only `billingKind=single`; subscription-backed rows return a typed conflict and remain governed by `PATCH /subscriptions/:id/paid`.

The admin route/page may be `/late-cancellations`. Add a navigation entry and a link from a subscription-backed liability to the existing subscription payment view.

## Bot flow

1. Client taps cancel for an upcoming booking.
2. Bot calls the preview endpoint before showing confirmation.
3. `ordinary` or `waived`: show the existing confirmation, with a clear no-charge/waiver line where applicable.
4. `liable`: show date/time, training, coach, exact amount, and explicit copy that cancelling frees the seat but the client accepts full financial responsibility. The destructive confirmation callback carries server-side short-lived state or a compact opaque token reference that remains within Telegram's callback-data limit.
5. On confirm, post the token. A 409 refreshes the warning and requires a new explicit tap; it never silently retries the mutation.
6. Show success from the returned result, including amount/payment state when liability exists.

No price, cutoff, or eligibility math belongs in the bot.

## Mini App flow

1. Opening the cancellation sheet triggers the preview query.
2. Keep the destructive action disabled while preview is loading or invalid.
3. Render `ordinary`, `waived`, or `liable`; the liable state shows exact RSD amount and an explicit full-financial-responsibility statement.
4. The confirm button posts the returned token once. Double submit is disabled.
5. A 409 replaces the sheet with the fresh preview and requires another tap. Success refreshes detail, client records, calendar, capacity/participants, and relevant subscription/liability queries.

No frontend computes whether the cancellation is late or derives the amount.

## Coach notification

Use the existing record-status outbox with `recipient.audience = "staff"`, `staffMessage`, and the assigned trainer's Telegram id/locale. Enqueue it in the same transaction as the liability and cancellation with a transition key such as `late-cancellation:<liabilityId>:coach:<trainerTelegramId>`.

The immutable message includes client, training/date/time, cancellation time, amount, billing kind, and paid/unpaid state. A trainer without Telegram produces an auditable skipped delivery. Known failures retry using the current bounded record-status policy; transport ambiguity is terminal `ambiguous` to avoid duplicate intentional sends. Notification failure or ambiguity never rolls back or changes the cancellation/liability.

## Invariants

- **API-owned decision.** Identity, group-training scope, future/start boundary, cutoff, price, payment, and liability are server decisions.
- **Explicit informed consent.** A late chargeable cancellation cannot mutate without a current matching confirmation token. Threshold/policy/price changes and crossing the cutoff invalidate an ordinary/stale confirmation and require a fresh warning.
- **One atomic domain result.** Liability creation, one-booking cancellation, capacity recompute, client status snapshot, and coach notification intent commit together or roll back together.
- **Seat release is independent of payment.** Valid cancellation frees the seat whether liability payment is paid or unpaid. Payment/notification failure cannot retain or restore the seat.
- **One liability per booking.** Database uniqueness plus locked status prevents duplicate debt under retries or concurrency.
- **Immutable financial basis.** Monthly amounts come only from stored snapshots. Legacy missing snapshots are waived. Single amounts are frozen from the locked authoritative group price at confirmation.
- **No double debt.** A paid subscription or redeemed bonus remains paid; a subscription liability stays inside the same subscription total/payment batch and is counted once.
- **Monthly ordinal retention.** A late-cancelled subscription booking remains pricing-counted through its liability; an ordinary/waived cancelled booking remains excluded.
- **No retroactive mutation.** No scan/backfill creates liabilities for past cancellations, and policy edits never rewrite liabilities.
- **Europe/Belgrade time.** Convert stored training date/time to a Belgrade instant, including DST boundaries; never use host-local date arithmetic.
- **Durable notification intent.** Coach and client messages are transactionally enqueued, retriable for definite failures, and auditable for failed/ambiguous/skipped outcomes.
- **Thin surfaces.** Bot, Mini App, and admin render validated contracts and call API endpoints; they do not own financial or availability rules.

## Acceptance criteria

- With no saved setting, the policy is disabled and cancellation behavior creates no liability.
- An authorized manager can enable global `N`, reload it, change it for future cancellations, and disable it; an unauthorized actor cannot read or mutate the policy.
- An owner can cancel a future group booking before the cutoff through the existing ordinary confirmation; one seat is freed and no liability is created.
- At or inside the cutoff, a chargeable cancellation displays exact amount/full-responsibility copy in bot and Mini App and commits only after explicit confirmation with the matching token.
- Crossing the cutoff after an ordinary preview, or changing policy/price after a liable preview, yields a fresh typed 409 and no cancellation/liability/capacity change.
- A valid late confirmation creates exactly one immutable liability, cancels exactly one booking, frees exactly one seat, preserves subscription siblings, and enqueues client and assigned-coach messages atomically.
- Concurrent/repeated confirmation produces at most one cancellation and liability and never decrements capacity twice.
- Monthly snapshot price is preserved. A legacy monthly row without a snapshot is cancelled with a visible waiver and no guessed liability.
- A paid subscription or bonus-credit booking yields a paid audit liability and no new unpaid debt.
- Subscription totals, counts, payment state, and mark-paid operation include late-cancelled liability rows once and exclude ordinary cancelled rows.
- Admin ledger displays immutable client/training/cancellation/amount details and current payment state. Standalone liabilities can be marked paid/unpaid; subscription liabilities route through subscription payment.
- Coach Telegram known failures retry durably; absent Telegram is skipped; ambiguous outcomes remain visible and are not automatically retried. All leave the committed cancellation intact.
- Staff/admin cancellations, individual training, training cancellation, transfer, decline, waitlist removal, court rental, and no-show do not create late-cancellation liabilities.

## Tests

### Contracts and settings

- Parse disabled/enabled policy, all preview variants, cancellation result, liability rows/pages, filters, and standalone payment input; reject missing amount/token, invalid hours, negative RSD, and stray fields.
- Settings default disabled; authorized round-trip increments version/effective time; malformed stored value disables safely; unauthorized GET/PATCH fails.

### Preview/token

- Owner-only; another/non-client identity learns no booking details.
- Before cutoff ordinary, exactly cutoff liable, inside window liable, at/after start not cancellable, with Europe/Belgrade DST and host-timezone-independent cases.
- Token actor/booking/training/policy/amount/expiry tampering fails.
- Threshold crossing, policy edit, group-price edit, and token expiry return typed 409 with fresh preview and no writes.
- Legacy monthly missing snapshot returns waived; no current-tier lookup or guessed amount occurs.

### Cancellation transaction

- Valid late confirm inserts liability, cancels one row, recomputes full to open, captures liability in client status, and enqueues coach staff delivery in one transaction.
- Inject failure after each internal write and prove full rollback.
- Repeat and concurrent submits leave one liability, one status change, one decrement, and one coach intent.
- Ordinary and waived cancellations keep existing waitlist/freed-slot ordering and create no liability.
- Staff/decline/transfer/individual/non-group paths create none.

### Pricing/payment

- Monthly liability copies exact booking snapshot metadata/amount and remains counted in month/subscription once.
- Missing monthly snapshot is waived.
- Single liability freezes group single price at confirmed cancellation.
- Paid subscription and paid bonus-credit booking remain paid with no extra debt.
- Marking a subscription paid/unpaid updates active rows plus its liability-backed cancelled rows, excluding ordinary cancellations; totals and ordinals never recompute.
- Standalone liability payment update stamps/clears booking `paidAt` and `paidBy`; attempting it on subscription liability conflicts without mutation.

### Notification

- Assigned coach snapshot has correct locale, immutable copy, liability amount/payment, and unique transition key.
- Missing coach Telegram skips audibly; definite failures retry to the bounded limit; timeout/unknown and post-send persistence uncertainty become ambiguous; cancellation remains committed.
- Client cancellation message includes the recorded liability and payment state.

### Surfaces and regression

- Bot and Mini App show ordinary, waived, and liable confirmations; liable copy contains exact amount and requires a new tap after 409 refresh.
- Loading disables confirmation; double taps cause one API mutation; success invalidates all affected views.
- Admin policy and ledger cover loading/error/empty/filter/payment/link-to-subscription states.
- Existing cancellation ownership, capacity, waitlist promotion, freed-slot automation, subscription pricing, record-status delivery, and staff cancellation-reason tests remain green.
- Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` across all workspaces. Then verify bot, Mini App, admin, API, and local Postgres behavior with disposable local fixtures. Docker is currently unavailable (`docker_engine` pipe missing), so live DB verification remains an explicit runner blocker until the daemon is available; static/unit checks do not prove runtime transaction behavior.

## Dependencies

- Existing booking ownership/cancellation transaction and post-commit waitlist/freed-slot flow.
- Existing immutable monthly booking price snapshots and subscription payment endpoint.
- Existing `app_settings` repository pattern and manager/admin guard.
- Existing record-status event/delivery scheduler with staff-audience snapshots.
- Existing RU/SR/EN bot, Mini App, and admin catalog patterns.

No dependency exists on deployment, live financial mutation, a new generic notification system, changes to court/individual cancellation, or retroactive liability migration.

## Decisions & supported assumptions

- **Policy lifecycle:** disabled until an admin explicitly saves enabled `N`; changes apply prospectively and do not backfill. Required by the ready package.
- **Boundary:** exactly `N` hours before start is late; start is an absolute Europe/Belgrade instant. This gives one deterministic server rule.
- **Confirmation race:** preview plus bound short-lived token, followed by locked recomputation and typed 409 refresh. This is required to prevent a harmless preview from becoming an unconfirmed charge when time/policy/price changes.
- **Monthly price:** stored snapshot only; missing legacy snapshot waives liability. Guessing a punitive historical amount is unsafe.
- **Single price:** current locked group single price at final confirmation, frozen into the liability. The existing schema has no immutable booking-time single-price snapshot; token mismatch prevents silent price changes between warning and write.
- **Paid subscription/bonus:** existing paid status means the financial obligation is already covered, so liability is retained for audit without creating a second debt.
- **Subscription ownership:** subscription payment remains batch-owned; the liability ledger cannot independently flip one subscription date and create contradictory state.
- **Notification delivery:** reuse record-status staff delivery rather than add another outbox. Definite failures retry; ambiguous sends are terminal and visible because Telegram exactly-once delivery cannot be proved.
- **Admin placement:** a dedicated late-cancellations ledger is clearer than mixing policy/liability operations into the subscription table, while subscription-backed payment still links to that existing workflow.

## Selected-role handoff and file ownership

1. `backend-implementer` owns `packages/types`, `packages/db`, the generated migration, `apps/api/src/modules/bookings`, `training-pricing`, `subscriptions`, `settings`, `record-status`, and a focused new late-cancellation API module/repository. Land stable contracts first.
2. `bot-implementer` owns `apps/bot` preview/confirm callback state, copy, ApiClient, and bot tests after backend contracts stabilize.
3. `frontend-implementer` owns Mini App ApiClient/hooks/sheet flow and admin ApiClient/hooks/route/navigation/policy/ledger screens. If split, assign Mini App and admin to non-overlapping writers.
4. `test-writer` adds invariant coverage without duplicating implementation tests, especially token races, transaction rollback/concurrency, subscription non-duplication, and durable coach failure semantics.
5. `security-reviewer` verifies ownership, token binding/timing, admin guards, immutable amount basis, no double debt, and secret-safe delivery diagnostics.
6. `reviewer` checks contract compatibility, migration/schema integrity, transaction boundaries, thin surfaces, legacy waiver behavior, and scope cleanliness.
7. `app-runner` runs focused/full checks and runtime fixtures once Docker/Postgres is available, reporting the exact runtime boundary if it remains unavailable.

No GitHub, deployment, or live-financial-data owner is authorized by this scope.

## Implementation and verification — 2026-10-14

Implemented locally in Factory mode. The admin route is `/late-cancellations`, under clients and money, with a global disabled-by-default policy (1–168 hours), payment/type filters, pagination, standalone payment confirmation, and subscription payment handoff. Bot and Mini App render authoritative previews and require a new explicit confirmation after a stale-policy/amount/payment-state response. Existing staff roster cancellation remains free of client financial liability.

Subscription totals, payment batches, breakdowns, and monthly ordinal counts include liability-backed cancelled bookings exactly once. Ordinary cancelled bookings and pending/waitlist/no-show rows remain excluded from the pricing count. Client history and cancellation notifications show the liability; coach notification intents use the existing transactional outbox. Failed/ambiguous delivery and skipped staff recipients without Telegram are visible in the existing connector delivery audit.

Verification completed:

- Workspace-wide `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd test`, and `pnpm.cmd build` passed, including admin and Mini App. The final standard API suite passed 1412 tests; shared contracts 549, admin 454, bot 223, and Mini App 199.
- Browser fixture verified the real admin components, policy presentation, payment-confirmation interaction, ledger rows, and desktop/mobile layout. This was a fixture API, not a production connection. Temporary browser/server/HTML harness were closed or removed.
- Started the installed Docker Desktop, then created a separate PostgreSQL fixture container `beosand-late-cancellation-fixture-20261014`, bound only to `127.0.0.1:55439`, database `beosand_status`, without user-data mounts. All migrations, including `0038_good_mentor.sql`, applied successfully.
- Ran 18 real PostgreSQL integration tests sequentially: 5 new cancellation tests plus 13 existing status/history cases. New tests exercise concurrent cancellation, one seat/one liability, immutable paid monthly billing and batch payment, rollback, stale-policy rejection, durable client/coach intent and dispatch, and actual local Nest HTTP preview/cancel/admin-ledger/payment routes. Invalid ledger input returns 400; a non-admin ledger caller receives 403.
- Telegram dispatch was a test double. Actual Telegram delivery, production infrastructure, and deployment have not been tested or changed. The HTTP fixture uses the trusted raw server identity seam; existing web-session bridge tests cover the browser identity seam separately.

The temporary PostgreSQL fixture remains running in accordance with the local verification rule to leave the database up. Ordinary integration runs require explicit fixture URLs and are guarded against other hosts/ports/databases. To repeat the 18 DB cases against this fixture, set both `RECORD_STATUS_TEST_DATABASE_URL` and `LATE_CANCELLATION_TEST_DATABASE_URL` to the dedicated fixture URL, then run the three integration spec files with `--no-file-parallelism`.

Before deployment, the deployment owner must apply the migration to the intended environment, release API/bot/admin/Mini App together because the cancellation response is now `{ booking, liability }`, and check a linked trainer's Telegram delivery with an explicitly approved test recipient. The deployed policy stays disabled until an administrator enables it. No production financial rows were mutated or backfilled.

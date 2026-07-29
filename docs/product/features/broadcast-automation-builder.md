# Broadcast automation builder

## Status

Planned from ready-for-planner package `beosand-broadcast-automation-builder-20260728`, revision 10.
No material product decisions remain unresolved. This document is the implementation handoff; it
does not authorize implementation until the user approves the full agent flow.

## Goal

Replace the legacy broadcast constructor with an admin-only automation builder for public
group-training Telegram communications. Managers can configure scheduled and event-triggered,
localized messages, inspect every run and delivery outcome, and explicitly retry failures without
changing booking, capacity, visibility, or waitlist rules.

The smallest end-to-end slice contains:

- one CRUD surface and typed API for automation definitions;
- one-time, daily, and weekly schedules in `Europe/Belgrade`, plus training-created,
  training-time-changed, and freed-place triggers;
- per-training messages or a configured multi-training digest;
- Telegram audience selection by one or more levels and rolling seven-day authenticated Mini App
  activity;
- multilingual message variants with a required default-language fallback;
- supported CTA choices of booking or none;
- one automatic delivery attempt, durable history, and explicit manual retry;
- legacy today/tomorrow/week/`freed-up` definitions still manually runnable, but no creation of new
  legacy definitions.

## Spec refs

- Ready package `beosand-broadcast-automation-builder-20260728`, revision 10.
- `docs/product/feature-roadmap.md` is absent in this repository, so there is no roadmap entry to
  cite.
- Historical/current behavior briefs:
  - `docs/product/features/same-day-freed-slot-auto-broadcast.md`;
  - `docs/product/features/broadcast-template-variables.md`;
  - `docs/product/features/broadcast-group-and-block-description.md`;
  - `docs/product/features/admin-dispatch-desk-redesign.md`.
- Architecture:
  - `docs/architecture/overview.md`;
  - `docs/architecture/domain-model.md`;
  - `docs/architecture/database.md`.
- Current implementation anchors:
  - `apps/admin/src/pages/Broadcasts.tsx`;
  - `apps/admin/src/hooks/useBroadcasts.ts`;
  - `apps/api/src/modules/broadcasts/*`;
  - `apps/api/src/modules/bookings/bookings.service.ts`;
  - `apps/api/src/modules/waitlist/*`;
  - `apps/api/src/modules/notifications/*`;
  - `packages/types/src/training-contracts.ts`,
    `broadcast-template-contracts.ts`, `settings-contracts.ts`, and
    `i18n-contracts.ts`;
  - `packages/db/src/schema.ts`.

## Scope and product model

### Automation kinds

Each automation has exactly one trigger:

1. **Scheduled**
   - recurrence: `one-time`, `daily`, or `weekly`;
   - calendar and wall-clock interpretation: always `Europe/Belgrade`;
   - scheduled training window: reuse the server-owned current `today`, `tomorrow`, or `week`
     public-group-training selection;
   - output mode: one message per qualifying training or one digest containing all qualifying
     trainings.
2. **Training created**
   - created only for a newly persisted public group-training occurrence;
   - idempotently skipped existing rows from month generation are not creation events;
   - individual and hidden/non-public group trainings are ineligible.
3. **Training time changed**
   - created only after a successful write that actually changes a public group-training
     occurrence's start or end time;
   - a court-only edit and individual-series reschedule are not qualifying events.
4. **Freed place after cancellation**
   - entered only after a successful cancellation that freed a seat;
   - existing waitlist promotion runs first;
   - if an eligible waitlisted participant existed or was selected for promotion, that participant
     remains the exclusive recipient of the freed seat and no broader automation run is created.

Event-triggered notices identify one training and are due five minutes after the committed source
event. Scheduled per-training output creates one message item for each qualifying training;
scheduled digest output creates one message item covering all included trainings.

### Schedule behavior

- One-time schedules contain a Belgrade local date and time.
- Daily schedules contain a Belgrade local time.
- Weekly schedules contain one or more ISO weekdays and a Belgrade local time.
- A scheduled occurrence is materialized at most once.
- If the worker does not claim an occurrence within the architecture-defined on-time processing
  window, the occurrence is recorded as `skipped/missed`; it is never sent as catch-up work.
- A missed one-time occurrence becomes terminal. A missed daily/weekly occurrence does not prevent
  later occurrences.
- Event-triggered runs follow the same no-catch-up rule after their five-minute due time.
- Editing or disabling an automation does not retroactively send missed occurrences. A pending run
  that is no longer enabled or eligible at delivery is skipped and recorded.

### Training selection and overlap

- Scheduled runs query current qualifying trainings at run time; they never use a stale training
  list captured when the automation was edited.
- Each training appears once in a scheduled occurrence, using its latest committed state.
- A scheduled digest omits a training already successfully covered by a five-minute event notice
  for the same underlying event since the previous occurrence of that scheduled automation (or
  since automation creation for its first/one-time occurrence).
- Every run rechecks public visibility, group/trainer/level active state, non-terminal training
  state, relevant time window, and trigger-specific eligibility immediately before delivery.
- An invalid, hidden, individual, cancelled, completed, no-longer-in-window, or otherwise
  ineligible training is not delivered and is recorded with a machine-readable skip reason.

### Audience

New automations use a new audience contract rather than overloading the legacy
`BroadcastAudience` union:

- `levelIds`: a non-empty, de-duplicated list of level UUIDs; one or multiple levels are supported;
- `activity`: exactly one of `active` or `inactive`;
- the two dimensions intersect: a recipient must have a selected level and the selected Mini App
  activity classification;
- only clients with a Telegram identity can become Telegram deliveries.

Activity is derived only from reliable persisted authenticated Mini App access:

- `active` means the client completed a successful authenticated Mini App entry during the
  preceding rolling seven days, inclusive of the cutoff instant;
- `inactive` means no such access exists in the preceding rolling seven days, including clients
  with no recorded Mini App access;
- successful Telegram Mini App `initData` validation is the activity signal;
- after validation, an existing client refreshes their persisted last-access timestamp using the
  server's current instant before the API returns the successful existing-client session;
- a first-time Telegram user does not get a client row or last-access timestamp merely from
  `initData` validation; their last access is initialized with server time atomically inside the
  successful consented onboarding transaction associated with that validated session;
- repeated successful authenticated entry by an existing/onboarded client refreshes last access;
- Telegram `auth_date` is validated for freshness but is never stored as the activity timestamp;
- unauthenticated Mini App traffic, bot activity, bookings, and sent/received messages do not
  refresh activity;
- invalid authentication, abandoned onboarding, failed onboarding, and access-persistence failure
  persist no new activity and cannot mark the user active;
- existing clients have no recorded access after migration and therefore classify as inactive
  until their first successful post-rollout authenticated Mini App entry.

Preview and delivery independently evaluate current persisted activity. Delivery rechecks the
rolling cutoff, so a recipient whose seven-day activity expires after preview or run materialization
is not sent and is recorded as skipped.

The admin label must say that **inactive means no successful authenticated Mini App access in the
last seven days**, including no recorded access. It must not describe inactive as an inactive client
account, legacy "lapsed" booking history, or "not attending this training". There is no configurable
"already booked in this training" filter.

For a freed-place run, mandatory backend exclusions still remove:

- the cancelling client;
- clients already `booked` or `pending` for the training;
- clients with active `waiting` or `notified` entries for the training.

Those exclusions are invariants, not builder settings.

### Message and CTA

- Reuse the repository `ru`, `sr`, and `en` locale vocabulary.
- Each automation designates `defaultLanguage`.
- A non-empty message variant for `defaultLanguage` is required before enable.
- A recipient gets their own-language variant when configured; otherwise the server renders the
  default-language variant.
- The exact rendered text, selected language, template/automation version, and resolved variables
  are snapshotted in history.
- Reuse the existing strict server-side broadcast variables and renderer where applicable; the
  technical design may extend the curated variable catalog for trigger metadata, but unknown
  placeholders must remain invalid.
- Admin displays server-rendered preview text verbatim and never performs authoritative
  interpolation.

CTA mode is exactly one of:

- `none`;
- `booking`.

Booking CTA reuses `book:slot:<trainingId>` and the existing booking flow. It is valid only for a
message item that identifies exactly one training and is rejected for a multi-training digest. CTA
use never reserves capacity; booking rechecks current availability and authorization.

## Contracts & tables

Exact file splitting and column normalization belong to technical architecture. The shared
contracts must nevertheless expose these logical shapes in `packages/types` and be exported from
the package index:

- `broadcastAutomationTriggerSchema`
  - scheduled recurrence and Belgrade wall-clock fields, or one event trigger;
- `broadcastAutomationAudienceSchema`
  - `levelIds`, rolling seven-day Mini App `activity`;
- `broadcastAutomationMessageSchema`
  - locale-keyed bodies, `defaultLanguage`, output mode, training window where scheduled, CTA mode;
- `broadcastAutomationSchema`
  - identity, name, enabled state, trigger, audience, messages, version, creator/updater and
    timestamps;
- create/update/enable/disable inputs;
- preview input/output with rendered message items, current qualifying training summaries,
  recipient count, selected/fallback languages, validation warnings, and a version-bound preview
  token or equivalent stale-edit guard;
- paginated automation list and run-history queries;
- `broadcastAutomationRunSchema`, run-training/item schema, delivery schema, and aggregate counts;
- manual-retry input/result, including explicit acknowledgement for ambiguous outcomes;
- stable enums for run status, delivery outcome, skip reason, trigger, recurrence, output mode, CTA,
  and Mini App activity classification.

Mandatory Mini App activity contracts:

- a persisted nullable client last-access timestamp exposed only through server-owned repository/
  domain shapes needed by auth and automation audience resolution;
- an internal authenticated-access update contract or typed repository method that durably
  refreshes server-time last access for an existing client after valid `initData`;
- a consented onboarding transaction input that carries the validated-session association
  server-side and atomically creates/finds the client plus initializes server-time last access;
- no client-supplied activity timestamp or public mutation endpoint.

Minimum durable persistence:

- `broadcast_automations`
  - definition, enabled state, versioned configuration, and audit timestamps/actors;
- `broadcast_automation_runs`
  - automation/version snapshot, trigger/source identity, scheduled/due time, status, skip reason,
    aggregate counts, and optional link to the original run for manual retries;
- `broadcast_automation_run_trainings` (or equivalent run-item table)
  - unique training inclusion per run, latest training snapshot used to render, coverage/source
    event identity, outcome, rendered locale payloads, and CTA snapshot;
- `broadcast_automation_deliveries`
  - run/item, client, Telegram identity snapshot, requested/resolved language, one attempt outcome,
    timestamps, sanitized diagnostic, and optional link to the delivery being retried.

Required uniqueness/claim boundaries:

- one scheduled run per `(automation_id, scheduled_for)`;
- one event run per `(automation_id, source_event_id)`;
- one training item per `(run_id, training_id)`;
- one automatic delivery claim per `(run_item_id, client_id)`;
- a retry is a new, explicitly linked attempt and never mutates the original attempt into success.

Existing tables:

- `clients` gains a nullable `mini_app_last_access_at timestamptz` (exact naming may follow the
  repository convention). Existing rows migrate as `NULL`.
- `broadcasts` and `broadcast_templates` remain the legacy manual-send audit/catalog.
- `same_day_freed_slot_events` and `same_day_freed_slot_deliveries` remain readable historical
  evidence during cutover; the old dispatcher must not execute in parallel with an enabled
  builder-owned freed-place automation.
- `waitlist`, `bookings`, `trainings`, `groups`, `levels`, `trainers`, and `clients` remain domain
  truth.
- `notifications` and `notification_templates` remain separate; automation messages do not become
  notification event-key overrides.
- Persisted/logged automation diagnostics reuse or generalize the current freed-slot sanitizer:
  redact URLs, Telegram chat/user identifiers, bot tokens and token-shaped credentials, collapse
  control whitespace, trim, and bound length.

The technical design owns the migration and scheduler implementation, including safe cutover from
the old global same-day setting. Product requirements for that cutover are: retain old history, do
not silently create duplicate automation sends, and never run both freed-place engines for the
same cancellation.

Mini App auth and onboarding are mandatory dependencies of audience correctness:

- `POST /auth/miniapp` validates Telegram `initData`.
- If the validated Telegram identity already belongs to a client, the API durably refreshes
  `clients.mini_app_last_access_at` with server time before returning the successful session. If
  that write fails, the request fails and the prior timestamp remains authoritative.
- If no client exists, auth returns the existing validated first-time/onboarding session without
  creating a pre-consent client or activity row. `auth_date` is not copied into activity state.
- Successful onboarding must verify/associate that validated session and, in one transaction,
  create or duplicate-safely resolve the client, persist consent/profile state, and initialize
  `mini_app_last_access_at` with server time.
- Invalid auth, abandoned onboarding, and failed/rolled-back onboarding persist neither a new
  client nor last access.
- Concurrent onboarding attempts for the same Telegram identity are duplicate-safe: at most one
  client is created, the successful transaction initializes/refreshes last access, and no partial
  consent/activity row is left behind.
- No other auth, bot, booking, notification, or unauthenticated request path may update last
  access.

## API

All endpoints are admin-only and validate/return shared contracts.

### Automation definitions

- `GET /broadcast-automations`
  - returns definitions and enabled/disabled state.
- `POST /broadcast-automations`
  - creates a disabled draft after strict validation.
- `GET /broadcast-automations/:id`
  - returns one definition and validation state.
- `PATCH /broadcast-automations/:id`
  - updates configuration, increments version, and invalidates stale previews.
- `POST /broadcast-automations/:id/enable`
  - validates trigger, audience, default message, and booking CTA constraints.
- `POST /broadcast-automations/:id/disable`
  - prevents future automatic sends; due work is skipped with history rather than deleted.
- `POST /broadcast-automations/:id/preview`
  - evaluates current truth without sending and returns server-rendered items/counts/warnings.

### History and retry

- `GET /broadcast-automation-runs`
  - cursor-paginated history filtered by automation, trigger, status, and date range;
  - returns run counts and skip/failure summaries.
- `GET /broadcast-automation-runs/:id`
  - returns config snapshot, included/skipped trainings, exact rendered payloads, CTA snapshot,
    recipient/delivery outcomes, linked retry attempts, and sanitized diagnostics.
- `POST /broadcast-automation-runs/:id/retry-failures`
  - explicitly retries selected or all `failed` deliveries once per request;
  - ambiguous deliveries require an explicit `acknowledgeAmbiguous: true` confirmation because
    Telegram may already have delivered them;
  - successful deliveries are never selected;
  - the API rechecks automation enabled state, training eligibility, current persisted Mini App
    activity, audience identity, mandatory exclusions, and CTA validity before the new attempt;
  - every retry creates linked history and never schedules another retry automatically.

### Legacy compatibility

- Existing `GET /broadcasts/preview` and `POST /broadcasts/send` remain available for existing
  today/tomorrow/week/`freed-up` manual definitions.
- Existing legacy definitions/templates remain listable and manually triggerable.
- The legacy creation control is removed from admin and the server rejects creation of new legacy
  broadcast-template definitions after cutover. Existing rows are not deleted or silently
  converted.
- Legacy manual preview/send continues to use current availability rechecks, typed booking
  callbacks, and `broadcasts` audit rows.

Internal trigger entry points are service-level post-commit seams, not public unauthenticated send
endpoints.

## Admin flow

1. Admin opens `/broadcasts` and sees:
   - automation list with enabled state, trigger, next occurrence, last result, and actions;
   - run-history workspace;
   - a separate "Legacy manual sends" section for existing definitions only.
2. Admin creates a disabled automation and chooses schedule/event trigger, audience levels and
   active/inactive seven-day Mini App activity, output mode, language variants/default, and CTA.
3. Admin previews current server-selected trainings, exact text, fallback behavior, CTA, and
   recipient counts.
4. Admin saves and explicitly enables the valid definition.
5. Admin can disable/edit it; editing increments version and requires a fresh preview.
6. Admin opens history to inspect sent/failed/ambiguous/skipped counts and sanitized reasons.
7. Admin may explicitly retry eligible failures. Ambiguous outcomes show a duplicate-delivery
   warning and require confirmation.

The detailed editor layout belongs to the design/architecture stage, but it must follow the
Dispatch Desk rules: one operational workspace, explicit loading/empty/error/disabled states,
keyboard-accessible controls, and no browser-owned domain calculations.

## Bot flow

There is no new conversational bot state.

1. A selected recipient receives one localized Telegram message or digest.
2. If configured for a single identified training, the recipient sees one existing booking
   callback; otherwise the message has no CTA.
3. Booking CTA enters the existing quick-book flow, which rechecks current booking/capacity/
   waitlist truth.

For freed capacity, an existing waitlisted participant is auto-booked and receives the existing
localized waitlist-promotion DM; the broader automation message is not sent for that cancellation.

## Invariants

- **Admin-only control and history.** Non-admin callers cannot list, read, preview, create, update,
  enable, disable, inspect history, or retry, and forbidden requests write/send nothing.
- **Backend ownership.** Trigger qualification, schedules, timezone conversion, training
  selection, persisted Mini App activity classification, audience resolution, locale fallback, CTA
  validity, waitlist priority, idempotency, delivery claims, and history are API decisions.
- **Reliable Mini App activity.** Active means a successful authenticated Mini App entry in the
  preceding rolling seven days. Existing clients refresh after valid `initData`; first-time users
  initialize activity only inside successful consented onboarding. Only durable server-time writes
  count; unauthenticated traffic, bot use, bookings, and messages do not. `auth_date`, persistence
  failure, and abandoned/failed onboarding cannot make a client active.
- **Consent before first client row.** A validated first-time Mini App session creates no
  pre-consent client. Client creation, consent/profile persistence, and initial last access are one
  atomic, duplicate-safe onboarding transaction.
- **Current activity at send.** Preview and delivery use persisted server time, and delivery
  rechecks that the recipient still satisfies the selected activity classification before the
  Telegram attempt.
- **Public group only.** Hidden groups, inactive group/trainer/level rows, individual trainings, and
  terminal trainings never produce automation delivery.
- **Belgrade time.** All recurrence and training-window decisions use `Europe/Belgrade`, including
  DST; worker-host timezone is irrelevant.
- **No catch-up.** Missed scheduled/event due times are skipped and audited, never delivered late by
  an automatic sweep.
- **Five-minute event delay.** Created/time-changed/freed-place notices are not delivered before
  their due time and are rechecked at delivery.
- **Waitlist first and exclusive.** A freed seat is offered through existing auto-promotion first.
  If a waitlisted participant existed/was selected, broad delivery for that cancellation is
  suppressed even if capacity remains afterward. Promotion and its localized DM keep existing
  transaction/failure behavior.
- **Current truth at delivery.** Invalid, hidden, individual, cancelled, completed, full where the
  message advertises availability, or otherwise ineligible trainings are skipped and recorded.
- **One automatic attempt.** Each claimed automatic delivery makes at most one Telegram send call.
  Known failures are `failed`; uncertain transport/persistence outcomes are `ambiguous`. Neither is
  auto-retried.
- **Explicit retries only.** Manual retry is a new linked attempt initiated by an admin. Ambiguous
  retry warns that duplicates are possible.
- **No successful-recipient replay.** A retry never resends an already successful delivery.
- **Latest-state dedupe.** A scheduled occurrence contains each training once/latest state; digest
  overlap suppression uses durable event coverage.
- **Locale fallback.** Missing recipient-language content falls back only to the designated
  default-language body; enabling without that body is impossible.
- **CTA safety.** Booking callback appears only for one identified training; the only alternative
  is no CTA. CTA does not reserve or promise capacity.
- **Sanitized evidence.** History exposes useful bounded diagnostics but no bot tokens, URLs, or
  recipient identifiers in error text.
- **Legacy compatibility.** Existing manual definitions remain runnable, but no new legacy
  definition can be created. Legacy and new freed-place engines cannot both send for one event.
- **Domain preservation.** Automation failures never roll back committed training, booking,
  cancellation, time-change, capacity recompute, or waitlist-promotion writes.

## Acceptance criteria

- Admin can create a disabled automation, edit it, preview it, enable/disable it, and see it survive
  reload with incremented version after edits.
- Non-admin access to every automation/history/retry endpoint is forbidden and produces no writes
  or Telegram attempts.
- One-time, daily, and weekly schedules resolve in `Europe/Belgrade`, including a DST transition.
- A missed occurrence is recorded skipped and is not sent after worker recovery; later recurring
  occurrences remain eligible.
- A newly committed public group-training occurrence can create a notice due five minutes later;
  idempotently skipped generation, hidden groups, and individual training creation cannot.
- An actual public group-training time change can create a five-minute notice; court-only and
  no-op updates cannot.
- A qualifying cancellation runs existing waitlist promotion first. If a waitlisted participant
  exists/is promoted, only their current promotion notification path runs and no broader
  freed-place delivery is created.
- With no waitlisted participant, a qualifying freed-place event can run after five minutes, while
  excluding the canceller and currently booked/pending clients.
- Eligibility is rechecked immediately before delivery. Hidden, inactive, cancelled, completed,
  full/ineligible, or no-longer-window-matching training items are skipped with history.
- Scheduled evaluation uses current qualifying trainings; each training appears once with latest
  state.
- A digest run omits a training already covered by its relevant five-minute event notice in the
  defined occurrence interval.
- Audience selection accepts one/multiple levels and exactly one active/inactive Mini App activity
  filter; the server resolves only matching Telegram clients using current persisted Mini App last
  access.
- Valid `initData` for an existing client durably refreshes server-time last access before the
  successful existing-client session returns. Repeated access refreshes it.
- Valid `initData` for a first-time user creates no pre-consent client or activity row. Successful
  onboarding associated with that validated session atomically creates/resolves the client,
  persists consent/profile state, and initializes server-time last access.
- Invalid auth, abandoned/failed onboarding, unauthenticated traffic, bot activity, bookings, and
  messages do not refresh activity. Telegram `auth_date` is never stored as last access.
- Concurrent onboarding for one Telegram identity creates at most one client and leaves no partial
  consent/activity state.
- Existing clients with no post-rollout authenticated Mini App entry are inactive. Active expires
  after the rolling seven-day cutoff, and delivery skips a recipient whose status changed since
  preview/materialization.
- Admin copy clearly distinguishes seven-day authenticated Mini App inactivity from inactive
  client-account state and legacy booking-history active/lapsed segmentation.
- Recipient-language content is used when present; otherwise the designated default language is
  used and recorded. An automation without a non-empty default variant cannot be enabled.
- `booking` is rejected for multi-training digest items. Single-training booking CTA keeps
  `book:slot:<trainingId>` and existing capacity/authorization rechecks; `none` adds no button.
- Every run shows selected/included/skipped training counts and recipient/attempted/sent/failed/
  ambiguous/skipped delivery counts, exact payload snapshots, and sanitized diagnostics.
- Each automatic delivery receives at most one intentional send call; failed/ambiguous outcomes
  are not automatically retried.
- Admin can manually retry definite failures. Ambiguous retry requires duplicate-risk
  acknowledgement. Each retry is linked and visible; successes are not replayed.
- Existing today/tomorrow/week/`freed-up` definitions can still be previewed and manually sent.
  Attempts to create a new legacy definition are rejected.
- Existing booking, capacity recompute, public visibility, waitlist promotion/sweep, notification,
  and legacy manual-broadcast tests remain green.

## Tests

### Contract and validation

- Parse every trigger, recurrence, output mode, booking/none CTA, locale/default fallback,
  multi-level audience, Mini App activity selection, history query, and retry shape.
- Reject empty/duplicate/invalid level/status selections, invalid timezone assumptions, missing
  default message, unknown placeholders, invalid weekly weekdays, past/invalid one-time schedules,
  booking CTA on digest, and unsupported CTA values.
- Verify the seven-day activity boundary contract: timestamp at cutoff is active; older/null is
  inactive.
- Reject unknown fields and stale automation versions/preview tokens.

### Persistence and scheduler

- CRUD/version/enable/disable round trips and audit actors.
- Unique scheduled/event run claims under concurrent workers.
- One run item per training and one automatic delivery claim per recipient/item.
- Belgrade daily/weekly/one-time calculation across DST.
- On-time execution, disabled-before-due skip, missed-without-catch-up behavior, and later recurring
  occurrence continuity.
- Old same-day history remains readable and old/new engines cannot both claim one cancellation.

### Trigger and domain integration

- Month generation emits only newly committed public group occurrences.
- Time update emits only on actual group-training time changes after commit.
- Event delivery waits five minutes and rechecks eligibility.
- Cancellation promotes waitlist first; queue-present/promoted blocks broader run even when
  residual capacity exists.
- Promotion failure with an active queue does not leak a broad send; existing minutely promotion
  sweep remains intact.
- No-queue cancellation creates at most one event/run per automation and applies canceller/booked/
  pending/waitlist exclusions.
- Hidden/inactive/individual/terminal/full/no-longer-in-window cases skip with stable reasons.
- Valid `initData` for an existing client refreshes server-time last access before auth success;
  persistence failure leaves the prior value authoritative and does not report recorded activity.
- Valid first-time auth creates no client/activity row; successful onboarding associated with that
  session atomically creates/resolves the client, consent/profile state, and initial server-time
  last access.
- Invalid auth, abandoned/failed onboarding, and rolled-back persistence write no activity;
  `auth_date` is not used as activity time.
- Concurrent onboarding attempts are duplicate-safe and cannot create duplicate clients or partial
  activity.
- Bot interactions, booking writes, notifications, and unauthenticated Mini App requests never
  touch Mini App last access.

### Rendering, audience, CTA, and delivery

- Multi-level plus rolling seven-day active/inactive Mini App intersections and Telegram-null
  exclusion.
- Existing null timestamps classify inactive; active timestamps age into inactive at the cutoff.
- Preview uses current persisted activity; delivery and manual retry recheck expiry and skip
  recipients who no longer match.
- Legacy `BroadcastAudience` active/lapsed booking-history behavior and tests remain unchanged.
- Exact recipient locale and default fallback rendering for RU/SR/EN.
- Server preview equals delivery rendering for the same automation version/current state.
- Per-training versus digest rendering; training dedupe/latest state; event-coverage omission.
- Booking and none keyboard shapes; callback data remains locale-independent.
- One automatic sender call per claim; sent/failed/ambiguous classification and sanitized errors.

### History and retry

- List/detail pagination and filters; exact config/message/CTA/training snapshots and aggregate
  counts.
- Retry selects failed outcomes only by default, never successes, and creates linked attempts.
- Ambiguous retry without acknowledgement rejects; acknowledged retry warns/records duplicate risk.
- Retry rechecks enabled state, audience, training eligibility, mandatory exclusions, and CTA;
  failed recheck records skipped rather than sending.
- Repeated explicit retries create distinct history but never create an automatic retry loop.

### Admin and regression

- Builder loading/empty/error/invalid/preview/enabled/disabled/history/detail/retry states.
- Accessible level multiselect/activity selector, locale tabs/default indicator, booking/none CTA
  constraints, confirmation for ambiguous retry, and responsive history.
- Legacy area lists current definitions, permits preview/manual send, and offers no creation path.
- Direct legacy-create API call is rejected.
- Root definition of done:
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus running-app verification of one
  scheduled run, each event trigger, waitlist exclusivity, history, and manual retry.

## Dependencies

- Current broadcasts preview/send, strict renderer, template catalog, Telegram sender, and booking
  keyboard helpers.
- Existing admin auth guard and typed `ApiClient`/TanStack Query conventions.
- Existing group-training generation and `PATCH /trainings/:id/schedule` post-commit seams.
- Existing booking cancellation, capacity recompute, waitlist promotion, localized promotion DM,
  and minutely safety sweep.
- Existing Mini App `initData` validation, first-time consented onboarding, client resolution,
  locale catalog, and client/group/level/trainer/training data.
- New reliable `clients` last-access column, migration, existing-client auth refresh, and atomic
  first-time onboarding initialization.
- New DB migration and scheduler/claim implementation designed during architecture.
- A deliberate old same-day automation cutover that retains history and prevents parallel sends.
- No dependency on broader admin-shell redesign or changes to booking/capacity/waitlist semantics.

## Resolved decisions and safe assumptions

- Admin-only builder: resolved by user.
- Existing legacy definitions remain manually runnable, but no new legacy definitions: resolved by
  user.
- Public group trainings only: resolved by user.
- One-time/daily/weekly, `Europe/Belgrade`, missed runs skipped: resolved by user.
- Training-created, training-time-changed, and freed-place triggers wait five minutes: resolved by
  user.
- Per-training messages and configured multi-training digests: resolved by user.
- One/multiple levels plus rolling seven-day authenticated Mini App activity: resolved by user.
  Active requires successful authenticated access; inactive includes expired and never-recorded
  access. Level and activity filters intersect.
- Reliable persisted Mini App last access is mandatory: resolved by Revisions 8 and 10. Existing
  clients refresh with server time after valid `initData`; first-time validation creates no
  pre-consent client, and successful associated onboarding initializes last access atomically.
  Invalid auth, abandoned/failed onboarding, unauthenticated traffic, bot activity, bookings, and
  messages do not count; `auth_date` is not stored as activity; persistence failure cannot mark
  active; concurrent onboarding is duplicate-safe; existing clients begin inactive.
- Legacy manual broadcast active/lapsed booking-history semantics remain unchanged: resolved by
  Revision 8.
- No configurable already-in-training filter: resolved by user; only mandatory freed-place
  exclusions remain.
- Waitlist promotion is exclusive before broader freed-place delivery: resolved by user.
- Editable RU/SR/EN messages with designated default fallback: resolved by user and existing locale
  contracts.
- CTA is booking or none only, with booking restricted to one identified training: resolved by
  Revision 8; existing `book:slot` is reused.
- One automatic attempt, no automatic retry, full history, explicit manual retry: resolved by user.
- Scheduled runs evaluate current truth, use each training once/latest state, omit relevant
  event-covered training from a digest, and recheck before delivery: resolved delegated Q-005.
- Manual retry is linked history and may duplicate an ambiguous Telegram outcome; admin warning and
  acknowledgement are required: resolved caveat.
- Reusing current `today`/`tomorrow`/`week` public-group selection for scheduled training windows is
  the smallest evidence-supported assumption; it avoids inventing a parallel availability model.
- Exact normalized columns, scheduler claim window, migration mechanics, and editor composition are
  intentionally deferred to technical architecture, as authorized by the ready package. They may
  not change any behavior or invariant recorded above.

## Out of scope

- Non-Telegram delivery channels.
- Any CTA other than booking/none.
- Public/client automation management.
- New booking, capacity, visibility, pricing, or waitlist behavior.
- Arbitrary code/SQL audience rules or a configurable already-booked exclusion.
- Automatic retries, catch-up delivery, or exactly-once claims about Telegram.
- Creating new legacy broadcast definitions.
- Redesigning unrelated admin pages.

## Audience-filter extension amendment

### Status and boundary

Planned from ready-for-planner package
`beosand-broadcast-audience-filters-20260729`, revision 5. No material product decisions remain
unresolved.

This amendment supersedes only the audience shape, audience resolution, and onboarding fields
described above. All trigger, schedule, message, CTA, history, retry, waitlist, authorization, and
legacy-manual-broadcast behavior remains unchanged. The smallest compatible slice lets an admin
target an automation with any non-empty combination of client level, rolling seven-day
authenticated Mini App activity, and onboarding gender, while collecting gender in the existing
consented Mini App onboarding transaction.

### Spec refs

- Ready package `beosand-broadcast-audience-filters-20260729`, revision 5.
- Historical roadmap slice T3.2, `advanced-filters-segmented-broadcasts` (`ТЗ §19`, stage 3), and
  onboarding slice T1.6, `client-onboarding` (`ТЗ §7`; `UX §1`), recovered from repository commit
  `17719e5`. The live `docs/product/feature-roadmap.md` remains absent.
- Existing brief sections **Audience**, **Contracts & tables**, **API**, **Admin flow**,
  **Invariants**, **Acceptance criteria**, **Tests**, and **Dependencies**.
- Current implementation anchors:
  - `packages/types/src/broadcast-automation-contracts.ts` and `client-contracts.ts`;
  - `packages/db/src/schema.ts` and the migration history under `packages/db/drizzle`;
  - `apps/api/src/modules/broadcast-automations/*` and `apps/api/src/modules/clients/*`;
  - `apps/miniapp/src/screens/OnboardingWizard.tsx` and its typed API/hooks;
  - `apps/admin/src/pages/Broadcasts.tsx`;
  - all three `docs/architecture/*` documents.

### Contracts & tables

Replace the required two-field automation audience with one strict, ordered-independent filter
collection:

- `broadcastAutomationAudienceSchema`
  - `{ filters: BroadcastAutomationAudienceFilter[] }`;
  - `filters` contains one to three entries and rejects duplicate dimensions;
  - level filter: `{ dimension: "level", levelIds: UUID[] }`, with a non-empty, de-duplicated list;
  - activity filter:
    `{ dimension: "activity", value: "active" | "inactive" }`, reusing the existing activity enum
    and fixed rolling seven-day definition;
  - gender filter:
    `{ dimension: "gender", value: "male" | "female" | "unspecified" }`, reusing the client gender
    enum;
  - strict parsing rejects zero filters, unknown dimensions or values, duplicate dimensions,
    duplicate/empty level IDs, unknown fields, and more than three entries.

The API combines different filter entries with `AND`. Selected level IDs are the only multi-value
entry and combine with `OR`. A missing dimension imposes no condition for that dimension. Client
`status = active` and a current non-null Telegram identity remain mandatory delivery eligibility,
not selectable audience dimensions.

Add one shared `clientGenderSchema`/type with exactly `male`, `female`, and `unspecified`.
`clientSchema` includes `gender`; `onboardClientSchema` requires `gender` for a new Mini App
onboarding submission. `updateClientSchema` and all admin client-edit inputs continue to omit it.
The `clients` table gains a non-null gender column backed by the same three-value enum and defaults/
backfills existing clients and non-onboarding sources to `unspecified`. The successful first-client
insert explicitly writes the validated onboarding choice in the same transaction as client
identity, consent/profile data, and initial Mini App access.

`broadcast_automations.config` remains the definition store and
`broadcast_automation_runs.config_snapshot` remains the historical/run snapshot store. The
migration/compatibility boundary is:

- each existing `{ levelIds, activity }` automation definition normalizes to one `level` filter and
  one `activity` filter with identical membership;
- normalization preserves automation ID, enabled state, version, audit fields, and schedule;
- pending and historical legacy-shaped run snapshots remain executable, readable, and retryable
  through one server-owned compatibility normalizer; new writes and API responses use only the new
  filter collection;
- legacy `BroadcastAudience` used by `GET /broadcasts/preview`,
  `POST /broadcasts/send`, and existing same-day settings is not changed.

No segment table, inferred-gender field, or configurable activity window is added.

### API

The automation endpoint set and admin authorization stay unchanged. Create, update, get/list,
preview, enable, run-history, and retry contracts carry the amended audience shape. Preview resolves
the current client rows; immediately before every automatic send and manual retry, the API rechecks
the client's current level, rolling activity, stored gender, active status, and Telegram identity.

`POST /clients/onboard` adds the required `gender` field to its strict typed body. For a first-time
verified Mini App user, gender is persisted atomically with the existing consented onboarding
insert and server-time Mini App access initialization. A rollback persists none of those fields.
Concurrent onboarding remains duplicate-safe. Existing clients are returned idempotently and are
not silently reclassified from `unspecified`.

Client read responses include the stored gender. No public or admin gender mutation endpoint is
added, and `PATCH /clients/:id` continues to reject gender.

### Admin, onboarding, and bot flow

1. The automation editor starts with no audience dimensions selected and requires at least one.
2. Admin can add/remove each dimension at most once:
   - level exposes the existing active-level multiselect;
   - activity exposes the existing `active`/`inactive` seven-day selector and existing explanatory
     copy;
   - gender exposes one choice: male, female, or unspecified.
3. Preview shows the complete selected intersection and the current recipient count; editing any
   dimension invalidates the prior preview as today.
4. Existing automations open with their migrated level and activity filters selected and remain
   operable without manual recreation.
5. Mini App onboarding becomes name → language → level → gender. The final step requires an
   explicit male/female/unspecified choice before the single onboarding submission.

There is no new Telegram bot conversation or recipient interaction. The dormant legacy bot
onboarding path does not infer gender; if retained for compilation/compatibility it submits
`unspecified` explicitly and remains unreachable from `/start`. Automation recipients receive the
same message/CTA flow already defined by this brief.

### Invariants

- **Non-empty bounded filters.** Every new automation has one to three unique dimensions; malformed,
  duplicate, empty, or unknown filters never persist, preview, enable, or send.
- **Intersection semantics.** Different dimensions are `AND`; selected level IDs are `OR`; omitting
  a dimension means no filter for it. Admin code only captures/renders the selection.
- **Inclusive fixed activity cutoff.** With the activity dimension present, `active` is a durable
  successful authenticated Mini App access at or after `now - 7 days`; `inactive` is null or older
  than that instant. The window is not configurable. Without the dimension, activity is ignored.
- **Gender semantics.** `male` matches stored `male` and `unspecified`; `female` matches stored
  `female` and `unspecified`; explicit `unspecified` matches only stored `unspecified`. No name,
  Telegram profile, username, photo, language, booking, or other field is used to infer gender.
- **Atomic onboarding.** A first-time Mini App client's chosen gender, consent/profile, identity,
  and initial last-access timestamp commit together or not at all. Duplicate-safe onboarding cannot
  leave partial or conflicting gender state.
- **Current truth at preview and send.** Preview and every pre-send/retry check use current level,
  last access, gender, active status, and Telegram identity. A changed/non-matching recipient is
  skipped with `audience-no-longer-eligible`, without a Telegram attempt.
- **Eligibility baseline.** Inactive clients and clients without a current Telegram identity never
  receive automation Telegram deliveries, even when all selected dimensions match.
- **Compatibility.** Existing automations preserve their level-plus-activity membership and enabled
  behavior; their run history/retries stay usable. Legacy manual broadcasts retain their existing
  audience union and behavior.
- **No admin gender editing.** Admin client-profile contracts/UI cannot set or change gender.

### Acceptance criteria

- Admin can save and preview each single dimension, each two-dimension pair, and all three
  dimensions; resolved recipients satisfy every selected dimension.
- Selecting multiple levels includes clients in any selected level, while every other selected
  dimension still intersects.
- Zero dimensions, duplicate dimensions, empty/duplicate levels, a fourth entry, unknown
  dimensions/values, and stray fields are rejected before persistence or sending.
- With the gender filter set to male, stored male and unspecified clients match but stored female
  clients do not; female is symmetric; explicit unspecified matches only unspecified.
- An activity timestamp exactly at the rolling seven-day cutoff is active; an older/null timestamp
  is inactive. Omitting activity does not filter by last access.
- Preview counts only current active clients with a Telegram identity. Delivery and manual retry
  skip a client whose level, activity, gender, status, or Telegram identity changed after preview/
  materialization.
- A new Mini App user must choose male/female/unspecified and successful onboarding stores that
  choice atomically with consent/profile/client creation and initial Mini App activity.
- Failed/rolled-back or concurrent onboarding creates no partial gender/profile/activity state and
  at most one client row.
- Existing clients are backfilled as unspecified without inference and are not silently changed by
  idempotent onboarding.
- Existing automation definitions retain their IDs, versions, enabled states, schedules, and
  effective level-plus-activity audience after migration; legacy-shaped run history and retries
  remain readable/usable.
- Existing manual broadcast preview/send and same-day settings accept and behave with the unchanged
  legacy `BroadcastAudience`.
- Admin client editing cannot submit gender, and a forged gender field is rejected.

### Tests

- Shared contracts: all seven valid non-empty dimension combinations; multi-level OR; unique
  dimensions/levels; exact gender enum; strict rejection of zero/duplicate/unknown/oversized
  filters and unknown fields.
- Audience repository/service: AND across dimensions, OR across levels, absent-dimension behavior,
  inclusive activity cutoff, all gender matching rules, active-status/Telegram exclusions, and
  current pre-send/retry recheck.
- Migration/compatibility: legacy definition normalization preserves identity/version/enabled/
  schedule and membership; legacy pending/history snapshots still execute/parse/retry; new writes
  emit only the new shape; legacy manual broadcast contracts and tests are unchanged.
- Onboarding contracts/service/repository: required valid gender, atomic first insert with consent
  and activity, rollback, duplicate race, existing-client idempotency, unspecified backfill, and no
  gender field in admin update.
- Mini App: four-step navigation/back behavior, explicit gender selection, localized labels,
  disabled completion before selection, one typed onboarding submission, and error recovery.
- Admin: add/remove unique dimension controls, all combinations, migrated edit state, preview
  invalidation/counts, and validation/error accessibility.
- Regression and running verification: the existing automation suite plus one real preview/send
  per single dimension and the three-dimension intersection; root definition-of-done command remains
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

### Dependencies, resolved decisions, and out of scope

Dependencies are the current builder contracts/API/admin editor, client status/level/Telegram
identity, persisted `mini_app_last_access_at`, verified-session consented Mini App onboarding, and
the existing JSONB definition/run-snapshot stores. A schema migration and RU/SR/EN onboarding/admin
catalog additions are required. No trigger/message/history infrastructure change is required.

Resolved by revision 5:

- any non-empty combination of up to three unique dimensions is supported;
- dimensions intersect, while selected levels union;
- the rolling activity cutoff is inclusive and stays fixed at seven days;
- gender is collected only at onboarding and stored as male/female/unspecified;
- male/female filters include unspecified, while explicit unspecified is exclusive;
- preview and pre-send use current audience and eligibility truth;
- existing automations remain compatible and legacy manual broadcasts remain unchanged.

Out of scope for this amendment: arbitrary profile fields/operators, `OR` across dimensions,
additional gender values, gender inference, configurable activity windows, admin/client profile
gender editing, changes to legacy manual audiences, and any trigger/message/CTA/history redesign.

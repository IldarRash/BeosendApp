# Monthly schedule planner

## Goal

Replace the Excel-first monthly scheduling workflow with one server-owned admin plan per calendar
month. Managers compose multiple recurring group schedules in a month day-cell calendar, see
trainer/court/resource conflicts before exposure, then explicitly approve, generate hidden real
trainings, and publish only eligible non-past instances.

## Spec refs

- Factory workflow `WF-2026-07-31-feedback-to-backlog-01`, revision 5, ready package for the
  monthly schedule planner.
- Author-approved lifecycle and actions: `draft -> approved -> published`, with approve, generate,
  and publish as three separate actions in that order.
- `docs/architecture/overview.md`: the API owns transactions, validation, availability, and
  notifications; browser/bot clients render validated shared contracts.
- `docs/architecture/domain-model.md`: groups are recurring slots, trainings are concrete dated
  instances, and court blocks reserve courts for generated group trainings.
- `docs/architecture/database.md`: availability derives from active courts, pending/confirmed
  request occupancy, and court blocks; date/time values are stored separately.
- `apps/admin/PRODUCT.md` and `apps/admin/DESIGN.md`: use a dense, accessible operations workspace,
  keep server provenance visible, and keep domain calculations out of React.
- Current implementation anchors: `groupSchema`, `trainingSchema`, `courtLoadGridSchema`, court
  working-hours contracts, `POST /trainings/generate-all`, `GET /trainings/calendar`,
  `TrainingsCalendar`, `CourtLoad`, and the linked `court_blocks.group_training_id` invariant.
- The current tree has no `docs/product/feature-roadmap.md`; this brief scopes the ready workflow
  against current `origin/main` (`c084850`) docs and code rather than inventing a roadmap entry.

## Delivery sequence: smallest end-to-end slices

Each slice is independently reviewable but the feature is complete only after Slice 7.

1. **Shared monthly draft.** Add one plan per month, recurring templates, dated plan entries, typed admin CRUD, and
   a basic `/schedule-planner` month day-cell page. No generation or client-visible change.
2. **Resource-aware planning.** Materialize templates into dated plan entries on the server and return
   current trainer, court, rental/hold, manual-block, working-hours, and courtless-training
   diagnostics. The calendar renders the server result and every human-readable reason.
3. **Approval and generation.** Add explicit approval and one atomic generate action. Generate all
   dated entries, including past dates, as real hidden trainings with linked court blocks; any
   blocking diagnostic rolls back the entire action.
4. **Publication.** Add the separate publish action and training-level visibility. Publish only
   eligible dated entries today or later; past and ineligible rows stay hidden.
5. **Atomic propagation.** Allow schedule-field edits to already-generated entries, revalidate the
   whole affected month, and atomically update every linked training and court block, including
   past/completed rows, without changing status, attendance, bookings, or payment history.
6. **Post-change notifications.** Write a deduplicated durable outbox with immutable before/after
   snapshots in the propagation transaction, then notify the union of old/new trainers and every
   distinct eligible booked client through the existing Telegram boundary after commit.
7. **Interaction hardening and cutover.** Complete accessible conflict inspection, pending/error/
   stale-state behavior, localized copy, runtime verification, and admin cutover from the legacy
   generate modals while keeping legacy APIs compatible until a later removal slice.

## Contracts & tables

### New shared contracts

Add `packages/types/src/monthly-schedule-contracts.ts` and export it from the package index.

- `monthlySchedulePlanStatusSchema`: `draft | approved | published`.
- `monthlySchedulePlanSchema`: `id`, `year`, `month`, timezone (literal `Europe/Belgrade`),
  `status`, monotonically increasing `revision`, nullable `approvedRevision` and
  `generatedRevision`, `generatedAt`, `approvedAt/By`, `publishedAt/By`, `createdAt`, `updatedAt`,
  `templates`, and dated `entries`.
- `monthlyScheduleTemplateSchema`: `id`, `planId`, `groupId`, joined `groupName`/`levelName`,
  `daysOfWeek`, `startTime`, `endTime`, `trainerId`/`trainerName`, and nullable
  `preferredCourtId`/`preferredCourtNumber`.
- `createMonthlySchedulePlanSchema`: strict `{ year, month }`; timezone is server-owned.
- `createMonthlyScheduleTemplateSchema` and `updateMonthlyScheduleTemplateSchema`: strict
  schedule fields only. Group capacity/prices/status/visibility are not copied into editable UI
  input. An update must contain at least one field; `endTime` must be after `startTime`.
- `monthlyScheduleEntrySchema`: durable dated materialization with `id`, `planId`, `templateId`,
  group identity, date/time, trainer, preferred court, server-selected assigned court, linked
  `trainingId`, current `trainingStatus`, `hidden`, and diagnostics. Its UUID, not a persisted
  occurrence ordinal, is the mapping identity for a generated training.
- `monthlyScheduleDiagnosticCodeSchema` with stable codes at least for:
  `trainer-overlap`, `preferred-court-unavailable`, `assigned-court-occupied`,
  `court-request-confirmed`, `court-request-pending-hold`, `manual-court-block`,
  `training-court-block`, `outside-working-hours`, `no-active-court`, `court-unassigned`,
  `inactive-group`, `inactive-trainer`, `inactive-court`, `inactive-level`,
  `invalid-time-grid`, `entry-cardinality-changed`, `existing-training-collision`, and
  `source-changed`.
- `monthlyScheduleDiagnosticSchema`: `code`, `severity` (`blocking | warning`), human-readable
  localized-ready `message`, date/time, and nullable related `entryId`, `trainingId`, `courtId`,
  `requestId`, and `blockId`. `preferred-court-unavailable` is a warning only when a valid fallback
  court is assigned; an unassigned dated entry is blocking.
- `monthlySchedulePlanViewSchema`: plan, templates, dated entries, diagnostics, summary counts, and
  action eligibility (`canApprove`, `canGenerate`, `canPublish`). These flags and counts are
  server-decided.
- `monthlyScheduleConflictResultSchema`: strict `{ error: "monthly_schedule_conflict", planId,
  planRevision, conflicts, warnings }`. Write actions return all human-readable reasons in this one
  validated `409` response rather than failing on the first entry.
- `monthlyScheduleActionResultSchema`: refreshed plan view plus `createdTrainingIds`,
  `updatedTrainingIds`, `publishedTrainingIds`, and `remainingHiddenTrainingIds` as applicable.
- `monthlyScheduleNotificationDeliverySchema`: delivery and operation IDs, committed plan/month/
  revision, recipient kind and display identity, and a non-empty array of immutable entry changes.
  Each change stores group identity plus before/after date, time, trainer, and court display facts;
  delivery outcome, attempts, timestamps, and sanitized last error complete the admin shape.
  Recipient channel addresses remain API-internal.

Extend `trainingSchema` and admin-only calendar/detail shapes with:

- `hidden: boolean`, required on responses and defaulted by the database;
- nullable `monthlyScheduleEntryId` on admin-only shapes so the plan can prove provenance without
  exposing internal plan IDs on client paths.

### New tables

- `monthly_schedule_plans`
  - UUID primary key; `year`, `month`, timezone, lifecycle status, generated/approved/published
    timestamps and actor Telegram IDs, audit timestamps;
  - `revision integer not null`, nullable `approved_revision`, and nullable `generated_revision`;
    every accepted template mutation increments revision, approval records the approved revision,
    and generation/propagation records the revision materialized into trainings;
  - unique `(year, month)` so there is exactly one shared plan for a month;
  - generation is represented by `generated_at`, not by another lifecycle status.
- `monthly_schedule_templates`
  - UUID primary key and `plan_id` FK;
  - `group_id`, `days_of_week`, `start_time`, `end_time`, `trainer_id`, nullable
    `preferred_court_id`, audit timestamps;
  - unique `(plan_id, group_id)` for the first release: one recurring schedule per group in the
    shared monthly plan.
- `monthly_schedule_entries`
  - UUID primary key plus `plan_id` and `template_id` FKs;
  - the materialized local `date`, `start_time`, `end_time`, `trainer_id`, nullable
    `preferred_court_id`, nullable server-selected `assigned_court_id`, and audit timestamps;
  - unique `(template_id, date)` for the first release. Entries exist before training generation so
    conflicts, allocation, and later propagation operate on durable dated identities.

### Existing tables changed

- `trainings`
  - add `hidden boolean not null default false`; existing rows backfill/default to visible;
  - add nullable `monthly_schedule_entry_id` FK;
  - add a partial unique index on `monthly_schedule_entry_id` where non-null, making generation
    idempotent and enforcing one training per dated plan entry.
- `court_blocks`: no new field is needed. Continue using the unique non-null
  `group_training_id` link and update the complete court/date/time assignment with the training.
- `groups`, `trainers`, `levels`, `courts`, `court_requests`, `court_request_courts`, `bookings`,
  `waitlist`, and payment snapshot columns remain authoritative and are read or preserved as
  described below.
- `monthly_schedule_notification_deliveries`
  - one durable post-commit digest row per operation and recipient;
  - immutable JSON array of all affected entry changes for that recipient, copied plan month,
    `recipient_kind` (`trainer | client`), recipient ID and channel address, outcome
    (`pending | processing | sent | failed | ambiguous`), attempt count, retry/claim timestamps,
    last sanitized error, and audit timestamps;
  - unique `(operation_id, recipient_kind, recipient_id)` prevents duplicate delivery while keeping
    one recipient notification capable of describing several changed trainings.
- Existing `notifications` and notification-template persistence may also gain schedule-change
  types/keys for successful send logs and localized content. Do not overload
  `training-cancelled` or reminder semantics.

No conflict snapshot is persisted. Plan reads, generation, publication, and propagation evaluate
current database truth; persisted plan entries are intent, not cached availability.

## API

Create an admin-only `monthly-schedule-plans` API module. Authorization is enforced in the service
before reads/writes, following existing admin modules. Every response is parsed by shared Zod
contracts in the admin `ApiClient`.

| Method and path | Request | Response and behavior |
| --- | --- | --- |
| `GET /monthly-schedule-plans?year=&month=` | `year`, `month` | `monthlySchedulePlanViewSchema.nullable()`. Returns templates, durable dated entries, current allocations, and diagnostics; does not mutate. |
| `POST /monthly-schedule-plans` | `createMonthlySchedulePlanSchema` | Idempotently creates or returns the one shared draft/plan for that month. |
| `POST /monthly-schedule-plans/:id/templates` | `createMonthlyScheduleTemplateSchema` | Adds one group recurrence before generation, materializes its dated entries, increments plan revision, and returns the refreshed view. |
| `PATCH /monthly-schedule-plans/:id/templates/:templateId` | `updateMonthlyScheduleTemplateSchema` | Last-write-wins template update. Before generation it rematerializes dated entries; after generation it invokes atomic propagation across every mapped entry/training. |
| `DELETE /monthly-schedule-plans/:id/templates/:templateId` | no body | Removes a template and its ungenerated entries only before generation; generated template membership is immutable. |
| `POST /monthly-schedule-plans/:id/approve` | no body | `draft -> approved`; records actor/time and `approvedRevision=revision`. Structural validity is required, but resource diagnostics remain visible and are rechecked by generation. |
| `POST /monthly-schedule-plans/:id/generate` | no body | Approved-only with `approvedRevision=revision`, one transaction, creates one hidden training for every dated entry including past dates plus an exact linked court block and records `generatedRevision=revision`. Past rows start `completed`; today/future rows start `open`. Any blocking diagnostic returns all reasons and writes nothing. |
| `POST /monthly-schedule-plans/:id/publish` | no body | Generated approved-only. Revalidates current eligible entries, then atomically changes plan to `published` and flips `trainings.hidden=false` only for eligible date-today-or-later rows. Returns published and remaining-hidden IDs. |
| `GET /monthly-schedule-plans/:id/notification-deliveries` | optional outcome filter | Admin-only `monthlyScheduleNotificationDeliverySchema[]` for post-propagation delivery, retry, and ambiguous outcomes. |

HTTP behavior:

- `400` for malformed fields, invalid time order/grid, or structurally empty approval.
- `403` for non-admin access before repository mutation.
- `404` for missing plan/entry or referenced group/trainer/court.
- `409` with `monthlyScheduleConflictResultSchema` for lifecycle mismatch, stale source/reference
  state, resource conflict, post-generation membership change, or entry-cardinality change. Codes
  remain machine-stable while every item includes its human-readable message and related resource
  IDs. Plan revision mismatch alone is never a conflict; retry serialization failures internally,
  revalidate, and let the later valid commit win.
- Action endpoints are safe against double submission: generation is protected by the plan row
  lock and unique training-to-entry link; publish returns the already-published current view without
  duplicating domain events.
- Do not require `If-Match` or reject solely on `updatedAt`. Lock the plan/affected dates and
  serialize writes; if two valid edits race, the later committed edit is the final value.

Legacy `POST /trainings/generate`, `POST /trainings/generate-all`, and
`GET /trainings/generation-status` remain compatible during rollout. Until admin cutover, legacy
generation must explicitly insert `hidden=false`; it must not create planner provenance or change
planner lifecycle. The new admin page must not call these endpoints after cutover.

## Admin flow

Add `/schedule-planner` under the Schedule navigation group. The exact visual treatment belongs to
`ui-designer`; required behavior is:

1. Admin selects a month. If no plan exists, `Create monthly plan` creates the single shared draft.
2. Admin adds multiple existing active groups and edits each recurring template's weekdays, time, trainer,
   and preferred court in the plan workspace.
3. The primary surface is a month day-cell calendar. Each dated entry shows group, time, trainer,
   preferred/assigned court, lifecycle/visibility state, and a non-color-only conflict/warning
   marker. A selected day/entry opens all server messages and related resource context.
4. Context includes trainer overlaps, the preferred and selected court occupancy, confirmed
   rentals, pending request holds, manual blocks, other training-linked blocks, effective working
   hours, and real courtless trainings already on that date. The browser never derives conflicts
   by comparing chips.
5. `Approve plan`, `Generate hidden trainings`, and `Publish eligible trainings` are distinct
   primary actions, shown only in their server-decided order. Each destructive/material action has
   confirmation copy explaining its exact effect and summary counts.
6. A draft may be saved with conflicts. Generation remains disabled only as an affordance; the API
   always rechecks and returns the complete reason list. The conflict drawer stays open after a
   failed action.
7. After generation, add/remove template controls are unavailable. Editing recurring template fields
   submits one atomic propagation request and does not optimistically move calendar events.
8. After publication, the calendar distinguishes published eligible trainings from permanently
   hidden past/ineligible rows. It never presents plan lifecycle as synonymous with training
   visibility.

Loading, empty, offline/API error, mutation-pending, conflict, and refetch states must retain the
selected month and visible context. RU/SR/EN strings, keyboard navigation, focus restoration,
screen-reader labels, reduced motion, horizontal safety, and non-color-only statuses are required.

## Bot flow

There is no bot command for creating, approving, generating, publishing, or editing a monthly plan.

- Every client/public exposure path must exclude `trainings.hidden=true`, including available and
  public schedule reads, training/client detail, participant preview, booking selection, client
  calendars/My Bookings, broadcasts/automations, calendar feeds, and connector projections. Admin
  list/calendar/detail/planner reads remain visibility-agnostic.
- Publishing makes only eligible non-past rows available through existing client schedule and
  booking flows; past hidden rows never become bookable or visible.
- Trainer `today`/`upcoming` and direct trainer notifications are internal staff surfaces and may
  include assigned hidden trainings; they must label schedule changes clearly and must not expose
  client-private data beyond existing trainer permissions.
- Training-created broadcast automation events are not emitted at hidden generation. Emit the
  existing event only after publication for rows that actually became public, preventing
  pre-publication broadcasts.
- After a generated-plan propagation commit, the union of old/new assigned trainers and distinct
  eligible booked clients receive localized direct Telegram notifications from the durable outbox.
  This is delivery behavior, not an interactive bot flow.

## Invariants

### Lifecycle and visibility

- Exactly one plan exists per `(year, month)` in `Europe/Belgrade`.
- Plan lifecycle is only `draft -> approved -> published`; `generatedAt` and revision metadata
  record the separate generation action. `trainings.hidden` is the concrete publication property;
  plan publication timestamps are audit metadata and never replace that boolean.
- Approve, generate, and publish cannot be collapsed into one endpoint or UI action.
- Every accepted template change increments `revision`. Approval sets `approvedRevision=revision`;
  generation sets `generatedRevision=revision`. Before generation, changing an approved plan
  returns it to `draft`, clears approval metadata/revision, and requires another explicit approval.
  A generated approved or published plan remains editable through atomic propagation without
  lifecycle demotion; successful propagation advances `generatedRevision` to the new revision while
  retaining the last explicit `approvedRevision` as audit history.
- Generation includes every dated entry in the target Belgrade calendar month, including dates
  before today. It creates real rows with existing group capacity/trainer semantics,
  `bookedCount=0`, and `hidden=true`; past rows start `completed`, while today/future rows start
  `open`. Hidden past accounting rows therefore cannot enter booking, reminder, or public broadcast
  semantics.
- Publication exposes only generated rows dated today or later that satisfy existing public
  eligibility (active/non-hidden group, active trainer and level, non-terminal training) and have
  no blocking resource conflict. Past rows remain hidden forever through the publication action.
- On an edit to a published plan, visibility is recomputed from published lifecycle and current
  eligibility: a row moved into the past becomes/stays hidden; an eligible row moved to today or
  later remains public. A past training is never published.

### Conflict and resource ownership

- Draft/template save does not require conflict freedom. Generate and post-generation propagation are
  all-or-nothing and blocked by any blocking diagnostic; publish revalidates every row it would
  expose before changing visibility.
- Conflict evaluation uses half-open intervals `[startTime, endTime)` and the effective
  `Europe/Belgrade` local date. Adjacent intervals do not overlap.
- A trainer cannot be assigned to overlapping dated entries or overlapping existing real
  trainings, including individual, hidden, past, and terminal rows when those rows represent the
  same historical time. The entry's own linked training is excluded on propagation.
- Every dated entry must be inside the date's effective court working hours and use the established
  30-minute grid.
- Court selection reuses the current preference rule: active preferred court when free; otherwise
  lowest-numbered active free court. A fallback is shown explicitly. No assignable court is a
  blocking `court-unassigned` conflict; the planner never generates a courtless training.
- Court occupancy includes pending and confirmed `court_request_courts`, manual `court_blocks`,
  training-linked blocks, and earlier dated entries in the same transaction. Rejected/cancelled
  requests do not occupy. Current linked blocks are excluded during propagation validation.
- Existing courtless trainings are returned as planning context. They do not invent court
  occupancy, but still participate in trainer-overlap and other applicable training constraints.
- Generation and propagation lock the plan row first, then every affected date in sorted order
  through the existing advisory date-lock seam, then affected training rows. Inside that
  transaction they materialize the complete candidate state and aggregate every conflict before
  the first domain write; only a conflict-free candidate proceeds to one atomic commit.

### Atomic propagation and history

- A generated training maps one-to-one to its durable `monthly_schedule_entries.id`. Template edits
  rematerialize the candidate dated set and retain existing entry IDs by chronological mapping.
  They may change dates, times, trainer, and preferred/assigned court only when every existing
  generated entry remains mapped one-to-one; otherwise `entry-cardinality-changed` blocks the whole
  edit. No persisted occurrence ordinal is part of the mapping contract.
- Post-generation plan membership is immutable in this release. Adding/removing a recurring group
  after generation is rejected; managers edit concrete post-publication exceptions through the
  existing training edit flow.
- Propagation updates all linked month trainings, including past, cancelled, and completed rows.
  It may update only date, start/end, trainer, and the linked court block's complete
  court/date/start/end assignment.
- Training ID, status, capacity, booked count, client/group ownership, attendance, bookings,
  waitlist, payment status, immutable price snapshots, and all audit/history rows are preserved.
  No booking is recreated, cancelled, or repriced.
- One blocker for any dated entry rolls back the template/entry change, every training update, and every
  court-block move. The response contains all reasons found from the validated candidate state.
- Last-write-wins does not weaken integrity: a later edit must still pass current validation and
  commit atomically. UI optimistic updates do not decide the winner.
- There are no per-date exceptions in the planner before publication. After publication, one-off
  exceptions use the existing concrete-training edit endpoint and are not written back into the
  recurring plan.

### Notifications and side effects

- Successful hidden generation sends no client notification and emits no public
  `training-created` event.
- Successful propagation commits plan/template/entry/training/block writes and durable outbox rows
  in the same transaction. The trainer audience is the union of distinct old and new assigned
  trainers; the client audience is every distinct client with an affected seat/history
  booking status (`pending`, `booked`, `attended`, or `no_show`); exclude cancelled/waitlist-only
  rows and deduplicate recipients across entries and the committed plan revision.
- Every outbox row contains immutable before/after snapshots sufficient to render the exact change
  after commit without rereading mutable training state. Notification content states the affected
  group/month and changed date/time/trainer/court facts in
  the recipient's locale. It does not mutate bookings or expose another client's data.
- A post-commit worker claims outbox rows idempotently. Definite failure follows bounded retry;
  ambiguous Telegram outcomes remain `ambiguous` and are not blindly resent. Delivery failure never
  rolls back the committed schedule. Record/log each attempt through the existing notification
  boundary, sanitize diagnostics, and make partial failure visible in admin follow-up state.
- Publication emits public creation events only for rows whose `hidden` flag changed to false.
  Connector/automation failure follows the existing post-commit safe-enqueue rule and does not
  revert publication.

## Acceptance criteria

- An authenticated admin can create one draft for a selected month and add several recurring group
  entries; a repeated create returns that same unique monthly plan without duplicating it.
- The month day-cell calendar shows every materialized dated entry and current trainer/court assignment,
  plus all human-readable diagnostics for trainer overlap, preferred/assigned court occupancy,
  rentals, pending holds, blocks, working hours, inactive resources, and courtless trainings.
- A conflicted draft saves successfully and reloads with current diagnostics.
- Approve changes only the plan lifecycle. Generate remains a distinct confirmed action and is
  accepted only for an approved plan.
- Generate with one or many conflicts returns all blocking reasons and creates no training, block,
  lifecycle, or timestamp partial state.
- Successful generation creates every dated entry for the month, including past dates, in one
  transaction; every created training is hidden, linked uniquely to its entry, and has exactly one
  matching linked court block. Past rows are `completed`; today/future rows are `open`.
- Repeating generation or double-clicking cannot duplicate trainings or blocks.
- Before publication, hidden planned trainings are absent from client schedule, available slots,
  participant public preview, booking selection, client calendars, and creation-triggered
  broadcasts.
- Publish is a separate action, revalidates current truth, marks the plan published, and exposes
  only eligible rows dated today or later. Past and ineligible rows remain hidden and are reported.
- Editing an ungenerated approved plan increments revision and demotes it to draft. Editing a
  generated approved or published template with a complete one-to-one entry mapping keeps its
  lifecycle and atomically updates every linked row in the month, including past/completed rows,
  complete court-block assignments, and `generatedRevision`.
- A generated edit that breaks entry mapping/cardinality, collides with trainer/court/resources, targets an
  inactive reference, or loses a concurrent race returns complete reasons and changes nothing.
- After successful propagation, IDs, statuses, attendance, bookings, waitlist rows, payment state,
  and price snapshots are byte-for-byte/domain-equivalent except for allowed schedule/resource
  fields.
- The propagation transaction durably writes deduplicated outbox rows for the union of old/new
  trainers and distinct eligible booked clients with immutable before/after snapshots. Post-commit
  delivery, retry, and ambiguous outcomes never revert schedule data or duplicate recipients.
- Two admins can edit without an optimistic-concurrency rejection; the later valid committed edit
  is reflected after refetch.
- The admin never computes conflicts, fallback courts, eligibility, published counts, or lifecycle
  transitions locally; malformed API responses are rejected by the shared contracts.
- Existing concrete-training edit remains the path for post-publication date exceptions. Existing
  non-planner trainings and legacy generation APIs continue to parse and behave as before during
  rollout.
- The planner is usable at desktop and narrow widths with keyboard-only navigation, visible focus,
  localized RU/SR/EN copy, non-color-only conflict states, stable pending controls, and readable
  long reason lists.

## Tests

### Shared contracts

- Parse every lifecycle, revision field, template, dated entry, diagnostic, action flag, conflict
  envelope, outbox outcome, and action response.
- Reject invalid month/year, non-Belgrade timezone, empty weekdays, invalid/unaligned/reversed time,
  duplicate group entry, unknown diagnostic code, malformed conflict payload, and partial schedule
  update.
- Require `hidden` on training responses and keep planner provenance off client-facing schemas.

### Database and repositories

- Migration/default coverage: old trainings become `hidden=false`; nullable provenance remains
  valid; one plan per month, one template per plan/group, one dated entry per template/date, and one
  training per entry are enforced.
- The unique training-to-entry provenance prevents duplicate generation under concurrent requests.
- Repository reads materialize deterministic Belgrade dates and return active/inactive references,
  existing real trainings, bookings, request occupancy, court blocks, and working hours needed for
  one validation pass.
- Propagation updates only allowed training columns and the full linked block assignment; snapshots,
  payment, booking, waitlist, attendance, status, and counts remain unchanged.
- Outbox repository tests prove immutable before/after snapshots, plan-revision dedupe, safe claims,
  bounded retry, and no automatic resend after an ambiguous outcome.

### API services/controllers

- Admin authorization is rejected before reads/writes on every planner endpoint.
- Lifecycle matrix: create, approve, generation required before publish, invalid/repeated actions,
  pre-generation edit demotion, and immutable post-generation membership.
- Template materialization includes past dates and handles a Belgrade DST month without UTC date drift.
- Complete diagnostics cover plan-plan and plan-existing trainer overlap, preferred-court fallback,
  confirmed rental, pending hold, manual block, training block, inactive resource, outside hours,
  no active/free court, courtless training context, and current-block exclusion.
- Conflict responses aggregate all reasons. Generate/publish/propagate failures prove transaction
  rollback with zero partial rows/visibility/block moves.
- Successful generation creates past `completed` and today/future `open` hidden rows plus one block
  each; rerun and concurrent generation remain idempotent.
- Every public/client repository, service, connector, automation, bot, and Mini App projection
  excludes hidden rows; admin reads remain visibility-agnostic. Legacy generation explicitly writes
  visible rows until cutover.
- Publish exposes today/future eligible rows only, leaves past/ineligible hidden, and emits creation
  events only for newly visible rows.
- Propagation covers date, time, trainer, and court changes across open/full/cancelled/completed and
  past/future rows; broken entry mapping/cardinality and all resource blockers reject atomically.
- Two serialized valid edits demonstrate last-write-wins. A later invalid edit is rejected rather
  than overwriting a valid plan.
- Notification recipient selection deduplicates the union of old/new assigned trainers and
  active/history booked clients, excludes cancelled/waitlist-only recipients, persists immutable
  snapshots, localizes content, and treats retry/ambiguous/send failures as post-commit outcomes.

### Admin

- Route/navigation, no-plan creation, multi-entry editing, month switching, and server-refetch
  preservation.
- Day-cell rendering for dated entries, fallback assignment, hidden/published state, long diagnostics,
  courtless context, and same-day multiple groups.
- Approve/generate/publish controls follow server action flags and remain separate; confirmation,
  double-submit prevention, complete conflict rendering, and retry/refetch behavior are covered.
- Generated membership controls are disabled; propagation waits for the API and does not
  optimistically move chips.
- Accessibility tests cover calendar semantics, accessible dated-entry names, keyboard traversal,
  focus restoration, alert/live regions, and non-color-only status.
- Admin `ApiClient` tests validate every new request/response and reject malformed planner payloads.
- Existing `Trainings`, `TrainingsCalendar`, `CourtLoad`, bot, Mini App, broadcast automation,
  booking, attendance, and subscription regression suites remain green.

### Verification gates

- Run focused types, DB, API, admin, bot, Mini App, notifications, and automation tests throughout
  the slices.
- Run the repository definition of done: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm build` across all workspaces, including `@beosand/admin`.
- Run authenticated local API/admin verification with seeded conflicts and inspect the actual DB
  rows before/after generate, publish, successful propagation, and rejected propagation.

## Dependencies

- Existing group, trainer, level, court, training, booking, waitlist, notification, and admin-auth
  modules.
- Existing `monthTrainingDates`, time/grid helpers, court working-hours resolution, date locks,
  court occupancy repositories, linked-block update path, and public schedule eligibility rules.
- Existing admin month-calendar primitives and Dispatch Desk design system; `ui-designer` owns the
  final interaction/visual composition before frontend implementation.
- New DB migrations for plans, templates, dated entries, training visibility/provenance, and the
  notification outbox must land with the new contracts and backend foundation before admin wiring.
- Slice dependencies are sequential: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7. Independent contract/UI
  tests may be developed alongside their owning slice, but schema/migration and planner lifecycle
  files must not be edited concurrently by multiple implementers.

## Decisions & assumptions

- The ready package has no unresolved protected decision; exact visual treatment is delegated to
  design.
- One shared plan means one row per month for the whole school, not one plan per group or manager.
- One group has one recurring template in the first release. Multiple weekly days belong to that
  template; durable `monthly_schedule_entries` hold its dated materialization.
- `Europe/Belgrade` is stored/returned for audit clarity and is not admin-selectable.
- Approval records intent and structural completeness but does not freeze a stale availability
  snapshot. Generation and publication always use current resource truth.
- The current active-court preference/fallback rule is retained, but unlike legacy generation the
  planner treats absence of a court and outside-working-hours placement as blocking.
- Past generated rows start `completed` with zero booked and remain hidden; today/future rows start
  `open` and hidden. Publication never changes past status/visibility merely because the plan is
  published.
- Pre-generation edits invalidate approval. Post-generation schedule edits preserve the current
  approved/published lifecycle because the concrete rows are updated in the same atomic operation.
- Durable dated entry IDs are the one-to-one training mapping. Chronological rematerialization may
  retain those IDs only when every generated entry remains mapped; membership/cardinality changes
  after generation require a future explicitly designed history policy and are blocked here.
- “All booked clients” means distinct clients with `pending`, `booked`, `attended`, or `no_show`
  bookings on affected trainings. Cancelled and waitlist-only clients are excluded.
- “Assigned trainers” means the union of every distinct trainer assigned before or after the change,
  so a removed/replaced trainer is informed too. Notification to a trainer without a linked
  Telegram identity is durably recorded/reported as unavailable, not redirected to an unrelated
  admin.
- Today is non-past. Eligibility and day boundaries are evaluated in Belgrade time, not with
  `new Date().toISOString().slice(0, 10)`.

## Out of scope

- Excel import/export, spreadsheet synchronization, file downloads, OAuth, calendar-feed changes,
  or another external handoff format.
- Individual-training planning, court-rental creation/moderation, pricing, capacity, subscription,
  booking, waitlist, attendance, or payment-policy changes.
- Per-date exceptions inside an unpublished plan; arbitrary deletion/cancellation of generated
  history; post-generation group membership/cardinality changes.
- Automatic approval, generation, publication, or scheduled background publication.
- Client-facing planner screens or bot commands, optimistic client availability calculations, and
  broad redesign of existing Trainings/CourtLoad pages.
- Removal of legacy generation endpoints in the first rollout.

## Rollout & compatibility

- Land additive schema/contracts and backend module first. The migration defaults existing
  trainings to visible and leaves provenance null, so legacy reads/writes remain compatible.
- Keep the planner route behind normal admin authorization. A temporary application feature flag is
  optional only if operations require staged exposure; lifecycle correctness must not depend on it.
- Cut the admin over to `/schedule-planner` after Slices 1-7 verify. Remove/hide the legacy generate
  modals from the admin UI, but retain legacy endpoints until production evidence shows no caller
  uses them; removal requires a separate compatibility brief.
- Production verification uses a non-public future month and a month containing past dates. Seed or
  identify examples for every occupancy kind, confirm draft diagnostics, then inspect transactional
  DB results for generation/publication/propagation. Do not publish real user-facing trainings as a
  smoke test without just-in-time authorization.
- Observe conflict rate, generation transaction failures, notification delivery outcomes, and
  hidden/public counts after release. No automatic data rewrite of existing groups/trainings is
  performed.

## Selected-role handoff

- `architect` first: finalize transaction/lock order, diagnostic aggregation query shape, lifecycle
  state machine, migration/backfill, visibility query inventory, and post-commit side-effect seams.
- `backend-implementer`: owns `packages/types`, `packages/db`, and the new/changed `apps/api` planner,
  training visibility, conflict, propagation, and notification integration. Implement contracts and
  schema before service/controller wiring.
- `ui-designer`: owns the `/schedule-planner` month day-cell interaction, conflict inspection,
  lifecycle action hierarchy, responsive/accessibility behavior, and compatibility with the current
  Dispatch Desk design system.
- `frontend-implementer`: owns the admin route, typed `ApiClient`, React Query hooks, page/components,
  localized rendering, and removal of legacy generation entrypoints after backend contracts settle.
- `test-writer`: adds focused shared-contract, DB invariant, API transaction/concurrency,
  visibility, notification, admin interaction, bot/Mini App regression, and unsafe-path coverage.
- `reviewer`: reviews slice-by-slice and final correctness, especially lifecycle/action separation,
  complete conflict reporting, history preservation, LWW behavior, and legacy compatibility.
- `security-reviewer`: required because this changes admin authorization, user visibility,
  availability/resource integrity, bookings/payment-linked history preservation, and outbound
  notifications.
- `app-runner`: verifies the authenticated admin/API/DB flow with real generated rows and resource
  conflicts, then runs the full repository gates.
- `github-bot` only when the root workflow requests issue/branch/PR/CI handoff. `deployer` only with
  explicit rollout authorization; public publication or production data mutation remains a
  protected action.

# Feature: Mini App training detail, calendar export, and admin court fixes

## Goal

Ship one end-to-end usability slice across the Mini App and admin console: clients open the same
training detail from calendar and My bookings, can export one booked training or all booked trainings
for a month, and admins can edit a training's time/court without hidden court conflicts or confusing
court state in the load grid.

Implementation is blocked until the user approves this plan. After approval, `github-bot` creates the
issue/project/worktree before implementation agents start.

## Spec refs

- `docs/product/feature-roadmap.md`: shipped Mini App calendar, My bookings, waitlist, connectors,
  admin trainings, and court load surfaces.
- `docs/architecture/overview.md`: API is the source of truth; UI apps validate shared Zod contracts
  and do not compute domain rules.
- `docs/architecture/domain-model.md`: trainings, bookings, waitlist, court blocks, court requests,
  and client-facing narrowed roster shapes.
- `docs/architecture/database.md`: `trainings`, `bookings`, `waitlist`, `courts`, `court_blocks`,
  `court_requests`, `court_request_courts`; repositories remain the only DB access layer.
- Historical briefs: `miniapp-calendar-training-context.md`, `miniapp-my-bookings.md`,
  `connectors.md`, `court-30min-granularity.md`, `group-court-scheduling.md`,
  `roster-avatars-and-confirm-visibility.md`.

## Contracts & Tables

- `packages/types/src/training-contracts.ts`
  - Add `clientTrainingDetailSchema` for a client-scoped training detail.
  - Add `calendarExportMonthQuerySchema` for `year` and `month`.
  - Add `updateTrainingScheduleCourtSchema` for atomic admin single-training schedule/court edits:
    optional `startTime`, `endTime`, `courtId`, strict, at least one actual field, and
    `endTime > startTime` when time is present.
  - Extend admin-only `trainingCalendarItemSchema` with `courtId: uuid.nullable()` while keeping
    `courtNumber`.
- Reuse existing contracts:
  - `trainingParticipantsSchema` for privacy-narrowed participants and waitlist.
  - `bookingSchema` / `myBookingItemSchema` for cancel and My bookings refresh.
  - `courtLoadGridSchema` / `courtLoadCellSchema` for court load; no API shape change required for
    visual separation if existing `requestId`, `trainingId`, and `blockId` are reliable.
- Tables touched:
  - Reads: `trainings`, `groups`, `levels`, `trainers`, `bookings`, `waitlist`, `clients`,
    `court_blocks`, `courts`, `court_requests`, `court_request_courts`.
  - Writes: `bookings` only through existing cancel path; `trainings` and linked `court_blocks`
    through the new admin atomic schedule/court mutation.
  - No planned DB migration. There is no existing free-text training description column; this slice
    renders a server-owned detail summary from existing fields and keeps `description: null` hidden
    until a separate content-field feature is approved.

### `clientTrainingDetailSchema`

Server-owned, Mini App only, never exposes another client's id/full name or court id:

- `trainingId`, `date`, `dayOfWeek`, `startTime`, `endTime`
- `trainingContextLabel`, `description: string | null`
- `trainerName`, `levelName`, `courtNumber: number | null`
- `bookingStatus: BookingStatus | null`, `trainingStatus: TrainingStatus`
- `viewerRelation: "none" | "booked" | "waitlisted" | "past"`
- `bookingId: uuid | null`, `groupSubscriptionId: uuid | null`
- `canCancel: boolean`, `exportEligible: boolean`
- `waitlistPosition: number | null`
- `participants: TrainingParticipants`

## API

- `GET /trainings/:id/client-detail`
  - Auth: verified Mini App client session via the existing client-session bridge.
  - Request: path `id = uuid`.
  - Response: `clientTrainingDetailSchema`.
  - Behavior: returns detail for visible training rows and the caller's own booked/waitlisted/past
    rows. Participants and waitlist are privacy-narrowed. Cancellation eligibility and export
    eligibility are server-computed.

- `POST /bookings/:id/cancel`
  - Existing endpoint reused from the detail action.
  - Detail refetches after success or conflict. Server remains authoritative for single-date cancel,
    status recompute, and monthly batch preservation.

- `GET /bookings/mine/calendar-export?year=YYYY&month=M`
  - Auth: verified Mini App client session.
  - Request: `calendarExportMonthQuerySchema`.
  - Response: `text/calendar; charset=utf-8` ICS attachment/body.
  - Behavior: includes only the caller's confirmed booked trainings whose training date is in the
    requested month. Default excludes waitlist entries, cancelled bookings, and cancelled trainings.

- `PATCH /trainings/:id/schedule`
  - Auth: admin/manager only via existing `x-telegram-id` admin guard.
  - Request: `updateTrainingScheduleCourtSchema`.
  - Response: admin `TrainingCalendarItem` with `courtId` and `courtNumber`.
  - Behavior: atomically applies effective time and/or court for one training. It locks the training
    and relevant date/court rows, excludes the training's own auto-block from conflict checks, allows
    adjacent half-open `[end == start]` ranges, rejects conflicts with another training auto-block,
    manual block, confirmed court request, or pending hold, and never partially updates.

- Existing admin endpoints remain:
  - `PATCH /trainings/:id/time`, `PATCH /trainings/:id/time-series`, and `PATCH /trainings/:id/court`
    can stay for older UI flows, but this slice's single-training edit modal should use
    `PATCH /trainings/:id/schedule` for combined time+court edits.

## Mini App Flow

- Calendar booked rows and My bookings rows both open the same `TrainingDetail` screen/sheet.
- Detail shows the server-owned summary: context label, date/time, trainer, level/type, safe court
  number when available, current viewer status, participants, and waitlist.
- For future own bookings with `canCancel = true`, detail shows a cancel action and confirm step. Past
  trainings remain viewable and cannot be cancelled.
- Single-training export uses the existing Google Calendar URL helper from validated detail fields.
  `exportEligible` controls whether the button is shown. Past booked trainings can still be exported;
  cancelled trainings are excluded unless already returned as historical booked rows with
  `exportEligible = true`.
- Monthly export is available from My bookings first. The user selects or uses the currently selected
  month, taps export, and the app fetches `GET /bookings/mine/calendar-export`. Calendar screen access
  is optional follow-up within the same contracts.
- Waitlisted trainings remain visible with waitlist position where available, but are excluded from
  monthly export by default.

## Admin Flow

- Admin opens a training edit modal from the trainings list/calendar.
- The Court field is seeded with the current `courtId`/`courtNumber` when present. It must not show
  "No changes" as the selected value for a training that already has a court.
- If the admin changes only time, only court, or both time and court for one training, the UI sends one
  atomic `PATCH /trainings/:id/schedule` request.
- If the effective target court/time conflicts with another occupancy source, the API returns `409`
  with a clear message. The modal keeps the draft and does not display a false success.
- Court load grid keeps the existing legend but visually separates adjacent cells by event identity:
  same `state` plus different `requestId`/`trainingId`/`blockId` gets a visible divider; adjacent cells
  for the same event may remain visually connected.

## Bot Flow

None in this slice. Telegram bot behavior and bot calendar feeds stay unchanged.

## Invariants

- Mini App and admin do not compute capacity, waitlist eligibility, cancelability, export membership,
  court availability, or conflicts. They render API decisions.
- Client identity is numeric Telegram id resolved by the Mini App session bridge. Client detail and
  monthly export are self-scoped; no client id is accepted for those reads.
- Client-facing roster/waitlist rows stay narrowed via existing participant/member helpers; no other
  client's id or full name is returned.
- Monthly export includes only the caller's own confirmed booked trainings for the selected month;
  waitlist is excluded by default.
- Single-date cancellation keeps existing booking invariants: one booking row cancelled, booked count
  recomputed, `full -> open` possible, monthly subscription siblings untouched.
- Admin schedule/court write is server-authoritative and atomic. Conflicts are checked against
  training auto-blocks, manual court blocks, confirmed court requests, and pending holds. Own block is
  excluded; adjacent end-exclusive ranges do not conflict.
- Court load visual separation is based on event identity, not just color/status, so two different
  adjacent events cannot read as one continuous event.
- Secrets and connector credentials stay server-side. Google one-event URLs and ICS output contain
  event data only, not connector secrets.

## Acceptance Criteria

- From Calendar and My bookings, the same training opens the same detail UI and displays the same
  validated fields.
- Detail shows participants and waitlist using narrowed client-facing shapes.
- Future booked rows with `canCancel = true` can be cancelled from detail; past rows show no cancel
  action.
- Cancelling from detail refetches detail, My bookings, and calendar state without breaking the
  existing My bookings screen.
- One-training Google export uses validated detail data and is unavailable when the server says the
  row is not export-eligible.
- Monthly export from My bookings returns an ICS file containing only the caller's booked trainings in
  the chosen month; waitlisted, cancelled, foreign, and out-of-month trainings are absent.
- Admin edit modal seeds Court with the current court, not an empty "No changes" placeholder.
- Single-training time+court edits are saved through one atomic API call and either fully apply or
  fail with no partial update.
- A conflicting admin edit returns a clear 409 and leaves the original training/court occupancy intact.
- Adjacent court-load cells for different event ids have a visible divider while same-event cells can
  remain connected; the legend remains readable.

## Tests

- Contract tests:
  - `clientTrainingDetailSchema` accepts the intended shape and rejects leaked `clientId`/`fullName`.
  - `calendarExportMonthQuerySchema` coerces/validates month bounds.
  - `updateTrainingScheduleCourtSchema` rejects empty body, stray fields, and `endTime <= startTime`.
  - `trainingCalendarItemSchema` requires/parses admin-only `courtId`.
- API tests:
  - Client detail resolves the caller from Mini App session, returns booked/waitlisted/past relations,
    narrowed participants/waitlist, `canCancel`, `bookingId`, and waitlist position.
  - Client detail rejects/omits unauthorized private data and does not expose court ids.
  - Monthly export includes only own booked trainings in month and excludes waitlist/cancelled/foreign
    rows.
  - Existing cancel path still cancels one booking only, recomputes count/status, and preserves
    monthly-batch siblings.
  - `PATCH /trainings/:id/schedule` accepts valid time-only, court-only, and combined time+court
    changes; excludes self-conflict; allows adjacent ranges; rejects another training/block/request/
    hold conflict with 409; does not partially update.
- Mini App tests:
  - Calendar row and My bookings row open the same detail component for the same `trainingId`.
  - Detail renders participants, waitlist, status, cancel action only from `canCancel`, and export
    action only from `exportEligible`.
  - Monthly export call uses selected year/month and handles blob/text-calendar response errors.
  - My bookings behavior and status tabs stay intact.
- Admin tests:
  - ApiClient parses `courtId` in admin training responses and validates schedule patch responses.
  - Edit modal seeds current court, sends one combined schedule request for time+court changes, and
    shows API 409 errors without closing as success.
  - CourtLoad renders dividers for adjacent same-state cells with different event keys and connects
    same-event spans.
- End-to-end/run checks:
  - Full AGENTS.md gate after implementation: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`,
    including `@beosand/admin`.
  - App runner verifies Mini App detail/export and admin conflict behavior in a running stack, or
    documents a precise blocker.

## Dependencies

- Existing Mini App calendar and My bookings screens, hooks, and `google-calendar-link.ts`.
- Existing Mini App session bridge and self-scoped booking endpoints.
- Existing `trainingParticipantsSchema` and narrowed member helpers.
- Existing connector calendar/feed helpers for ICS formatting where reusable.
- Existing court occupancy helpers: `timeRangesOverlap`, `courtSlotsCovered`, `courtFreeForSlots`,
  and court load grid cell ids.
- Existing admin trainings and court load hooks/pages.

## Open Questions With Defaults

- Should this add a new DB field for free-text training descriptions? Default: no. Use existing
  server-owned fields for the detail summary and expose nullable `description`; hide it when null.
- Should monthly export include waitlist entries? Default: no. Export only confirmed booked trainings.
- Should monthly export be available from Calendar too? Default: My bookings first; Calendar entry is
  optional if it is cheap after the shared export hook exists.
- Should past booked trainings be exportable one-by-one? Default: yes, if the row is returned as a
  historical own booking and `exportEligible = true`.
- Should admin series reschedule also support atomic time+court edits? Default: no. This slice covers
  a single training; existing series time semantics stay unchanged.
- Should the old separate admin time/court endpoints be removed? Default: no in this slice. Add the
  combined endpoint and move the edit modal to it; cleanup can follow after call sites are stable.
- What conflict text should the API return? Default: clear generic message naming the conflict class
  (`court is already occupied for this time`) without exposing client private data.

## Agent Subtasks

- `github-bot` after user approval: create the GitHub issue in the correct project and prepare a
  dedicated worktree. Do not run before approval.
- `backend-implementer`: add contracts in `packages/types`; add `GET /trainings/:id/client-detail`,
  `GET /bookings/mine/calendar-export`, and `PATCH /trainings/:id/schedule`; wire service/repository
  reads and atomic conflict checks; no DB migration expected unless implementation proves an existing
  column is missing.
- `frontend-implementer` for Mini App: add ApiClient/hook methods, reusable `TrainingDetail`
  component/screen, Calendar/My bookings navigation into detail, detail cancel refetch, one-event
  Google export, and monthly ICS export from My bookings.
- `frontend-implementer` for admin: add `courtId` parsing, combined schedule mutation/hook, edit modal
  seeding and submission changes, 409 display, and CourtLoad event-key divider rendering.
- `ui-designer`: review the Mini App detail/export controls and admin court-load/edit-modal states for
  compact mobile/admin ergonomics and readable legends without adding domain logic.
- `test-writer`: add focused contract, API, Mini App, and admin tests listed above.
- `reviewer`: review correctness, contract reuse, privacy, cancellation, and court conflict invariants.
- `security-reviewer`: review Mini App self-scope, admin authz, roster privacy, export leakage, and
  court availability integrity.
- `app-runner`: boot the stack and verify the Mini App detail/export path and admin conflict path
  end-to-end.
- `github-bot` after verification: open the PR from the implementation worktree and clean up temporary
  worktrees per AGENTS.md.

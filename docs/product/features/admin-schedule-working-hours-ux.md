# Feature: Admin schedule filters, court hours, and court timeline

## Goal

Match the implemented admin schedule UX: Trainings uses one unified toolbar, Groups has practical
filters, and CourtLoad shows editable court working hours plus a horizontal court timeline. Court
working hours are server-owned settings that also constrain client court-rental availability and
request validation.

This brief documents the shipped design only. No production code changes are implied.

## Spec refs

- Approved UX: Trainings unified toolbar, Groups filters, CourtLoad working-hours editor and court
  timeline.
- `docs/architecture/overview.md`: API owns domain truth; clients render validated contracts and do
  not compute availability.
- `docs/architecture/domain-model.md`: `AppSetting` stores operational key/value settings; court
  availability is derived from courts, blocks, trainings, and court requests.
- `docs/architecture/database.md`: `app_settings` is the existing operational settings table.

## Contracts & tables

- Working-hours contracts live in `packages/types/src/settings-contracts.ts`:
  - `courtWorkingHoursWindowSchema`: `{ openTime, closeTime }`, strict, 30-minute aligned, with
    `openTime < closeTime`.
  - `courtWorkingHoursSchema`: `{ date, openTime, closeTime, source }`, where `source` is
    `"day" | "month" | "fallback"`.
  - `courtWorkingHoursMonthViewSchema`: `{ year, month, fallback, monthDefault, dayOverrides }`.
  - `courtWorkingHoursDayViewSchema`: `{ date, effective, fallback, monthDefault, dayOverride }`.
  - update/query schemas for month defaults and day overrides.
- `courtLoadGridSchema` includes `workingHours` and keeps `openHour` / `closeHour` only as legacy
  compatibility fields.
- Storage uses the existing `app_settings` table only:
  - month default key: `court_hours_month:YYYY-MM`;
  - day override key: `court_hours_day:YYYY-MM-DD`;
  - value: JSON window `{ "openTime": "HH:mm", "closeTime": "HH:mm" }`;
  - `updated_at` and `updated_by` come from `app_settings`.
- No `court_working_hours_*` tables, schema additions, or DB migrations are part of this design.
- Fallback remains `07:00-21:00` when no day override or month default exists.

## API

- `GET /settings/court-hours/month?year=YYYY&month=M`
  - Auth: admin only.
  - Response: `courtWorkingHoursMonthViewSchema`.
  - Returns fallback, optional month default, and day overrides stored in `app_settings`.

- `PUT /settings/court-hours/month`
  - Auth: admin only.
  - Request: `{ year, month, openTime, closeTime }`.
  - Response: `courtWorkingHoursMonthSchema`.
  - Upserts `court_hours_month:YYYY-MM`.

- `DELETE /settings/court-hours/month?year=YYYY&month=M`
  - Auth: admin only.
  - Response: `204`.
  - Deletes `court_hours_month:YYYY-MM`.

- `GET /settings/court-hours/day?date=YYYY-MM-DD`
  - Auth: admin only.
  - Response: `courtWorkingHoursDayViewSchema`.
  - Returns effective hours plus the relevant fallback/month/day records.

- `PUT /settings/court-hours/day`
  - Auth: admin only.
  - Request: `{ date, openTime, closeTime }`.
  - Response: `courtWorkingHoursDayOverrideSchema`.
  - Upserts `court_hours_day:YYYY-MM-DD`.

- `DELETE /settings/court-hours/day?date=YYYY-MM-DD`
  - Auth: admin only.
  - Response: `204`.
  - Deletes `court_hours_day:YYYY-MM-DD`.

- Existing court reads/writes use the same resolver:
  - `GET /courts/load?date=YYYY-MM-DD` returns effective working hours and uses them for the axis.
  - `GET /court-requests/availability`, `GET /court-requests/free-courts`,
    `POST /court-requests/preview`, and `POST /court-requests` reject or omit out-of-hours slots.
  - Training and court-block assignment paths also validate against resolved working hours.

## Admin flow

- Trainings page:
  - One toolbar above the table owns date range, group, trainer, and terminal-status filtering.
  - The table keeps sorting and row actions without a duplicate DataTable filter row.

- Groups page:
  - One toolbar above the table filters by name, weekday, level, trainer, court, status, and
    visibility.
  - Filtering stays presentation-side over validated loaded reference data.

- CourtLoad page:
  - Keep the date picker.
  - Show month-default and selected-day override editors.
  - Show the selected date's effective source: day override, month default, or fallback.
  - Save/delete actions refetch court hours and court load.
  - Render one horizontal timeline row per active court from effective `openTime` to `closeTime`.
  - Timeline events cover trainings, confirmed requests, pending holds, and manual blocks.
  - Existing request/training/block click actions and unassigned training assignment actions remain.
  - Event accents are deterministic from event identity, not random per render.

## Bot flow

No bot UI changes. Bot court-rental preview/create flows keep calling the existing court-request API;
the API applies resolved working hours before accepting a slot.

## Invariants

- Court working hours resolve in order: day override, then month default, then fallback
  `07:00-21:00`.
- The API is the only source of truth for working-hours resolution, court availability, request
  validation, occupancy, and assignment constraints.
- Working-hours reads/writes under `/settings/court-hours/...` are admin-only.
- Admin, Mini App, and bot clients do not duplicate availability math.
- Existing occupancy rules remain intact for trainings, manual blocks, confirmed requests, and
  pending holds.
- Trainings and Groups filters only change what the admin sees; they do not mutate domain data.

## Acceptance criteria

- Trainings has one visible filter surface and no duplicate column-filter row.
- Trainings row actions, sorting, roster opening, edit/delete, and generation actions still work.
- Groups filters narrow rows by name, weekday, level, trainer, court, status, and visibility.
- Admin can read, set, and delete a month default and a selected-day override through
  `/settings/court-hours/...`.
- Effective hours show the correct source and follow day > month > fallback precedence.
- CourtLoad timeline uses effective selected-date hours for its axis and event positioning.
- Client availability, preview, free-courts, and request creation reject or omit out-of-hours slots
  using the same effective hours.
- No DB migration or dedicated working-hours table is required.

## Tests

- Contract tests validate aligned windows, reject invalid windows, and parse month/day views.
- Settings service/repository tests cover `app_settings` key upsert/delete and precedence:
  day > month > fallback.
- Settings controller/API tests cover admin auth and validation for `/settings/court-hours/...`.
- Court load, court request, training assignment, and block tests verify resolved hours are enforced.
- Admin tests cover the Trainings toolbar, Groups filters, CourtLoad editor, timeline positioning,
  deterministic event accents, and preserved click actions.

## Dependencies

- Existing admin auth via `x-telegram-id` and `isAdmin`.
- Existing `settings` module and `app_settings` table.
- Existing court occupancy helpers in `packages/types/src/helpers.ts`.
- Existing admin API client/hooks and pages for Trainings, Groups, and CourtLoad.

## Open questions with defaults

- Closed days: not supported in this slice; use manual court blocks for closures.
- Per-court working hours: not supported; hours apply to all active courts.
- Server-side Groups filtering: not needed for the current reference-list size.
- Persisted event colors: not needed; derive deterministic accents in the UI.

## Handoff

Implemented design is consistent with this brief: backend/settings uses `app_settings`, admin renders
the accepted Trainings toolbar, Groups filters, and CourtLoad timeline, and no DB migration is needed.

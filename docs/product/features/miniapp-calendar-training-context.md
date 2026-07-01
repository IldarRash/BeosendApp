# Feature: Mini App calendar training context

## Goal

Make the Mini App month calendar and selected-day agenda show the training context a client needs to
recognize a session: the server-owned group/program label for group trainings (for example Mix, Man,
Women as carried by the group name) and "Individual" for one-on-one trainings. Also replace the raw
individual-training date input with an easier date picker, without changing the request domain.

## Spec refs

- TZ sections 5, 15.2, 16, 18: slot cards, server-side capacity/status, Mini App UX, and the
  Group -> Trainings -> Bookings backbone.
- UX/design plan Part 2: Mini App is mobile, native Telegram-style, interaction-only, and renders
  server-decided values.
- Existing briefs: `miniapp-browse-book`, `miniapp-my-bookings`, `miniapp-individual-request`,
  `individual-confirm-auto-waitlist`, `trainer-individual-visibility`.
- Architecture refs: `docs/architecture/overview.md`, `domain-model.md`, `database.md`.

## Contracts & tables

- `packages/types/src/training-contracts.ts`
  - Add required read-only `trainingContextLabel: string` to `trainingScheduleSlotSchema`.
  - Add required read-only `trainingContextLabel: string` to `myBookingItemSchema`.
- Server population:
  - Group schedule rows: `trainingContextLabel = groups.name` from the existing join. This is the
    authoritative place for Mix/Man/Women wording in this slice.
  - Own bookings: group booking -> `groups.name`; individual training
    (`trainings.group_id is null` and `trainings.client_id is not null`) -> server-owned
    `"Individual"` label.
- Tables touched: no migration. Read existing `groups.name`, `trainings.group_id`,
  `trainings.client_id`, `bookings`, `trainers`, and `levels`.
- Do not add a `group_type` enum/table in this slice; use the existing admin-maintained group name as
  the display source.

## API

- `GET /trainings/schedule`
  - Same query: `trainingScheduleQuerySchema`.
  - Response: `TrainingScheduleSlot[]` with new `trainingContextLabel`.
  - Still returns visible group trainings only, including full rows.
- `GET /bookings/mine`
  - Same query: `myBookingsQuerySchema`.
  - Response: `MyBookingItem[]` with new `trainingContextLabel`.
  - Still self-only by verified client session and still excludes cancelled rows.
- `POST /trainers/:id/individual-request`
  - No contract or endpoint change. The date picker still submits the existing strict
    `{ telegramId, date, startTime, endTime }` body.

## Mini App flow

- Calendar month cells stop showing only generic "Training" or "Available" text when a training is
  involved. Cell preview uses the API label where space allows, e.g. `18:00 Mix` or
  `10:00 Individual`, while keeping the existing color/category markers.
- Selected-day agenda rows show `trainingContextLabel` as the primary context line, with trainer,
  level, seats, status, and price as secondary facts. Available group rows use the schedule label;
  booked rows use the my-bookings label.
- Training detail for an owned booking includes the same context label above trainer/level/status.
- Individual request screen keeps the existing trainer -> date/time -> request structure, but date
  selection becomes a tap-first picker: show the next 14 dates as selectable day chips, with a
  secondary "other date" native input fallback for farther dates. The submitted `date` remains an ISO
  `YYYY-MM-DD` string and the server remains authoritative.

## Invariants

- Mini App does not infer Mix/Man/Women/Individual labels from IDs, nulls, names, or statuses. It
  renders `trainingContextLabel` from the validated API response.
- Mini App remains an interaction layer: no capacity, status, availability, price, or court logic.
- Client reads remain self-scoped: `GET /bookings/mine` is still constrained by the verified session.
- Individual request remains notification/request-only until trainer/admin confirmation; the picker
  does not promise trainer availability.
- Public schedule still excludes individual trainings; "Individual" appears only for the caller's own
  individual bookings.

## Acceptance criteria

- Calendar cells and selected-day agenda rows show a clear context label for every training row.
- A group schedule row whose server label is `Women`/`Mix`/`Man` displays that exact label in the
  calendar/agenda without frontend derivation.
- A caller's own individual booking displays `Individual` in the calendar, agenda, and training detail.
- Missing or malformed `trainingContextLabel` is rejected by Zod and surfaces as an error state, not a
  fabricated fallback.
- The individual-training request screen offers tap-selectable upcoming dates and still sends the
  existing strict request body.
- No DB migration, no new endpoint, no bot behavior change.

## Tests

- Contract tests: `trainingScheduleSlotSchema` and `myBookingItemSchema` require
  `trainingContextLabel` and reject missing/empty labels.
- API service/repository tests:
  - `GET /trainings/schedule` rows include `groups.name` as `trainingContextLabel`.
  - `GET /bookings/mine` returns group name for group bookings and `Individual` for owned
    individual bookings.
  - Existing self-only and cancelled-row exclusions stay green.
- Mini App tests:
  - Calendar cell preview and day agenda render the provided label for group available rows and owned
    individual bookings.
  - Training detail renders the same context label.
  - A response missing the label fails validation and shows an error state.
  - Date chips set the ISO date used by `requestIndividualSession`; "other date" preserves strict
    body shape and invalid/past dates cannot submit.

## Dependencies

- Existing Mini App calendar route and hooks: `useTrainingSchedule`, `useMyBookings`,
  `CalendarScreen`.
- Existing individual request flow: `TrainerRequestScreen`,
  `POST /trainers/:id/individual-request`.
- Existing training/bookings API joins; no schema migration.

## Open questions with defaults

- Should Mix/Man/Women become a separate structured `groupType`? Default: no. Use `groups.name` as the
  authoritative display label for this slice; add a structured type only with a future admin-data
  migration.
- Should `Individual` be localized by the server? Default: no for this slice. Return the stable
  server-owned display label and keep the frontend from deriving it.
- How many dates should the individual picker show first? Default: 14 upcoming dates, plus an "other
  date" fallback so the feature improves common use without narrowing valid requests.

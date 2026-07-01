# Feature brief: Booking small fixes

Slug: `booking-small-fixes` | Branch: `feature/booking-small-fixes`

## Goal

Fix small booking UX gaps end to end: court rental opens at 07:00, manager contact is robust and
editable, Mini App users can add a single joined training to Google Calendar without OAuth,
participants are visible only to booked or waitlisted users, and full group trainings remain visible
so booking joins the waitlist. Monthly bulk export is not part of this slice and requires a future
OAuth-backed feature.

## Spec refs

- Roadmap T1/T2 training booking and waitlist.
- Court domain C1-C6.
- Mini App group, my-bookings, and calendar slices.
- Architecture refs: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`, and
  `docs/architecture/database.md`.

## Contracts & tables

- `packages/types/src/court-contracts.ts`: set `COURT_OPEN_HOUR = 7`; keep `COURT_CLOSE_HOUR = 21`.
- `packages/types/src/training-contracts.ts`: add `trainingScheduleQuerySchema` and
  `trainingScheduleSlotSchema`, extending slot data with `status` and `bookable`.
- New settings contract: `managerContactSchema { contact, url | null }` and
  `updateManagerContactSchema { contact }`.
- `packages/db`: add `app_settings(key, value, updated_at, updated_by)` with key
  `manager_contact`.

## API

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/trainings/available` | Unchanged, bookable-only. Full slots stay excluded. |
| `GET` | `/trainings/schedule` | Public visible group schedule for the date/filter query. Includes `open` and `full`; excludes hidden, inactive, past, cancelled, completed, and individual trainings. Full slots return `bookable=false`. |
| `GET` | `/trainings/:id/participants` | Existing response shape. Non-admin callers are allowed only when the caller has an active booking or active waitlist entry for that training. |
| `GET` | `/settings/manager-contact` | Public read. Returns the DB value when present, otherwise falls back to `MANAGER_CONTACT`. |
| `PATCH` | `/settings/manager-contact` | Admin-only update of the manager contact setting. |

## Bot flow

The Contact Manager tap fetches the current contact from `/settings/manager-contact`. If the API
call fails, the bot falls back to `MANAGER_CONTACT`. The bot renders the contact line for any
non-empty free-text value, and adds a direct URL button only when the value is a valid Telegram
username that can be safely linked.

## Mini App flow

- A joined training detail in My Calendar shows an "Add to Google Calendar" action. It opens
  `https://calendar.google.com/calendar/r/eventedit?action=TEMPLATE...` for that one training with
  prefilled title, Belgrade-local date/time converted to Google UTC `dates`, details, and location.
  The user confirms Save in Google. No OAuth, Google tokens, signed feed, or month bulk export is
  added in this slice.
- Calendar uses `/trainings/schedule`, not `/trainings/available`, so full visible group slots remain
  visible.
- Full group rows show a waitlist affordance, but still call the existing single-booking endpoint.
  The server's existing full-slot path creates the waitlist entry and returns the waitlisted result
  with the position.
- Participant lists render only after the caller has booked or waitlisted that training. The UI must
  treat a 403 as "not visible to you", not as an empty participant list.

## Invariants

- API remains the source of truth. Bot and frontend do no domain math.
- Capacity and status recompute stays server-side.
- `/trainings/available` stays bookable-only.
- Full slot booking must create a waitlist entry, not overflow a booking.
- Participants never leak ids or full names to clients.
- The Google Calendar action is a browser handoff for one already-joined training only; the Mini App
  stores no Google tokens and calls no Google API.
- Monthly bulk calendar export requires OAuth and belongs to a future feature.
- Court close remains 21:00; no offered court rental start may end after 21:00.

## Acceptance criteria

1. Court availability and the court load grid start at 07:00 and never offer starts ending after
   21:00.
2. `/trainings/available` excludes full slots; `/trainings/schedule` includes visible full group
   slots with `bookable=false`.
3. The Mini App can tap a full group slot and see the existing waitlisted result and position.
4. Participants are visible for own booked or waitlisted trainings; unrelated clients get 403.
5. The Mini App opens a no-token Google Calendar event-template URL for one joined training with
   correct Belgrade-to-UTC `dates`; it does not provide a signed feed or monthly bulk export.
6. Bot Contact Manager never errors for invalid or free-text contact and uses the updated admin
   contact.

## Tests

- Contracts: schedule schema, settings schema, and court constants.
- API: schedule filtering; participants authorization; manager contact fallback and update; 07:00
  court availability.
- Mini App: full-slot waitlist path, participants gating, and per-training Google Calendar URL
  generation/open action.
- Bot: fetched contact, fallback contact, and invalid URL suppression.
- Admin: manager contact edit.

## Dependencies

- Existing single-booking auto-waitlist path.
- Existing participants endpoint and response contract.

## Open questions

1. Contact storage: default to `app_settings.manager_contact` with env fallback, not deriving from one
   of many managers.
2. Monthly Google Calendar bulk export: future OAuth-backed feature; no signed feed in this slice.
3. Schedule auth: public read by default like `/trainings/available`; participant details stay
   auth-scoped.

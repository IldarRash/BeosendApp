# Feature brief: Booking small fixes

Slug: `booking-small-fixes` | Branch: `feature/booking-small-fixes`

## Goal

Fix small booking UX gaps end to end: court rental opens at 07:00, manager contact is robust and
editable, Mini App users can export their own training calendar through the signed ICS feed,
participants are visible only to booked or waitlisted users, and full group trainings remain visible
so booking joins the waitlist.

## Spec refs

- Roadmap T1/T2 training booking and waitlist.
- Court domain C1-C6.
- Connectors calendar-feed design.
- Mini App group, my-bookings, and calendar slices.
- Architecture refs: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`, and
  `docs/architecture/database.md`.

## Contracts & tables

- `packages/types/src/court-contracts.ts`: set `COURT_OPEN_HOUR = 7`; keep `COURT_CLOSE_HOUR = 21`.
- `packages/types/src/training-contracts.ts`: add `trainingScheduleQuerySchema` and
  `trainingScheduleSlotSchema`, extending slot data with `status` and `bookable`.
- `packages/types/src/calendar-contracts.ts`: reuse `calendarFeedLinkSchema` for the self feed link.
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
| `GET` | `/connectors/calendar/me` | Self-only Mini App endpoint. Returns a signed client ICS link for the caller's own client id. It cannot request another client's feed. |
| `GET` | `/settings/manager-contact` | Public read. Returns the DB value when present, otherwise falls back to `MANAGER_CONTACT`. |
| `PATCH` | `/settings/manager-contact` | Admin-only update of the manager contact setting. |

## Bot flow

The Contact Manager tap fetches the current contact from `/settings/manager-contact`. If the API
call fails, the bot falls back to `MANAGER_CONTACT`. The bot renders the contact line for any
non-empty free-text value, and adds a direct URL button only when the value is a valid Telegram
username that can be safely linked.

## Mini App flow

- Profile shows a Google Calendar export action that calls `/connectors/calendar/me` and displays the
  caller's signed ICS link. No OAuth is added.
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
- The ICS self endpoint cannot request another client's feed.
- Court close remains 21:00; no offered court rental start may end after 21:00.

## Acceptance criteria

1. Court availability and the court load grid start at 07:00 and never offer starts ending after
   21:00.
2. `/trainings/available` excludes full slots; `/trainings/schedule` includes visible full group
   slots with `bookable=false`.
3. The Mini App can tap a full group slot and see the existing waitlisted result and position.
4. Participants are visible for own booked or waitlisted trainings; unrelated clients get 403.
5. The Mini App exports the caller's own signed ICS feed; there is no OAuth and no arbitrary client id.
6. Bot Contact Manager never errors for invalid or free-text contact and uses the updated admin
   contact.

## Tests

- Contracts: schedule schema, settings schema, and court constants.
- API: schedule filtering; participants authorization; self ICS link; manager contact fallback and
  update; 07:00 court availability.
- Mini App: full-slot waitlist path, participants gating, and profile calendar export.
- Bot: fetched contact, fallback contact, and invalid URL suppression.
- Admin: manager contact edit.

## Dependencies

- Existing calendar connector and `calendarFeedVersion`.
- Existing single-booking auto-waitlist path.
- Existing participants endpoint and response contract.

## Open questions

1. Contact storage: default to `app_settings.manager_contact` with env fallback, not deriving from one
   of many managers.
2. Self feed rotation: out of scope by default; existing admin rotation remains available.
3. Schedule auth: public read by default like `/trainings/available`; participant details stay
   auth-scoped.

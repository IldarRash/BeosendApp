# Feature: Admin court cancellation and API-backed subscription months

## Goal

Let an admin cancel an already-confirmed court request, freeing the court slot, and stop client UIs
from offering monthly group subscriptions for months where the selected group has no future generated
trainings. The API remains the source of truth for both request status and month availability.

## Spec refs

- `docs/product/feature-roadmap.md`: court rental moderation, monthly subscriptions, generated
  trainings.
- `docs/architecture/overview.md`: UI apps render API state; API owns availability and request
  decisions.
- `docs/architecture/domain-model.md`: `CourtRequest`, `CourtRequestCourt`, `Group`, `Training`,
  `Booking`, `Waitlist`.
- `docs/architecture/database.md`: court availability derives from active courts, request holds,
  blocks, and generated group-training blocks.

## Contracts & tables

- `packages/types/src/court-contracts.ts`
  - Add `cancelCourtRequestSchema` matching the existing request-id body pattern:
    `{ requestId: uuid }`.
  - Reuse `courtRequestSchema`, `courtRequestAdminViewSchema`, and existing
    `courtRequestStatus = pending|confirmed|rejected|cancelled`.
- `packages/types/src/training-contracts.ts`
  - Add `bookableMonthSchema`: `{ year, month }`.
  - Add `bookableMonthsSchema`: bare `BookableMonth[]`.
- `packages/db/src/schema.ts`
  - No migration. Reuse `court_requests.status`, `court_requests.decided_at`,
    `court_requests.decided_by`, `court_request_courts`, `groups`, and `trainings`.

## API

- `POST /court-requests/:id/cancel`
  - Admin-only via `x-telegram-id`.
  - Body: `cancelCourtRequestSchema`; path id must equal body `requestId`.
  - Response: `courtRequestSchema`.
  - Behavior: lock the request, require `status === "confirmed"`, set `status = "cancelled"` and
    stamp `decidedAt/decidedBy` with the cancelling admin. Keep `court_request_courts` rows as
    history; occupancy already ignores non-`pending`/`confirmed` requests, so the slot is freed.
  - Reject pending/rejected/cancelled requests with 409. Pending remains reject-only.
- `GET /groups/:id/bookable-months`
  - Client-facing read used by bot and Mini App.
  - Response: `bookableMonthsSchema`, a bare `BookableMonth[]` array of `{ year, month }`.
  - Behavior: the server computes the current month and next month candidates, then returns only
    months with at least one future generated `open` or `full` training for that group. Future means
    `trainings.date >= today` and the date falls in the candidate month. Exclude a group that is not
    client-bookable by the same active/visible group, trainer, and level rules used by the monthly
    booking write. The response has no wrapper object and no `trainingCount`.
- Existing `POST /bookings/group` stays the final authority and still rejects races or stale months.

## Bot flow

- Group subscription: pick group -> bot calls `GET /groups/:id/bookable-months` -> render only the
  returned month buttons -> month picked -> existing confirmation card -> existing
  `POST /bookings/group`.
- If no months are returned, show the existing "month not generated / try later" path with Back/Home.
- Mini App mirrors this: `GroupBookingScreen` replaces local current+next `offeredMonths()` with the
  API read for the selected group and hides an empty month picker when no months are returned.

## Invariants

- Pending court requests are not cancellable; they can only be confirmed or rejected.
- Confirmed court cancellation is admin-only and atomic; a cancelled request no longer occupies court
  availability or CourtLoad.
- `court_request_courts` rows are retained for audit/history; active occupancy filters remain
  `pending|confirmed`.
- Month pickers never decide generation locally. Bot and Mini App render the API's month list, while
  `POST /bookings/group` still enforces ownership, active group rules, duplicate subscription guard,
  capacity, waitlist, and skipped-date behavior.

## Acceptance criteria

- Admin court-request table shows a Cancel action only on the `confirmed` tab.
- Cancelling a confirmed request moves it to the `cancelled` tab, refetches queues/load views, and
  frees those courts for overlapping availability reads.
- Attempting to cancel a pending, rejected, cancelled, or unknown request returns the appropriate
  typed error and changes nothing.
- Pending rows still show Confirm/Reject only; no Cancel button appears for pending.
- For July 2026, if a group has future generated July trainings and no generated August trainings,
  both bot and Mini App show only July 2026.
- If a stale client posts `POST /bookings/group` for a hidden/unavailable month anyway, the existing
  server rejection remains intact.

## Tests

- Contract tests parse/reject `cancelCourtRequestSchema` and `bookableMonthsSchema`.
- API court-request tests cover admin auth, confirmed -> cancelled, non-confirmed 409, id mismatch
  400, no occupancy after cancellation, and join rows retained.
- Admin client/hooks/page tests cover `cancelRequest`, confirmed-only action visibility, mutation
  success/error, and query invalidation.
- API group-month tests cover current+next filtering, no generated trainings -> empty list, future
  generated `open`/`full` trainings making a month appear, inactive/hidden/non-client-bookable group
  excluded, and stale write still rejected by `POST /bookings/group`.
- Bot and Mini App tests replace current+next local month assumptions with API-returned months and
  cover the empty-month state.

## Dependencies

- Existing court-request moderation module and admin CourtRequests page.
- Existing group monthly booking write (`POST /bookings/group`) and generated trainings table.
- Existing typed API clients in `apps/bot`, `apps/miniapp`, and `apps/admin`.

## Open questions

- Court-cancel notification: default is no new Telegram notification/template/event in this slice;
  the admin action updates API/admin state and frees availability. Add a later notification slice if
  client-facing cancellation messaging is required.
- Month horizon: default is current month plus next month, preserving the existing UX while filtering
  out months with no future generated trainings.
- Cancelled court history in client "mine": default is unchanged; cancelled court requests remain
  excluded from the client's future court-request list unless a separate history view is planned.

# Feature brief: Mini App — My bookings + cancel (S5)

Slug: `miniapp-my-bookings` · Slice: S5 of the `feature/miniapp` plan
(`~/.claude/plans/giggly-gathering-bee.md`) · Depends on: FOUNDATION + S1 (resolved `clientId`).

## Goal

Give the onboarded client a "My bookings" screen inside the Telegram Mini App where they can:

1. **View their own bookings**, split into **Upcoming** and **Past** via a segmented control.
2. **Cancel an upcoming booking** — but only when the server says it is cancellable — through a
   confirm step, after which the list refetches and that one item flips to `cancelled`.

This replaces the current `my-bookings` placeholder (`PlaceholderScreen`) in the router. It is an
**interaction layer only**: no domain/money/availability/capacity math, every API response validated
against a `@beosand/types` contract, `VITE_*` env only, never importing `@beosand/config`.

## Spec / invariant refs

- `CLAUDE.md` product invariants: bot/Mini App never writes domain tables directly; capacity + status
  recomputed server-side after every cancel (`full → open`); a monthly group booking is one booking
  per instance linked by `group_subscription_id`, and cancelling one date must never drop the rest.
- `.claude/rules/telegram-bot.md` / `.claude/rules/frontend.md`: interaction layer, ≤3 taps, validate
  rendered values, never compute eligibility/money client-side.
- Plan S5 row + acceptance line: "segmented Upcoming/Past; cancel via confirm sheet. *Invariant:*
  monthly-batch single-date cancel leaves the rest of the month; `full→open`. *Unsafe:* cancelling
  non-owned booking rejected."

## Endpoints reused — NO new API, NO new contract

Both endpoints and contracts already exist server-side (T1.10 / T1.11). This slice adds **only** the
Mini App ApiClient methods, a hook, the screen, and a presentational view. No `apps/api`, no schema,
no `packages/types` change.

| Method | Endpoint | Request contract | Response contract |
|---|---|---|---|
| List my bookings | `GET /bookings/mine?clientId=<uuid>&scope=<upcoming\|past>` | `myBookingsQuerySchema` `{ clientId: uuid, scope: "upcoming" \| "past" }` | `MyBookingItem[]` (`z.array(myBookingItemSchema)`) |
| Cancel one booking | `POST /bookings/:id/cancel` (no body) | path id = `uuid` | `bookingSchema` (`Booking`) |

`myBookingItemSchema` (read it in `packages/types/src/training-contracts.ts`, lines ~262–289) carries
everything the screen renders, all server-decided:

```
bookingId, trainingId, date, dayOfWeek, startTime, endTime,
trainerName, levelName,
bookingStatus    (booked | cancelled | attended | no_show | waitlist),
trainingStatus   (open | full | cancelled | completed),
canCancel        (boolean — server-computed)
```

Notes that shape the UI:

- **There is no separate `outcome` field.** A past item's outcome IS its `bookingStatus`
  (`attended` / `no_show` / `cancelled`). The Past list renders a status chip from `bookingStatus`;
  the Upcoming list typically shows `booked`.
- **`canCancel` is the only signal for the Cancel action.** The server sets it true only for a future
  (`date >= today`), still-`booked` item whose training is non-terminal (`open`|`full`). The Mini App
  **never** re-derives this from date/status — it reads the flag and shows Cancel iff `canCancel`.
- The server `cancelBooking` matches the booking by **id only**, sets that single row to `cancelled`,
  recomputes the training count (`full → open` when the seat frees), and keeps any
  `group_subscription_id` siblings untouched — so a monthly-batch single-date cancel leaves the rest
  of the month booked. The Mini App just calls and refetches.

## How `clientId` is obtained

`clientId` is the caller's own resolved Client id, taken from the cached `useClient()` query (its
`data.id`) — the exact pattern S4/S6 already use (`useCreateBooking` / `useJoinWaitlist`). It is
**never** client-asserted: the API re-checks ownership from the verified session
(`assertOwnsClient(actorTelegramId, clientId)` → 403 on mismatch). The hook supplies `clientId`;
screens never pass it in. Both `scope` queries reuse the same cached client id.

## ApiClient + hooks (frontend wiring)

Append to `apps/miniapp/src/api/client.ts` (`MiniappApiClient`), reusing the existing
`request` / typed-error machinery:

- `listMyBookings(query: MyBookingsQuery): Promise<MyBookingItem[]>` →
  `GET /bookings/mine${toQueryString(query)}`, validated against `z.array(myBookingItemSchema)`.
  Serialise via the existing `toQueryString` (omits absent fields; server re-validates).
- `cancelBooking(bookingId: string): Promise<Booking>` → `POST /bookings/:id/cancel` (no body),
  validated against `bookingSchema`. A 409 (already cancelled / not cancellable) surfaces as the
  existing `ConflictError`; a 403 (not owned) surfaces via `errorFromResponse` as a generic `Error`.

Append to `apps/miniapp/src/api/hooks.ts`:

- `myBookingsQueryKey(clientId, scope)` — stable key, e.g. `["my-bookings", clientId, scope]`, so the
  two segments cache independently and a cancel can invalidate the prefix.
- `useMyBookings(scope)` — reads the cached client via `useClient()` for `clientId`, disabled until
  `clientId` exists, queries `listMyBookings({ clientId, scope })`.
- `useCancelBooking()` — mutation taking `bookingId`; on settle invalidates the `["my-bookings"]`
  prefix (both scopes) so the cancelled item flips and any newly-cancellable state is refreshed. A
  409/403 propagates as the typed error for the screen to render.

## Screen / UX

New `apps/miniapp/src/screens/MyBookingsScreen.tsx` + presentational
`apps/miniapp/src/ui/MyBookingsView.tsx` (mirroring the Browse/Confirm screen-vs-view split). Wire it
into `apps/miniapp/src/router/Router.tsx`: the `RouteView` switch renders `<MyBookingsScreen
clientId={...} />` for `case "my-bookings"` instead of falling through to `PlaceholderScreen`. The
`my-bookings` route id and its `mybookings` deep link already exist (reminder notifications land here).

Layout (native `@telegram-apps/telegram-ui`, theme-adaptive light/dark, BeoSand coral accent):

- **Segmented control** at the top: `Upcoming | Past` (TGUI `SegmentedControl`/`TabsList`). Switching
  segments is a `hapticSelection()` tick and swaps the query scope. Upcoming is the default segment.
- **List** of items for the active scope, each a TGUI `Section`/`Cell` showing: trainer name, level,
  date (`weekdayFullKey(dayOfWeek)` + `formatDayMonth(date)`), time range (`formatTimeRange`).
  - **Past** items render a status chip derived from `bookingStatus` (`attended` / `no_show` /
    `cancelled`) — the outcome — using the existing format/i18n key pattern.
  - **Upcoming** items show a **Cancel** action (subtle, coral-destructive) **only when
    `item.canCancel === true`**. Never inferred from date/status client-side.
- **Empty / loading / error** states reuse `EmptyState` / `LoadingState` / `ErrorState` from
  `ui/StateView.tsx` (per-scope empty copy). A malformed item makes the Zod parse throw → `ErrorState`
  with the message.

Cancel flow (≤3 taps from Home: Home → My bookings tap = nav; then within the screen: tap Cancel →
confirm → done):

1. Tapping **Cancel** on an upcoming item opens a **confirm step** (TGUI bottom-sheet or a dedicated
   confirm view, consistent with `ConfirmView`/`WaitlistAcceptView`) summarising the item, with a
   **warning haptic** (`hapticImpact("warning")` / `notificationOccurred("warning")` — add a
   `hapticWarning()` helper to `apps/miniapp/src/tg/buttons.ts` alongside `hapticSuccess`).
2. Confirming runs `useCancelBooking().mutate(bookingId)`. The native MainButton is the single primary
   action (`useMainButton`), showing its loader while in flight.
3. **Success** → `hapticSuccess()`, dismiss the confirm, and the list **refetches** (cache
   invalidation). The cancelled item now shows status `cancelled` (it leaves the Upcoming list because
   `bookingStatus` is no longer `booked`, or shows cancelled in Past).
4. **409 ConflictError** (item was already cancelled / no longer cancellable) → show the server message
   verbatim and refetch so `canCancel` re-syncs; **403** → generic error message; neither leaves a
   half-state.

UI strings: add `miniapp.myBookings.*` keys to `packages/i18n/src/catalogs/ru/miniapp.ts` (RU
authoritative) and mirror the identical key set into `sr/miniapp.ts` + `en/miniapp.ts`
(`catalog-parity.spec` enforces parity). Needed keys (at least): title, `tabUpcoming`, `tabPast`,
empty title/body per scope, `cancel`, `cancelConfirmTitle`, `cancelConfirmBody`, `cancelled`/success,
`status.attended`, `status.noShow`, `status.cancelled`, `conflict` fallback. Reuse existing
`miniapp.weekday.*`, `miniapp.booking.*` (date/time/trainer/level labels), and `miniapp.common.*`.

## Acceptance criteria

- The `my-bookings` route renders the real `MyBookingsScreen` (placeholder removed for this case).
- A segmented `Upcoming | Past` control switches scope; each scope fetches `GET /bookings/mine` with
  the cached `clientId` and the matching `scope`, validated against `myBookingItemSchema`.
- Each item shows trainer, level, date, time, and status; **Past** items show the outcome
  (`attended` / `no_show` / `cancelled`) from `bookingStatus`.
- An upcoming item shows the **Cancel** action **iff `item.canCancel === true`** — taken straight from
  the API, never computed client-side.
- Cancel → confirm step (warning haptic) → `POST /bookings/:id/cancel` → success haptic → list
  refetches → that item flips to `cancelled`.
- ≤3 taps to cancel a booking from Home; native BackButton returns to Home; one MainButton per screen.
- Empty / loading / error / 409-conflict states are all distinct and announced to assistive tech.
- `pnpm --filter @beosand/miniapp typecheck lint test build` green; full gate stays green (rebuild
  `@beosand/types` + `@beosand/i18n` before per-package checks).

## Invariant to test

- **Monthly-batch single-date cancel leaves the rest of the month booked.** With several upcoming
  items sharing one monthly subscription, cancelling one item: after the success refetch, **only that
  item** flips to `cancelled` while the siblings stay `booked` (the server keeps the batch intact and
  recomputes the freed seat `full → open`). The Mini App proves this by refetching and rendering the
  server's result — it does no batch/capacity math. (Render/validation level: the test asserts the UI
  only reflects what the API returns and never mutates siblings; the server-side guarantee is covered
  by the existing `bookings.service.spec`.)

## Unsafe / forbidden path to test

- **Cancelling another client's booking is rejected server-side** (`assertOwnsClient` → 403); the
  Mini App never sends a foreign `clientId` (it uses the cached own `clientId`) and surfaces a 403 as
  an error state, not a fake success.
- **`canCancel` is taken from the API, never computed client-side.** A test renders an item with
  `canCancel: false` but a future date + `booked`/`open` status and asserts **no Cancel action is
  shown** — proving eligibility is the server flag, not a client inference.
- **A malformed booking item is rejected by the contract.** `listMyBookings` parsing a response with
  a bad `bookingStatus`/`trainingStatus`/missing field throws (Zod), and the screen shows `ErrorState`
  — never renders unvalidated data.

## Tests (suggested)

- `apps/miniapp/src/api/client.spec.ts` (or co-located): `listMyBookings` builds the correct query and
  parses `MyBookingItem[]`; rejects a malformed item; `cancelBooking` POSTs to `/bookings/:id/cancel`,
  parses `Booking`, maps 409 → `ConflictError`, 403 → generic `Error`.
- `apps/miniapp/src/screens/my-bookings-flow.spec.tsx` (mirroring `browse-flow.spec.tsx`): segment
  switch refetches; Cancel shown iff `canCancel`; confirm → success → refetch flips one item with
  siblings intact; 409 shows the server message; malformed item → `ErrorState`.
- i18n: `catalog-parity.spec` stays green after adding `miniapp.myBookings.*` to all three catalogs.

## Files to create / change (frontend + i18n only)

- `apps/miniapp/src/api/client.ts` — add `listMyBookings`, `cancelBooking`.
- `apps/miniapp/src/api/hooks.ts` — add `myBookingsQueryKey`, `useMyBookings`, `useCancelBooking`.
- `apps/miniapp/src/screens/MyBookingsScreen.tsx` — NEW (container; supplies `clientId` from cache).
- `apps/miniapp/src/ui/MyBookingsView.tsx` — NEW (presentational; segmented control + list + cancel
  confirm).
- `apps/miniapp/src/router/Router.tsx` — render `MyBookingsScreen` for `case "my-bookings"`.
- `apps/miniapp/src/tg/buttons.ts` — add `hapticWarning()`.
- `packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts` — add `miniapp.myBookings.*` keys (RU
  authoritative; SR/EN parity).
- Spec files as above.

## Dependencies

- S1 (`clientId` resolved + cached via `useClient`) — hard prerequisite.
- FOUNDATION (ApiClient, providers, router, native button/haptic hooks, StateView, i18n catalogs).

## Open questions (with chosen defaults)

1. **Confirm UI shape** — bottom-sheet vs dedicated confirm screen. *Default:* a native bottom-sheet
   (TGUI) over the list, consistent with the "bottom-sheet confirmations" decision in the plan; falls
   back to an inline confirm view if the sheet primitive is awkward with the MainButton lifecycle.
2. **Does the Upcoming list show non-cancellable upcoming items (e.g. on a `cancelled` training)?**
   *Default:* render whatever scope `upcoming` returns from the API as-is (status shown, Cancel hidden
   when `canCancel` is false) — the server owns which rows are "upcoming"; the Mini App never filters.
3. **Cancelled items in Past** — show with a `cancelled` chip. *Default:* yes; `bookingStatus` is the
   outcome and `cancelled` is a valid Past outcome alongside `attended`/`no_show`.

## Handoff

Implementation goes to `frontend-implementer` (ApiClient methods + hook + screen/view + router wiring)
and the i18n keys; no `backend-implementer` work (no API change). Per-slice code review is deferred to
the final consolidated pass.

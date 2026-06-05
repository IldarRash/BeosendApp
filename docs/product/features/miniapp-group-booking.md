# Feature: Mini App group booking — monthly subscription (S7)

- Slug: `miniapp-group-booking`
- Slice: S7 (plan `giggly-gathering-bee.md`)
- Depends on: FOUNDATION, S1 (`clientId` via cached `useClient()`), S2 (Home hub + nav shell —
  the `group` route already exists, rendering `PlaceholderScreen`).
- Branch: `feature/miniapp-group-booking` off `feature/miniapp`.

## Goal

Let a client **subscribe to a recurring training group for a whole month** from the Mini App: pick a
group, pick a month (current or next), confirm once, and see the server's result — how many trainings
were created (one booking per training instance, linked by a single `groupSubscriptionId`) and which
dates were skipped. The Mini App is an **interaction layer only**: it resolves the caller's `clientId`
once from the cached session, calls the two existing endpoints, and renders the server's typed result.
**No domain math here** — no prices, no availability/capacity, and **no month-date math** (it never
computes which dates exist in the month, how many trainings there are, or which are full). The API
owns all of that. ≤3 taps: open → pick group → pick month → confirm.

## Spec / rule refs

- Spec section 3.4 (Groups: a recurring training slot), 3.6 (Bookings), 15.1 (month generation),
  15.2 (capacity recompute / status flip), section 16 (UX / ≤3 taps), section 18 (mandatory
  architecture: Group → Trainings → Bookings).
- `CLAUDE.md` invariants: the bot/Mini App **never writes domain tables directly**; **monthly group
  booking creates one booking per training instance** (a batch linked by `group_subscription_id`);
  cancelling one date must never drop the rest of the month; **money is always RSD, computed
  server-side, displayed only**; capacity/status recomputed server-side; `full`/`cancelled` slots are
  never offered as bookable.
- `.claude/rules/telegram-bot.md` (interaction layer; validate every rendered value; IDs not blobs),
  `.claude/rules/frontend.md` (no domain/money/availability/capacity math; `VITE_*` only; never import
  `@beosand/config`), `.claude/rules/zod-contracts.md` (reuse contracts; never redeclare),
  `.claude/rules/security.md` (self-only writes; recompute price/availability server-side; never trust
  client-sent amounts).

## No backend change

Both endpoints already exist and enforce every invariant server-side. **No new API, no new contract,
no schema/migration.** Reuse exactly:

- `GET /groups` — returns `Group[]` (`groupSchema`). Reference-facing, the client "join a group" list
  (`apps/api/src/modules/groups/groups.controller.ts` `@Get()`).
- `POST /bookings/group` — body `createGroupBookingSchema { clientId, groupId, year, month }`
  (`.strict()`); returns `GroupBookingResult` (`apps/api/src/modules/bookings/bookings.controller.ts`
  `@Post("group")`).

Server-side facts the Mini App relies on (from `apps/api/src/modules/bookings/bookings.service.ts`
`createGroupBooking` — do **not** re-implement any of this):

- **Identity/ownership is re-resolved from the verified session's Telegram id.** The controller reads
  the actor from `x-client-telegram-id`/`x-telegram-id` (set by the session bridge from the Bearer
  token); a `clientId` in the body that is not the caller's own resolved row is rejected
  (`ForbiddenException`, 403). The body `clientId` is never trusted as the source of identity.
- **The server computes the month's training instances, prices, capacity, and which dates are
  skipped.** It creates one `booked` booking per bookable training instance in `{year, month}`, all
  sharing one freshly minted `groupSubscriptionId`, inside a transaction, recomputing each training's
  capacity/status. A date with no free seat (`full`), already booked by this client, or
  `cancelled`/non-bookable is recorded in `skipped`, never `created` — skipping is reported, never
  fatal.
- An unknown/inactive group → `404`/`409`; an invalid `{year, month}` (e.g. a closed month) →
  `400`/`409` with a server message. The Mini App shows the server message verbatim; it never decides
  month validity itself.

## Contracts / data the Mini App touches (reuse, do not redeclare)

From `@beosand/types`:

- `groupSchema` / `Group` — `{ id, name, levelId, daysOfWeek, startTime, endTime, trainerId,
  trainerName, capacity, priceSingleRsd, priceMonthRsd, status }`. The detail screen renders
  `name`, `daysOfWeek` (via `weekdayShortKey`/`weekdayFullKey`), `startTime`–`endTime` (via
  `formatTimeRange`), `trainerName`, the level (resolved to a label via the cached `useLevels()` set
  keyed by `levelId`, reused from S1/S3), and the **monthly price `priceMonthRsd`** (via `formatRsd`).
  `priceMonthRsd` is the **only** price shown for this flow and comes straight from the API — never
  computed. `priceSingleRsd` is not shown here (this flow is the monthly subscription).
- `createGroupBookingSchema` / `CreateGroupBookingInput` — `{ clientId, groupId, year, month }`
  (`.strict()`), parsed before send.
- `groupBookingResultSchema` / `GroupBookingResult` — `{ groupSubscriptionId, created: Booking[],
  skipped: string[] (dateString) }`, validated before the result screen renders it. The result screen
  reads `created.length` (how many trainings were created) and `skipped` (the dates skipped) **straight
  from this contract** — it computes neither.
- `bookingSchema` / `Booking` — already used to validate each entry of `created` (each carries the
  shared `groupSubscriptionId`).

Conflicts/validation arrive as NestJS errors: the `ApiClient` already maps `409 → ConflictError`
(carrying the server message verbatim), `404 → NotFoundError`, and any other non-2xx (e.g. a 403 for a
mismatched `clientId`, or a 400 for an invalid month) → a generic `Error` with the server message. No
conflict-shaped union is needed.

## API client + hooks (append to existing files, one method per slice)

`apps/miniapp/src/api/client.ts` — add two methods following the existing
`createSingleBooking`/`listTrainers` patterns (validate the body with the shared schema before send;
validate the response with the entity schema; rely on `request()`'s 401-reauth + `errorFromResponse`
409/404 mapping):

- `listGroups(): Promise<Group[]>` → `GET /groups`, response `z.array(groupSchema)`
  (add a module-level `const groupsSchema = z.array(groupSchema)` next to the existing list schemas).
- `createGroupBooking(input: CreateGroupBookingInput): Promise<GroupBookingResult>` →
  `POST /bookings/group`, body `createGroupBookingSchema.parse(input)`, response
  `groupBookingResultSchema`. `clientId` is the caller's own resolved Client id (never a client-asserted
  value — the server re-checks ownership from the verified session); the body never carries a price.

`apps/miniapp/src/api/hooks.ts` — add:

- `groupsQueryKey(): readonly [string]` → `["groups"]` and
  `useGroups(): UseQueryResult<Group[]>` (cached like `useTrainers`/`useLevels`).
- `useGroupBooking(): UseMutationResult<GroupBookingResult, Error, { groupId: string; year: number;
  month: number }>` — reads `clientId` from the cached `useClient()` record's `id` (the same source
  `useCreateBooking` uses; **never client-asserted**). Throws "No resolved client to subscribe for" if
  `clientId == null`. `onSettled` invalidates the `my-bookings` key prefix (`MY_BOOKINGS_KEY_PREFIX`,
  reused from S5) so the new monthly batch appears in My Bookings; the available-slots list is not
  affected for the browse view in a way the user needs immediately, so no available-slots invalidation
  is required (group instances are not single-booking cards).

## Mini App flow (≤3 taps)

`RouteView` in `apps/miniapp/src/router/Router.tsx` currently renders `PlaceholderScreen` for the
`group` route via the `default` branch. **S7 adds an explicit `case "group"` returning the real
`GroupBookingScreen`.** The route id already exists in `routes.ts`; no route-table change is needed
(the Home menu entry and the `group` deep-link prefix already point here).

Single screen with three local sub-states (held in screen state, not the global route stack — the
native BackButton steps back through them via the shell, same pattern as the Browse confirm sub-state):

1. **Group list.** `useGroups()` → a native list (`@telegram-apps/telegram-ui` `Section`/`Cell` rows),
   one row per active `Group` showing `name`, weekday list, time range, trainer, and the monthly price
   (`priceMonthRsd` via `formatRsd` + the RSD i18n string). Empty list → a calm "no groups" state.
   Tap a row → group detail.
2. **Group detail + month picker.** Shows the same group facts in full (weekdays via `weekdayFullKey`,
   `startTime`–`endTime`, trainer, level label, **monthly price `priceMonthRsd`**) plus a **two-option
   month picker**: the **current month** and the **next month**, presented as two selectable rows. The
   two `{year, month}` options are derived **for labels only** (see the month-picker decision below);
   the server decides validity. Selecting a month enables the confirm step.
3. **Confirm → result.** A confirm sub-state shows the chosen group + month + the monthly price; the
   native **MainButton** ("Записаться на месяц") fires `useGroupBooking({ groupId, year, month })` with
   haptic feedback. On success: haptic success + a **result screen** that renders, straight from
   `GroupBookingResult`:
   - "Создано тренировок: {count}" where `count = created.length`;
   - if `skipped.length > 0`, a "Пропущенные даты" list of the `skipped` dates (each via
     `formatDayMonth`), with a one-line note that those dates were full/unavailable;
   - an action back to "Мои записи" (`useNav().push("my-bookings")`) and/or Home.
   On `ConflictError`/`Error` (invalid month / inactive group / mismatched client): the server message
   shown verbatim with a back-to-detail action — **no fabricated success**.

The native **MainButton** is the single primary action on the confirm step; the **BackButton** is
wired by the shell (it pops the local sub-state, then the route). ≤3 taps: Home → group list → pick
group → (pick month →) confirm.

### Month-picker decision (display-only, server validates)

`POST /bookings/group` takes `{ year, month }` and there is **no** "valid months" read endpoint, so
the Mini App must present the two month options itself. The two options are the **current month** and
the **next month**, derived from `new Date()` purely as a **calendar label choice** (which two
`{year, month}` to offer), mirroring the bot's `offeredMonths(now)` in
`apps/bot/src/group-booking.ts`. This is **not** domain math: it computes neither dates, nor prices,
nor which trainings exist — only the two `{year, month}` integers and their human labels. **The server
is authoritative**: it validates the chosen `{year, month}`, computes the month's training instances,
and returns `created`/`skipped`. If the chosen month is not bookable, the server's `400`/`409` is shown
verbatim. Add a small display-only helper (e.g. `offeredMonths(now): { year: number; month: number }[]`
in `apps/miniapp/src/ui/format.ts` or a screen-local helper) returning exactly the current and next
month (December rolls to next January) — labels resolved via new `miniapp.month.<n>` i18n keys plus the
year. **Default (recorded):** show both options always; never grey one out client-side (the server
decides validity). See Q1.

## i18n (RU authoritative; mirror SR + EN — catalog-parity.spec enforces)

Add `miniapp.group.*` and `miniapp.month.*` keys to all three
`packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts` (reuse `miniapp.home.group*`,
`miniapp.weekday.*`, `miniapp.timeOfDay.*`, and the existing price/RSD string where they fit). New keys
(RU shown; mirror the bot's `bot.group.*`/`bot.month.*` copy for consistency):

- `miniapp.group.listTitle` "Группы"
- `miniapp.group.none` "Сейчас нет открытых групп."
- `miniapp.group.monthSubscription` "Абонемент на месяц: {price} RSD"
- `miniapp.group.trainer` "Тренер: {name}"
- `miniapp.group.pickMonth` "Выберите месяц"
- `miniapp.group.confirm` "Записаться на месяц"
- `miniapp.group.confirmBody` "Подписка на группу «{name}» на {month}. С вас спишут {price} RSD за месяц."
- `miniapp.group.resultTitle` "Готово!"
- `miniapp.group.createdCount` "Создано тренировок: {count}"
- `miniapp.group.skippedHeader` "Пропущенные даты (нет мест)"
- `miniapp.group.toMyBookings` "К моим записям"
- `miniapp.group.toHome` "На главную"
- `miniapp.month.1` … `miniapp.month.12` ("январь" … "декабрь")

Conflict/error bodies are rendered from the server message verbatim; the `miniapp.common.*` error
strings are the fallback only when the error has no message (mirroring the S4/S6 pattern).

## Native UX

Theme-adaptive light/dark + BeoSand coral accent; one native **MainButton** per screen for the primary
action ("Записаться на месяц"); **BackButton** wired by the shell; **HapticFeedback** on confirm and on
success; reuse `ui/OptionList`/`ui/StateView`/`ui/ConfirmView` and `ui/format`. Money is RSD from the
API (`priceMonthRsd`), display only. ≤3 taps.

## Acceptance criteria

1. The `group` route renders the real `GroupBookingScreen` (the `PlaceholderScreen` branch for `group`
   is removed); it lists active groups from `GET /groups`.
2. From the group list, picking a group and a month and confirming subscribes for that month via
   `POST /bookings/group` with **one** confirm tap on the native MainButton — ≤3 taps end to end.
3. The price shown is `priceMonthRsd` from the `Group` contract, formatted via `formatRsd` — never
   computed in the Mini App; the body sent to the API carries **no** price.
4. `clientId` is taken from the cached `useClient()` record's `id` (never asserted by the client); the
   call sends `{ clientId, groupId, year, month }`.
5. The result screen shows the created count (`created.length`) and, when present, the `skipped` dates —
   both read straight from `GroupBookingResult`; the Mini App computes neither.
6. An invalid month / inactive group / mismatched client surfaces the server message verbatim and shows
   **no** success result.
7. Every rendered value is validated against its `@beosand/types` contract (`groupSchema`,
   `groupBookingResultSchema`) before display.

## Invariant to test

- **One booking per training instance, linked by `groupSubscriptionId`.** The result the Mini App
  renders reflects the server's batch: the created count is `created.length` and every entry of
  `created` carries the **same** `groupSubscriptionId` (assert in the render/validation test against a
  mock `GroupBookingResult`). The Mini App never fabricates or recomputes the count.
- **A full/cancelled date appears as `skipped`, NOT `created`.** Given a mock `GroupBookingResult` with
  a non-empty `skipped` array, the result screen renders those dates under the "skipped" section and
  does **not** count them toward created trainings. (The server's own tests cover capacity recompute and
  the actual skip decision; the Mini App test asserts it surfaces `skipped` faithfully and never treats
  a skipped date as created.)

## Unsafe / forbidden path to test

- **Booking for another client's `clientId` is rejected server-side.** The hook always sends the
  caller's own cached `clientId`; a tampered value is re-checked from the verified session and rejected
  (403). Test: the Mini App surfaces the error and renders no success state (it never shows a result
  it didn't get back).
- **The client never sends or computes a price.** The request body is `createGroupBookingSchema`-shaped
  `{ clientId, groupId, year, month }` only — no amount field exists or is sent; the server is
  authoritative for `priceMonthRsd`. (Asserted by the strict schema and a test that the sent body has no
  price key.)
- **A malformed `Group` / `GroupBookingResult` is rejected by the contract.** A response that doesn't
  match `groupSchema` / `groupBookingResultSchema` is rejected by the `ApiClient`'s `.parse` and
  surfaces as an error state, never rendered (e.g. a `created` entry missing `groupSubscriptionId`, or a
  `skipped` value that isn't a `dateString`).

## Open questions (with chosen defaults)

- **Q1 — How to present the two month options?** **Default (recorded):** offer exactly the current
  month and the next month as two selectable rows (calendar label choice only, mirroring the bot's
  `offeredMonths`), labels via `miniapp.month.<n>` + year; never grey one out client-side — the server
  validates and any rejection is shown verbatim. (Revisit only if product wants a different window or a
  server-driven "valid months" endpoint, which would be a new API — out of S7 scope.)
- **Q2 — Show how many trainings the month contains *before* confirming?** **Default:** no. That count
  is month-date math the Mini App must not do, and there is no read endpoint for it. The created count
  comes from `GroupBookingResult` after confirm. (A pre-confirm count would need a new preview endpoint —
  out of scope.)
- **Q3 — After a successful subscription, where to land?** **Default:** the result screen with actions
  to "Мои записи" (so the user sees the new batch) and Home. No auto-navigation, so the user reads the
  created/skipped summary first.

## Handoff

- `ui-designer`: group list, group detail + two-option month picker, confirm sub-state, and result
  screen (created count + skipped dates), native MainButton/BackButton, coral accent, OptionList/
  StateView/ConfirmView reuse.
- `frontend-implementer`: the two `ApiClient` methods + the `useGroups`/`useGroupBooking` hooks, the
  `GroupBookingScreen`, the `case "group"` wiring in `Router.tsx` (removing the placeholder branch for
  `group`), and the display-only `offeredMonths` helper + `miniapp.month.*`/`miniapp.group.*` i18n keys.
- No `backend-implementer` work (endpoints reused as-is).
- `test-writer`: render/validation + the invariant (created count + same `groupSubscriptionId`; skipped
  rendered as skipped, never counted as created) + the unsafe paths (no price sent; malformed
  `Group`/`GroupBookingResult` rejected by the contract).
- `reviewer` + `security-reviewer`: confirm `clientId` is never client-asserted, no price/availability/
  month-date math leaked into the Mini App, and the result reflects `GroupBookingResult` faithfully.

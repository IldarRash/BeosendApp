# T1.10 — My bookings

**Goal.** Let a client see their upcoming trainings and past trainings, with a cancel action exposed
only on future, still-`booked` items (cancel itself lands in T1.11).

**Spec refs.** ТЗ §10; UX §10.

## Smallest correct slice

A thin vertical read slice: a new contract (`myBookingItemSchema`) → a `GET /bookings/mine` endpoint
(ownership in the service) → a repository read joining `bookings → trainings → trainers/levels` →
a bot `myBookings` handler that lists upcoming and past sections. No cancel write in this slice (it is
T1.11); upcoming items merely *expose* the cancel button wired to the T1.11 callback.

## Contracts & tables

- **Reuse:** `bookingSchema`, `bookingStatus`, primitives (`uuid`, `dateString`, `timeString`,
  `dayOfWeek`) from `packages/types`. No DB schema change — all view fields come from existing columns
  via joins (`bookings`, `trainings`, `trainers`, `levels`).
- **Add (new, does not exist):** in `packages/types/src/training-contracts.ts`:
  - `myBookingScope = z.enum(["upcoming", "past"])`.
  - `myBookingsQuerySchema = z.object({ clientId: uuid, scope: myBookingScope }).strict()`.
  - `myBookingItemSchema = z.object({ bookingId: uuid, trainingId: uuid, date: dateString,
    dayOfWeek, startTime: timeString, endTime: timeString, trainerName: z.string(),
    levelName: z.string(), bookingStatus, trainingStatus, canCancel: z.boolean() })`.
    `canCancel` is **server-computed** (true only for future + `booked` + non-terminal training).
  - Export `MyBookingScope`, `MyBookingsQuery`, `MyBookingItem` via `z.infer`. Re-export from
    `packages/types/src/index.ts`.

## API — `apps/api/src/modules/bookings/`

- `GET /bookings/mine?clientId=<uuid>&scope=upcoming|past`
  - Header `x-telegram-id` identifies the caller (same pattern as the existing POST endpoints).
  - Controller: thin — parse header, Zod-validate the query with `myBookingsQuerySchema`, call one
    service method, return `MyBookingItem[]`.
  - **Service (`listMine`)**: reuse the existing `assertOwnsClient(actorTelegramId, clientId)` private
    check (extract/share it) — the supplied `clientId` must resolve from the caller's `telegram_id`
    (admins may act on any); a foreign `clientId` is rejected with `ForbiddenException`. Compute
    `today` server-side; `canCancel = bookingStatus === "booked" && date >= today &&
    training is open|full`. Validate every returned item with `myBookingItemSchema` before returning.
  - **Repository**: one read joining `bookings` → `trainings` → `trainers` → `levels`, filtered by
    `clientId`. `upcoming`: `trainings.date >= today`, ordered `date ASC, startTime ASC`.
    `past`: `trainings.date < today`, ordered `date DESC, startTime DESC`. Returns typed rows; the
    service does the `canCancel`/today logic, not the repo.

## Bot flow — `apps/bot`

- Replace the `MENU_ACTIONS.myBookings` stub in `navigation.ts` with a real handler that:
  1. Resolves the caller's client via `api.getClientByTelegramId(ctx.from.id)`; if none, show the
     onboarding nudge + back/home footer.
  2. Calls `api.listMyBookings(clientId, "upcoming", telegramId)` and `"past"`.
  3. Renders two sections (upcoming first, then past) via pure helpers in a new
     `apps/bot/src/my-bookings.ts` (render + keyboard, unit-testable). Past items show outcome when
     `bookingStatus` is `attended`/`no_show`; upcoming `canCancel` items get a `❌ Отменить` button.
- **ApiClient:** add `listMyBookings(clientId, scope, actorTelegramId): Promise<MyBookingItem[]>`
  (GET with `x-telegram-id` header, validate response with `z.array(myBookingItemSchema)`).
- **Callback data:** define a `MY_BOOKINGS_ACTIONS.cancelPrefix = "booking:cancel:"` constant carrying
  only the `bookingId` (`16 + 36 = 52` bytes, under 64). In this slice the cancel button is wired to a
  placeholder that says cancel is coming (T1.11), or left for T1.11 to handle — do not implement the
  cancel write here. Always include the back/home footer so the journey never dead-ends.

## Invariants

- **Primary invariant:** a client sees ONLY their own bookings — `listMine` re-resolves the client
  from `telegram_id` and rejects any `clientId` that is not the caller's (admins excepted). The bot
  never filters ownership; the service does.
- Cancel is offered only for future, `booked` items (`canCancel` is server-computed, never trusted
  from the bot). Past items show outcome (`attended`/`no_show`) when set and never expose cancel.
- Upcoming vs past is split server-side relative to today; the bot only renders.

## Unsafe / forbidden path (must be rejected)

`GET /bookings/mine?clientId=<another client's uuid>` from a non-admin caller must return
`403 Forbidden` and leak nothing — never another client's bookings, roster, or counts.

## Acceptance criteria

- Upcoming and past are separated correctly relative to now, each ordered sensibly.
- Every future `booked` item exposes a cancel action; past items do not.
- A client sees only their own bookings; a foreign `clientId` is rejected with 403.

## Tests

- **Service:** scoping (upcoming/past split at today), ordering, `canCancel` computation
  (future+booked → true; past or cancelled → false), and ownership rejection (foreign clientId → 403;
  admin allowed).
- **Contract:** `myBookingsQuerySchema` rejects unknown fields / bad scope; `myBookingItemSchema`
  round-trips.
- **Bot:** `my-bookings.ts` render/keyboard — sections render, cancel button appears only on
  `canCancel` items, footer always present.

## Dependencies

- T1.8 / T1.9 (bookings exist). Cancel write is **T1.11** (out of scope here).

## Open questions

None. Default chosen: cancel button in this slice is rendered but its write is deferred to T1.11.

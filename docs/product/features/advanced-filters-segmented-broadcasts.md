# T3.2 — Advanced filters & segmented broadcasts

**Goal.** Add richer client-side slot filters and let managers target a broadcast at a derived
audience segment instead of every active client. Both are read-only over authoritative data; neither
changes the booking flow.

**Spec refs.** ТЗ §19 (stage 3). Builds on T1.5 (available slots), T2.4 (free-slot broadcasts), T3.1
(analytics aggregation math).

## Smallest correct slice

Two thin vertical slices over existing surfaces — no new tables, no new module:

1. **Slot filters** — extend the existing client availability query/endpoint with `weekday`,
   `timeOfDay`, and `trainerId` (it already has `levelId`, `from`, `to`). Service filters
   server-side over already-bookable slots; bot adds optional filter chips.
2. **Segmented broadcasts** — extend the existing broadcast preview/send contracts and endpoints
   with an optional `audience` selector. Service derives the recipient set on the fly from
   `clients` + `bookings`; preview reports the exact `recipientsCount`; send records it.

## Contracts & fields (packages/types) — extend, do not add tables

Edit `packages/types/src/training-contracts.ts` (and its `.spec.ts`):

- Add a shared `timeOfDay = z.enum(["morning","afternoon","evening"])` (boundaries documented in a
  pure helper, see below). Place the enum in `common.ts` next to `dayOfWeek`/`entityStatus`.
- Extend `availableSlotsQuerySchema` (keep `.optional()` on all): add
  `weekday: dayOfWeek.optional()`, `timeOfDay: timeOfDay.optional()`, `trainerId: uuid.optional()`.
  No `.strict()` so query coercion stays lenient like today.
- Add an audience contract:
  - `broadcastAudienceSchema = z.discriminatedUnion("kind", [...])` with three variants:
    - `{ kind: "all" }` (default — current behavior),
    - `{ kind: "level", levelId: uuid }`,
    - `{ kind: "active", days: z.number().int().min(1).max(365) }` (booked in last N days),
    - `{ kind: "lapsed", days: z.number().int().min(1).max(365) }` (active client, no booking in
      last N days).
  - Extend `broadcastPreviewQuerySchema` and `sendBroadcastSchema` with
    `audience: broadcastAudienceSchema.optional()` (absent ⇒ `{ kind: "all" }`, preserving T2.4).
  - `broadcastPreviewSchema` already carries `recipientsCount` — reused unchanged; it now reflects
    the segment size.

No DB schema change: `broadcasts.recipientsCount` already persists the actual count; segments are
derived from existing `clients.levelId` and `bookings.createdAt`/`status`.

## Pure helpers (packages/types/src/helpers.ts) — unit-testable, no Nest/DB

- `timeOfDayOf(startTime: string): TimeOfDay` — maps "HH:MM" to morning (<12:00), afternoon
  (12:00–16:59), evening (≥17:00). Single tested place for the boundary rule.
- `matchesSlotFilters(slot, filters)` — pure predicate combining weekday/timeOfDay/trainerId/levelId
  over a `SlotCard`-shaped input, so filter correctness is testable without a DB.

## API (apps/api)

- **Module `trainings`** — `GET /trainings/available`
  - Controller Zod-validates the extended `availableSlotsQuerySchema`.
  - Service builds the bookable-slot set exactly as T1.5 does (`isBookable` only), then applies the
    filters via `matchesSlotFilters` / `timeOfDayOf`. Filtering never widens visibility: a `full`,
    `cancelled`, or `completed` slot is still never returned regardless of filters.
- **Module `broadcasts`** — `GET /broadcasts/preview`, `POST /broadcasts/send`
  - Both require admin (`isAdmin(telegramId)` from `packages/config` against `ADMIN_TELEGRAM_IDS`),
    enforced in the service, not the controller/bot.
  - Service resolves the audience to a concrete client list via the `broadcasts` repository (the only
    DB access): `all` = active clients; `level` = active clients with that `levelId`; `active` =
    distinct clients with a non-cancelled booking whose `createdAt ≥ now − days`; `lapsed` = active
    clients with no such recent booking. Recipients are always active clients only.
  - `preview` returns the existing `broadcastPreviewSchema` with `recipientsCount` = resolved segment
    size. `send` sends to exactly that set and writes one `broadcasts` row with `recipientsCount`
    equal to the number actually dispatched; `payload` records the audience for audit.

These are the only endpoints; reuse existing services/repos — extend signatures, do not fork.

## Bot flow (apps/bot)

- **Client slot filters** (interaction only): on the slots screen, optional filter chips
  (`menu:filter:weekday`, `menu:filter:tod`, `menu:filter:trainer`, `menu:filter:level`,
  `menu:filter:clear`). The bot holds the chosen filters in conversation state, passes them to
  `ApiClient.getAvailableSlots(query)`, and renders the returned cards. Keep open → pick → confirm
  within 2–3 taps; always offer back to main menu. No filtering math in the bot.
- **Manager segmented broadcast** (role-gated): before the existing send confirm, a segment picker
  (`bcast:aud:all`, `bcast:aud:level:<id>`, `bcast:aud:active`, `bcast:aud:lapsed`). The bot calls
  `ApiClient.previewBroadcast({ type, audience })`, shows text + slots + the segment recipient count,
  then `ApiClient.sendBroadcast({ type, audience })` on confirm. Role is checked via the API.

`ApiClient` methods: extend existing `getAvailableSlots`, `previewBroadcast`, `sendBroadcast`
signatures with the new optional fields (validate responses against the existing contracts).

## Invariants

- **Most important:** a segment is a read-only filter over authoritative data — it may only ever
  *narrow* who is reached or which bookable slots are shown; it can never reveal a non-bookable slot,
  another client's data, or a court number, and never alters the booking flow itself.
- Segment sends are **admin-only**, enforced in the broadcasts service.
- Recorded `recipientsCount` equals the actual dispatched count for the resolved segment.

## Unsafe / forbidden path (must be rejected by a test)

A non-admin `telegram_id` calling `POST /broadcasts/send` (with any `audience`) must be rejected with
`ForbiddenException` and send to nobody — even if the audience would otherwise be empty/cheap. (Plus:
filtered `GET /trainings/available` must never return a `full`/`cancelled`/`completed` slot.)

## Acceptance criteria

- Filtering slots by level/weekday/time-of-day/trainer returns only matching **bookable** slots; an
  unmatched filter returns an empty list, never a non-bookable slot.
- A segmented broadcast (`level` / `active` / `lapsed`) reaches only that segment and the persisted
  `recipientsCount` equals the dispatched count; default/absent audience behaves exactly like T2.4.
- Non-admin send is rejected.

## Tests

- helpers: `timeOfDayOf` boundaries; `matchesSlotFilters` combinations.
- training-contracts.spec: extended `availableSlotsQuerySchema` accepts/omits new fields, rejects bad
  weekday/timeOfDay; `broadcastAudienceSchema` discriminated-union accept/reject + unknown-field
  rejection on preview/send.
- broadcasts service: segment membership and recipient count per `level`/`active`/`lapsed`/`all`;
  non-admin send forbidden.
- trainings service: filter correctness; full/cancelled/completed never returned under any filter.

## Dependencies

T1.5 (available slots), T2.4 (free-slot broadcasts), T3.1 (analytics math). NOTE: in this worktree
`apps/api` and `apps/bot` are not yet scaffolded — only `packages/types` and `packages/db` exist.
Contracts + pure helpers can land first; the API/bot slices depend on T1.5/T2.4 modules existing.

## Open questions (with chosen defaults)

- **Which segments to ship first?** Default: `level` + `active` (last 30 days), plus `all`. Ship
  `lapsed` in the same union since it is the inverse of `active` and free.
- **Time-of-day boundaries?** Default: morning <12:00, afternoon 12:00–16:59, evening ≥17:00.
- **`days` window unit?** Default: rolling days back from now (`createdAt ≥ now − days`), N = 30
  default in the bot UI.

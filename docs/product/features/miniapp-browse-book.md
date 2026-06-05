# Mini App — browse slots & single booking (`apps/miniapp`, slices S3 + S4)

**Status.** Planned. Combines slices **S3** (`miniapp-browse-slots`) and **S4**
(`miniapp-single-booking`) of the Mini App plan (`giggly-gathering-bee.md`) into one coherent
browse → tap → confirm → book journey, because S4 has no entry point of its own (single booking is
reached only from inside the browse flow, never from the Home hub — see `router/routes.ts`). Builds on
the merged FOUNDATION (scaffold, auth seam, `MiniappApiClient`, provider stack, native UI shell), S1
(`useClient()` + cached `clientId`, native button hooks), and S2 (nav shell + route table). **No API,
contract, or DB change** — both slices reuse existing endpoints and `@beosand/types` contracts.

## Goal

Let an onboarded client browse **bookable training slots** and book one in ≤3 taps:

1. A **Browse screen** (replaces the shared `PlaceholderScreen` stub on the `browse` route) that lists
   bookable slots from `GET /trainings/available`, each rendered as a native slot card.
2. **Filter controls** — weekday, time-of-day, trainer, level — plus a **Today** toggle
   (`from = to = today`), all mapped onto the existing `AvailableSlotsQuery`.
3. **Tap a slot → a confirm step** (bottom-sheet / detail) whose native **MainButton "Записаться"**
   creates the booking via `POST /bookings/single`, then shows success and refetches the list.
4. A **full / unavailable** slot offers a **"лист ожидания"** affordance that navigates toward the
   waitlist journey — a seam **S6** completes; S3+S4 never offer a normal booking on such a slot.

The onboarding gate (S1) and nav shell (S2) still run first; this slice only swaps the `browse`
route's screen and adds one `MiniappApiClient` method + hooks per reused endpoint.

## Non-goal

No new endpoints, contracts, or DB tables. No waitlist join/accept (S6 — this slice only renders the
affordance and routes toward it). No group/monthly booking (S7), no individual request (S8), no court
flow (S9). No price, capacity, availability, or status math in the Mini App — every such value is read
from the API verbatim. No admin/trainer surfaces.

## Spec refs

ТЗ §5 (slot card contents shown to a client), §15.2 (capacity recompute + `open ↔ full` server-side),
§16 (UX: ≤3 taps, always a way back); plan `giggly-gathering-bee.md` rows **S3** + **S4** and the
"Per-slice acceptance & invariant to test" + "Native UX per slice" sections;
`.claude/rules/frontend.md`, `.claude/rules/telegram-bot.md`, `.claude/rules/zod-contracts.md`,
`.claude/rules/nestjs-layering.md` (server owns the decisions this UI only displays); root `CLAUDE.md`
product invariants (Telegram is interaction-only; bot/miniapp never writes domain tables directly;
`full`/`cancelled` slots are never offered as bookable).

## Guardrails (non-negotiable)

- **Interaction layer only.** No money/availability/capacity/status math. `freeSeats`, `priceSingleRsd`,
  and the slot's bookability all come decided from the API; the UI renders them. The booking write
  goes through `POST /bookings/single`; the Mini App never touches a domain table.
- **No new API / no contract redeclaration.** Reuse `slotCardSchema`, `availableSlotsQuerySchema`,
  `trainerSchema`, `levelSchema`, `createSingleBookingSchema`, `bookingSchema` from `@beosand/types`.
  Validate every response with the matching contract in `MiniappApiClient` before render.
- **clientId from the cached session, never client-asserted.** The booking body's `clientId` is taken
  from `useClient().data.id` (resolved once from the verified Telegram id via `clientQueryKey`), never
  from a value the screen could choose. The server independently re-derives identity from the session
  and rejects a mismatched `clientId` — the UI source is defence-in-depth, not the security boundary.
- **Never offer a full/cancelled slot as bookable.** `GET /trainings/available` already returns only
  bookable slots (status `open` + free seats), so this holds by the API. Still render **defensively**:
  if a card arrives with `freeSeats === 0`, show the waitlist affordance, not Book.
- **Config via `import.meta.env` (`VITE_*`) only.** Never import `@beosand/config`. Shared deps stay
  `@beosand/types` (+ `@beosand/i18n`).
- **UI strings via `@beosand/i18n`** (RU authoritative; mirror SR/EN — `catalog-parity` spec enforces
  identical key sets). Native Telegram look (`@telegram-apps/telegram-ui`), theme-adaptive light/dark,
  BeoSand coral accent. Native **MainButton** "Записаться" for the confirm; **BackButton** wired to the
  nav stack; `HapticFeedback` selection on filter/slot tap, success on a booked slot. ≤3 taps.

## Endpoints reused (no API change)

| Method | Path | Request contract | Response contract | Use |
|---|---|---|---|---|
| GET | `/trainings/available` | `availableSlotsQuerySchema` (query: `from?`, `to?`, `levelId?`, `weekday?`, `timeOfDay?`, `trainerId?`) | `z.array(slotCardSchema)` | Bookable slots, filtered. |
| GET | `/trainers` | — | `z.array(trainerSchema)` | Trainer filter options. |
| GET | `/levels` | — | `z.array(levelSchema)` | Level filter options (already wired as `listLevels`/`useLevels`). |
| POST | `/bookings/single` | `createSingleBookingSchema` (`{ clientId, trainingId }`, `.strict()`) | `bookingSchema` | Create the single booking. |

`GET /trainings/available` returns **only bookable** slots (status `open` + free seats), so the
"full/cancelled never offered" invariant holds at the source. The server computes capacity, status,
and `priceSingleRsd`; the Mini App only displays them.

## Contracts touched

None added or changed. Reused, all from `@beosand/types`:

- `slotCardSchema` → `SlotCard`: `{ trainingId, date, dayOfWeek, startTime, endTime, trainerName,
  levelName, freeSeats, priceSingleRsd }`.
- `availableSlotsQuerySchema` → `AvailableSlotsQuery`: all-optional filter query; `weekday` is `1..7`
  (`z.coerce.number`), `timeOfDay` ∈ `morning | afternoon | evening`, `levelId`/`trainerId` are uuids,
  `from`/`to` are `YYYY-MM-DD`.
- `trainerSchema` → `Trainer`, `levelSchema` → `Level` (filter options).
- `createSingleBookingSchema` → `CreateSingleBookingInput` (`.strict()` — only `clientId` + `trainingId`).
- `bookingSchema` → `Booking` (the created row; the UI reads `status` to confirm success).

## ApiClient & hooks (append only)

Append to `apps/miniapp/src/api/client.ts` (each method Zod-validates its response), mirroring the
existing `listLevels` style:

- `listAvailableSlots(query: AvailableSlotsQuery): Promise<SlotCard[]>` — `GET /trainings/available`
  with the filter query serialised to a query string (omit absent fields); validate against
  `z.array(slotCardSchema)`.
- `listTrainers(): Promise<Trainer[]>` — `GET /trainers`; validate against `z.array(trainerSchema)`.
- `createSingleBooking(input: CreateSingleBookingInput): Promise<Booking>` — `POST /bookings/single`;
  body validated against `createSingleBookingSchema` before send (reject a bad shape locally too),
  response validated against `bookingSchema`. A 409 surfaces as the existing `ConflictError`.

`listLevels`/`useLevels` already exist — reuse, do not duplicate.

Hooks in `apps/miniapp/src/api/hooks.ts` (append, with stable query keys like `clientQueryKey`):

- `useAvailableSlots(query)` — keyed by the normalised filter query so changing a filter refetches;
  this is the query whose `refetch` runs after a successful booking.
- `useTrainers()` — filter options (cached like `useLevels`).
- `useBookSingle()` — mutation calling `createSingleBooking`; on success it invalidates the slots query
  (so a now-full slot drops out) and shows success; on `ConflictError` it surfaces the server message
  and refetches the list. **clientId comes from `useClient().data.id`** inside the hook/caller, never a
  parameter the screen supplies arbitrarily.

## Screen / UX

Replace the `browse` branch of `router/Router.tsx`'s `RouteView` (currently the shared
`PlaceholderScreen`) with the real `BrowseScreen`; the route table stays as-is (`browse` already
exists in `RouteId` and `HOME_SECTIONS`).

**Browse screen (list).**
- A native `List` of slot cards. Each card shows, all from the `SlotCard` contract:
  weekday + date, start–end time, trainer name, level name, **free seats**, and **price in RSD**
  (rendered via the shared RSD formatter from the value the API returned — no math).
- Filter controls above the list: **weekday** (1–7), **time-of-day** (morning/afternoon/evening),
  **trainer** (from `useTrainers`), **level** (from `useLevels`), and a **Today** toggle that sets
  `from = to = <today>`. Each maps onto one `AvailableSlotsQuery` field; clearing a filter removes that
  field. `hapticSelection()` on each filter change; the list refetches via the query key.
- Empty state when no slots match (distinct from loading and error states).
- Defensive render: a card with `freeSeats === 0` (should not arrive, but) shows the waitlist
  affordance instead of a bookable tap.

**Confirm step (tap a slot).**
- Tapping a bookable card pushes a confirm view (native section/bottom-sheet) repeating the card
  details and the RSD price, with the native **MainButton "Записаться"**. `hapticSelection()` on open.
- Pressing MainButton calls `useBookSingle()` with `{ clientId: useClient().data.id, trainingId }`.
  On success: `hapticSuccess()`, a success state, and the slots list refetches (the booked slot is
  expected to drop out or show as full once its last seat is taken). BackButton returns to the list.

**Waitlist affordance (full / unavailable).**
- A slot that is not bookable shows a **"лист ожидания"** action that navigates toward the waitlist
  journey (the S6 seam). In S3+S4 this is a navigation affordance only — **no booking and no waitlist
  write is offered here**; S6 wires the actual join/accept. Keep the deep-link/route convention from
  `routes.ts` (`waitlist_<id>` is parsed defensively and currently falls back to Home until S6).

**i18n.** Add `miniapp.browse.*` and `miniapp.booking.*` keys to `packages/i18n/src/catalogs/ru/
miniapp.ts` (authoritative) and mirror the same keys into `sr/` and `en/`. Cover: screen title, filter
labels (weekday/time-of-day/trainer/level), Today toggle, "free seats" label, the confirm header, the
MainButton "Записаться", success message, the "лист ожидания" affordance, empty/error states, and the
409 "slot filled meanwhile" message. No money or availability math in any string.

## Invariants honoured

- **Capacity & status are recomputed server-side after every booking** (§15.2): the Mini App never
  computes free seats or flips `open ↔ full`. After a booking it **refetches** `GET /trainings/available`
  and renders the server's new truth — a now-full slot drops out (the endpoint returns only bookable
  slots).
- **`full`/`cancelled` are never offered as bookable**: enforced by the endpoint; defensively
  reinforced by rendering the waitlist affordance for any `freeSeats === 0` card.
- **The bot/miniapp never writes domain tables directly**: the booking goes through
  `POST /bookings/single`; the service validates ownership, availability, and status transition.
- **Money is RSD, computed server-side**: `priceSingleRsd` is displayed via the shared formatter; the
  Mini App does no price math.
- **clientId is the caller's own, resolved from the verified session**, never a client-asserted id.

## Acceptance criteria

- From Home, **≤3 taps** to a booked slot: Home → Browse (tap "Расписание") → tap a slot → MainButton
  "Записаться". BackButton returns at each step; Home shows no MainButton.
- The list shows only slots returned by `GET /trainings/available` (bookable: `open` + free seats);
  each card's free-seat count and **RSD price come from the API** (no client math).
- All four filters + the Today toggle map onto `AvailableSlotsQuery` and refetch the list on change;
  clearing a filter widens results.
- Tapping a bookable slot reaches a confirm step with MainButton "Записаться"; success shows a
  confirmation and the list refetches.
- A full/unavailable slot shows the **"лист ожидания"** affordance and **never** a Book action.
- Every rendered slot card and the booking response are validated against their `@beosand/types`
  contract; a malformed response is rejected (the screen shows an error, not garbage).
- `pnpm --filter @beosand/miniapp typecheck lint test build` is green; RU/SR/EN catalogs at parity.

## Tests

Render / validation (Mini App):
- A valid `SlotCard[]` renders cards with the API's weekday/date/time, trainer, level, free seats, and
  RSD price (asserting the price string equals the formatter applied to the API value — no recompute).
- Filter changes produce the expected `AvailableSlotsQuery` (e.g. Today → `from === to === today`;
  weekday/time-of-day/trainer/level set the right fields; clearing removes the field) and a new query
  key (refetch).
- Only bookable cards expose a Book/confirm tap; a `freeSeats === 0` card shows the waitlist affordance
  (defensive path).

Invariant (server truth, observed through the UI):
- After a successful booking on a slot whose last seat is taken, the list refetch returns the slot
  **absent** (or full) — the Mini App reflects the server's `open → full` flip and never computes it
  itself. `full`/`cancelled` slots are never present as bookable cards.

Unsafe / forbidden path:
- **Booking with another client's `clientId` is rejected server-side** (the service re-derives identity
  from the session; the UI sources `clientId` from `useClient()` and cannot select another user's).
- A **409 "slot filled meanwhile"** from `POST /bookings/single` surfaces the server message
  (`ConflictError`) and triggers a list refetch — not a generic failure.
- A **malformed slot card** (`z.array(slotCardSchema)` parse fails) or a **malformed booking response**
  (`bookingSchema` parse fails) is rejected by the contract and surfaces as an error state, never
  rendered.

Backend invariant coverage (capacity recompute, `open → full` on last seat, 409 on a filled slot,
ownership enforcement) already lives in `apps/api` bookings tests — reuse, do not duplicate; this slice
adds only the Mini App render/validation/refetch tests above. Flag any gap to `test-writer`.

## Dependencies

- **Requires:** FOUNDATION (auth seam, `MiniappApiClient`, providers), S1 (`useClient()` + cached
  `clientId`, native button hooks `useMainButton`/`useBackButton`/`hapticSelection`/`hapticSuccess`),
  S2 (nav shell + `browse` route).
- **Reuses unchanged backend:** `GET /trainings/available`, `GET /trainers`, `GET /levels`,
  `POST /bookings/single` and all named `@beosand/types` contracts.
- **Unblocks / seams:** S6 (waitlist) consumes the "лист ожидания" affordance and the `waitlist_<id>`
  deep-link route this slice points at.

## Open questions (each with a chosen default)

1. **Filter presentation (chips vs. native pickers).** *Default:* native `@telegram-apps/telegram-ui`
   controls — a horizontal row of selectable chips for weekday/time-of-day and `Select`-style pickers
   for trainer/level — to stay theme-adaptive; revisit if density is poor on small screens.
2. **Default date window when no Today/filter is set.** *Default:* send no `from`/`to` and let the API
   apply its own window (the Mini App owns no date math); Today simply sets `from = to = today`.
3. **Confirm as bottom-sheet vs. pushed detail screen.** *Default:* a pushed detail view with the
   native MainButton (consistent with the BackButton-driven stack in `routes.ts`); a bottom-sheet is a
   later refinement if the native component fits the flow better.
4. **Post-booking destination.** *Default:* stay on Browse with a success toast/state and a refetched
   list (lets the client book another slot); a "go to My bookings" shortcut is deferred to after S5.

## Note

This brief deliberately covers **two plan slices, S3 and S4**, built together as one browse → book
journey: S4 (single booking) has no Home-menu entry and is only reachable from inside the S3 browse
flow, so splitting them would leave S3 a dead-end and S4 unreachable. Implementation may still land as
two commits (browse list + filters, then confirm + booking) behind the same agreed contracts.

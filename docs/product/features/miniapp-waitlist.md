# Feature: Mini App waitlist — join & accept (S6)

- Slug: `miniapp-waitlist`
- Slice: S6 (plan `giggly-gathering-bee.md`)
- Depends on: FOUNDATION, S1 (`clientId` via cached `useClient()`), S3/S4 (Browse + Confirm).
- Branch: `feature/miniapp-waitlist` off `feature/miniapp`.

## Goal

Let a client (1) **join** the waitlist of a full training slot, and (2) **accept** a promoted slot
when a push notification deep-links the Mini App. The Mini App is an **interaction layer only**: it
resolves the caller's `clientId` once from the cached session, calls the two existing endpoints, and
renders the server's typed result. No eligibility, capacity, ordering, or window math lives here —
the API owns all of it. ≤3 taps for each flow.

## Spec / rule refs

- Spec section 9 (waitlist), section 16 (UX / ≤3 taps), section 15.2 (capacity recompute).
- `CLAUDE.md` invariants: bot/Mini App never writes domain tables directly; capacity + status
  recomputed server-side; never over-book.
- `.claude/rules/telegram-bot.md` (interaction layer, validate every rendered value, IDs not blobs),
  `.claude/rules/frontend.md` (no domain math, VITE_* only, never import `@beosand/config`),
  `.claude/rules/zod-contracts.md` (reuse contracts), `.claude/rules/security.md` (self-only writes).

## No backend change

Both endpoints already exist and enforce every invariant server-side. **No new API, no new
contract, no schema/migration.** Reuse:

- `POST /waitlist` — body `createWaitlistEntrySchema { clientId: uuid, trainingId: uuid }` (`.strict()`).
  Returns `waitlistEntrySchema` (`WaitlistEntry`).
- `POST /waitlist/:id/accept` — path `:id` is the waitlist entry id (the server validates it with the
  shared `uuid` primitive at the controller boundary). No body. Returns `bookingSchema` (`Booking`).

Server-side facts the Mini App relies on (from `apps/api/src/modules/waitlist/waitlist.service.ts`,
do not re-implement):
- Identity/ownership is re-resolved from the verified session's Telegram id; a `clientId`/entry that
  is not the caller's own is rejected with `ForbiddenException` (403). The body `clientId` is never
  trusted — it must equal the resolved row.
- **Join** is only valid for a slot that is **not** bookable. A still-bookable slot → `409`
  ("Training is still bookable; book it directly"); a duplicate active entry → `409` ("already on the
  waitlist"); a cancelled/completed training → `409`; an unknown training → `404`.
- **Accept** is atomic and never oversells: inside one transaction the entry is locked, must be
  `notified` within the window, the seat is re-checked free (`isBookable`), a `booked` booking is
  created, `bookedCount` is incremented and status recomputed (`open ⇔ full`), and the entry is marked
  `promoted`. A closed window → `409` ("Confirmation window has expired"); a re-taken seat → `409`
  ("The freed seat is no longer available"); a non-`notified` entry / already-booked → `409`; an
  unknown entry → `404`.

## Contracts / data the Mini App touches (reuse, do not redeclare)

From `@beosand/types`:
- `createWaitlistEntrySchema` / `CreateWaitlistInput` — `{ clientId, trainingId }` (parsed before send).
- `waitlistEntrySchema` / `WaitlistEntry` — `{ id, clientId, trainingId, position, status, addedAt,
  notifiedAt }` (join result, validated before use).
- `bookingSchema` / `Booking` — accept result (validated before use).
- `uuid` — to validate the `entryId` parsed from the deep link **before** any call.

No conflict-shaped union exists: a conflict is a NestJS `409` (`ConflictException`) and a not-found is
a `404`. The Mini App `ApiClient` already maps `409 → ConflictError` (carrying the server message
verbatim) and `404 → NotFoundError`; a `403`/other non-2xx becomes a generic `Error` with the server
message. So the conflict/expired/taken cases all arrive as a `ConflictError` whose `.message` is the
human string above — shown verbatim, not swallowed.

## API client + hooks (append to existing files, one method per slice)

`apps/miniapp/src/api/client.ts` — add two methods following the existing `createSingleBooking`
pattern (validate the body with the shared schema before send; validate the response with the entity
schema; rely on `request()`'s 401-reauth + `errorFromResponse` 409/404 mapping):

- `joinWaitlist(input: CreateWaitlistInput): Promise<WaitlistEntry>` → `POST /waitlist`, body
  `createWaitlistEntrySchema.parse(input)`, response `waitlistEntrySchema`.
- `acceptWaitlist(entryId: string): Promise<Booking>` → `POST /waitlist/${uuid.parse(entryId)}/accept`
  (parse the id with `uuid` first so a malformed deep link fails fast client-side, never hits the
  API), no body, response `bookingSchema`.

`apps/miniapp/src/api/hooks.ts` — add two mutations:

- `useJoinWaitlist(): UseMutationResult<WaitlistEntry, Error, string>` — takes a `trainingId`; reads
  `clientId` from the cached `useClient()` record's `id` (the same source `useCreateBooking` uses;
  **never client-asserted** — the server re-checks ownership). Throws "No resolved client" if
  `clientId == null`. `onSettled` invalidates the `available-slots` key prefix (a join can change the
  bookable list view), reusing `AVAILABLE_SLOTS_KEY_PREFIX`.
- `useAcceptWaitlist(): UseMutationResult<Booking, Error, string>` — takes the `entryId`. `onSettled`
  invalidates `available-slots` and (when S5 has landed) the my-bookings key, since accept creates a
  booking. It does **not** depend on `useClient()` for the call (ownership is session-derived
  server-side), but the accept screen should only mount for an onboarded client.

## Bot flow / Mini App flow

### Entry point 1 — JOIN (≤3 taps)

Two triggers, both calling `useJoinWaitlist(trainingId)`:

1. **Browse full-slot affordance.** `apps/miniapp/src/screens/BrowseScreen.tsx` already renders a
   "Лист ожидания" affordance (`onWaitlist`/`openWaitlist`) for a full slot. S6 **replaces** the
   current `push("home")` seam: tapping it pushes a small **waitlist-join confirm** sub-state (held in
   local screen state like the booking confirm, carrying the chosen `SlotCard` — not the global route
   stack), whose native **MainButton** ("Встать в лист ожидания") fires the join mutation. On success:
   haptic success + a "Вы в листе ожидания" state showing the returned `position` and a "К расписанию"
   action back to the list. (The endpoint returns only bookable slots, so a full card here is the
   defensive/stale-card case — the join is still the correct action.)
2. **Booking 409 → offer to join.** In the `ConfirmView` path, when `createSingleBooking` returns a
   `ConflictError` ("slot filled meanwhile"), S6 turns the current verbatim-message state into an
   **offer to join the waitlist** for the same `trainingId`: alongside the conflict message, a
   secondary action "Встать в лист ожидания" fires `useJoinWaitlist` for the selected slot's
   `trainingId`. This keeps the flow at open → confirm → (409) → join = ≤3 taps and reuses the
   already-selected slot.

The booking-conflict offer and the Browse full-slot path share one join confirm/result sub-component
so the success/conflict rendering can't drift.

### Entry point 2 — ACCEPT (deep link, ≤2 taps)

A waitlist-promotion push notification (sent by `apps/api` when a seat frees) carries a `web_app`
deep-link button `MINIAPP_URL?startapp=waitlist_<entryId>`. On boot the SPA reads `startParam` once
(`NavShell`), resolves it to the accept target, and renders an **Accept screen** whose native
**MainButton** ("Подтвердить") fires `useAcceptWaitlist(entryId)`. On success: haptic success + a
"Вы записаны!" state with a "К моим записям"/"К расписанию" action. On `ConflictError` (window
expired / seat re-taken / not acceptable): show the server message verbatim with a calm
"window closed" framing and an action back to Home — **no booking is shown**.

Because `POST /waitlist/:id/accept` takes only the entryId and there is no read endpoint to hydrate a
slot card from an entryId, the Accept screen does **not** render the training's date/time/price before
acceptance. **Default (recorded):** the screen presents the promotion context from the notification
("Освободилось место — подтвердите запись") plus the MainButton; the confirmed `Booking` is the result
detail. (Open question Q1 below if product wants a hydrated card.)

### Minimal nav/route extension (carry the entryId)

The route stack today carries bare `RouteId`s and `resolveStartParam` collapses `waitlist_<id>` to
`home`. S6 needs the `entryId` to reach the Accept screen. **Chosen minimal approach:** add a
**boot-time accept target** rather than parameterising the whole stack:

- `routes.ts`: add `"waitlist-accept"` to `RouteId` (a pushable sub-route, not a Home menu entry —
  it is only reachable via the deep link). Add `parseWaitlistAccept(startParam): string | null` that
  matches `waitlist_<uuid>` and returns a `uuid`-valid entryId or `null` (malformed → `null`, never
  throws). Keep `resolveStartParam` returning a `RouteId` for the existing callers; introduce a small
  typed boot result `resolveStart(startParam): { route: RouteId; acceptEntryId: string | null }`
  (or have `NavShell` call both `resolveStartParam` and `parseWaitlistAccept`) so existing `RouteId`
  callers stay unchanged.
- `NavShell`/`NavProvider`: when `parseWaitlistAccept` yields an entryId, seed the stack
  `["home", "waitlist-accept"]` and pass the `entryId` to the Accept screen as a prop captured once at
  boot (held in `NavShell` state, not in every stack frame). The native BackButton pops to Home as
  usual. This keeps the stack a bare `RouteId[]` and every existing `push`/`pop`/`RouteId` caller
  working; only the boot seam learns about the accept target.

This is the smallest change that carries the id: a single boot-time value, no generic param plumbing
through the stack.

## i18n (RU authoritative; mirror SR + EN — catalog-parity.spec enforces)

Add `miniapp.waitlist.*` keys to all three `packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts`
(reuse `miniapp.browse.waitlist`/`waitlistAria` where they already fit). New keys (RU shown):

- `miniapp.waitlist.joinConfirm` "Встать в лист ожидания"
- `miniapp.waitlist.joinConfirmHeader` "Лист ожидания"
- `miniapp.waitlist.joinConfirmBody` "Это место занято. Встать в лист ожидания — вам придёт уведомление, когда место освободится."
- `miniapp.waitlist.joinedTitle` "Вы в листе ожидания"
- `miniapp.waitlist.positionLabel` "Ваша позиция: {position}"
- `miniapp.waitlist.acceptHeader` "Освободилось место"
- `miniapp.waitlist.acceptBody` "Подтвердите запись, пока место свободно."
- `miniapp.waitlist.accept` "Подтвердить"
- `miniapp.waitlist.acceptedTitle` "Вы записаны!"
- `miniapp.waitlist.expiredTitle` "Окно подтверждения закрылось"
- `miniapp.waitlist.toHome` "На главную"

Conflict bodies are rendered from the server message verbatim; the `*.expired`/`conflict` strings are
the fallback only when the `ConflictError` has no message (mirroring the S4 `miniapp.booking.conflict`
fallback pattern).

## Native UX

Theme-adaptive light/dark + BeoSand coral accent; one native **MainButton** per screen for the
primary action (Join / Accept); **BackButton** wired by the shell; **HapticFeedback** on confirm and
success; reuse `ui/StateView`/`ui/ConfirmView` patterns and `ui/format`. ≤3 taps for join, ≤2 for
accept.

## Acceptance criteria

1. From Browse, tapping the full-slot "Лист ожидания" affordance leads to a join confirm whose
   MainButton joins the waitlist and shows the returned position — ≤3 taps. The old `push("home")`
   seam is removed.
2. When a single booking returns a 409 (slot filled meanwhile), the confirm step offers "Встать в
   лист ожидания" for the same training, which joins via `POST /waitlist`.
3. Opening the app via `startapp=waitlist_<entryId>` lands on the Accept screen; its MainButton calls
   `POST /waitlist/:id/accept`. On success it shows the confirmed booking state; the BackButton
   returns to Home.
4. `clientId` is taken from the cached `useClient()` record (never asserted by the client); the join
   call sends `{ clientId, trainingId }`.
5. A join that the server rejects (still-bookable / already on the list) shows the server's 409
   message verbatim and does not fabricate a "joined" state.
6. An accept whose window expired or whose seat was re-taken shows the server's 409 message verbatim
   (a "window closed" state) and renders **no booking**.
7. Every rendered value is validated against its `@beosand/types` contract before display; the
   `entryId` is `uuid`-validated before any call.

## Invariant to test

- **Accept never over-books.** Capacity is re-checked server-side inside the accept transaction; the
  Mini App only calls and renders. Test: an accept on a slot whose seat was re-taken (server returns
  409) is surfaced as a conflict and **no booking** is rendered; a successful accept renders exactly
  the returned `Booking`. (Service-level over-book protection is covered by the API's own tests; the
  Mini App test asserts it never renders a booking on a 409.)
- **Join only when appropriate.** A 409 from join ("still bookable" / "already on list") is shown,
  not converted into a success state.

## Unsafe / forbidden path to test

- Joining/accepting with **another client's id/entry** is rejected server-side (403/409); the Mini App
  surfaces the error and renders nothing as if it succeeded. The `clientId` the hook sends is always
  the caller's own cached id; a tampered value is re-checked and rejected by the service.
- A **malformed** `startapp` (e.g. `waitlist_notauuid`, missing id) yields `parseWaitlistAccept` →
  `null` → Home, never an accept call and never a thrown boot.
- A **malformed API response** (entry/booking not matching its schema) is rejected by the
  `ApiClient`'s `.parse` and surfaces as an error state, never rendered.

## Open questions (with chosen defaults)

- **Q1 — Hydrate the Accept screen with slot details?** There is no read endpoint to turn an entryId
  into a slot card. **Default:** render the promotion context + MainButton only; the confirmed
  `Booking` carries the detail post-accept. (Revisit only if product wants a date/time preview before
  accept, which would need a small new read endpoint — out of S6 scope.)
- **Q2 — Show waitlist position after join?** **Default:** yes, render the returned `position` in the
  joined state (it is in the contract and reassures the user). No extra call needed.
- **Q3 — Offer "join waitlist" on the Browse 409 too, or only the Confirm 409?** **Default:** both
  share one join sub-component; the Confirm-step 409 is the primary path (the Browse list rarely shows
  a full slot since the endpoint returns only bookable ones).

## Handoff

- `ui-designer`: Accept screen + join confirm/result states (native MainButton/BackButton, coral
  accent, StateView reuse).
- `frontend-implementer`: the two `ApiClient` methods + two hooks, the Browse/Confirm join wiring, the
  Accept screen, and the minimal nav boot-target extension.
- No `backend-implementer` work (endpoints reused as-is).
- `test-writer`: render/validation + the invariant (no booking rendered on accept 409) + the unsafe
  paths (malformed `startParam`, malformed response).
- `reviewer` + `security-reviewer`: confirm `clientId` is never client-asserted, the entryId is
  uuid-validated, and no domain math leaked into the Mini App.

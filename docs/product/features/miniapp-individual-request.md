# Feature brief: Mini App — request an individual training (S8)

Slug: `miniapp-individual-request` · Slice: S8 · Branch: `feature/miniapp` (per-slice
`feature/miniapp-individual-request`) · Depends on: FOUNDATION, S1.

## Goal

Let a client request a one-on-one (individual) training with a chosen trainer from inside the
Telegram Mini App, in **3 taps max** (Home → Individual → pick trainer → "Запросить тренировку").
The request is **notification-only** — the API routes delivery through the trainer-first individual
request path and persists no booking. The Mini App replaces the shared
`PlaceholderScreen` currently rendered on the `individual` route with a real
`TrainerRequestScreen`.

This slice carries the slice plan's **one backend change**: a security-critical identity fix so the
existing `POST /trainers/:id/individual-request` endpoint works for a Mini App client session (which
sends **no** `x-telegram-id`) while staying self-only and keeping the bot working unchanged. **No new
contract fields** — the change is identity resolution only.

## Spec refs

- Plan `C:\Users\ilsac\.claude\plans\giggly-gathering-bee.md` — slice table row S8; "API gap to fix
  in S8 & S9 (security-critical)"; per-slice acceptance "S8: trainer → 'Запросить'; soft
  `trainer-unavailable` state. *Invariant:* self-only. *Unsafe:* spoofed telegramId can't request for
  another user."
- Feature 8 (individual-training request) — existing bot/API behaviour being reused.
- Repo memory `miniapp-two-header-identity` — the load-bearing two-header split this fix conforms to.
- `CLAUDE.md` invariants; `.claude/rules/{telegram-bot,nestjs-layering,security,frontend,zod-contracts}.md`.

## Identity model (two-header split — the barrier this slice extends)

The Mini App client session is bridged **server-side** to `x-client-telegram-id` **only**, never
`x-telegram-id` (the latter is only the bot's raw server-to-server header, or an admin session). The
`SessionBridgeMiddleware`:
- strips any inbound `x-client-telegram-id` first (so a caller can't forge a client identity), then
- for a `scope:"client"` token sets `x-client-telegram-id = sub` and **deletes** `x-telegram-id`;
- for a `scope:"admin"` token sets `x-telegram-id = sub`.

Self/client endpoints in `apps/api` therefore resolve the actor as
`actor = (x-client-telegram-id ?? x-telegram-id)` (clients/bookings/waitlist controllers all use this
exact pattern, with the `@Headers("x-client-telegram-id")` param placed **last**). `GET /trainers`
stays a public reference read; **no admin surface is broadened** by this slice.

## Contracts / tables

No schema change, **no new contract fields**. Reused contracts from `@beosand/types`
(`packages/types/src/training-contracts.ts`):

- `trainerSchema` / `Trainer` — `{ id, name, type: "main"|"guest", status, telegramId,
  individualVisible }` (for `GET /trainers?scope=individual`; the Mini App renders `name`/`type` and
  never the trainer's `telegramId`).
- `individualRequestSchema` = `{ telegramId: number }` `.strict()` — the request body, **unchanged**.
  The Mini App keeps sending its own `telegramId` (from the session `getMe()`) for back-compat with
  the bot's body shape; the server now treats it as a value to **verify against the actor**, not to
  trust.
- `individualRequestResultSchema` / `IndividualRequestResult` =
  `{ delivered: boolean, reason?: "trainer-unavailable" }` `.strict()` — **unchanged**. `delivered:
  false` drives the calm soft state, not an error.

No persisted row: the request is notification-only by design. Delivery routing is trainer-first with
admin/manager fallback only when the trainer has no numeric `telegramId` or trainer DM delivery
fails.

## API

| Method + path | Auth | Change | Notes |
|---|---|---|---|
| `GET /trainers?scope=individual` | public reference read | use for picker | Returns active trainers where `individualVisible = true`; hidden active trainers stay out of the Mini App picker. |
| `POST /trainers/:id/individual-request` | client self-only | **identity only** | Resolve actor from the verified session; reject a body `telegramId` that ≠ actor. Active hidden trainers can still be requested directly by id. Returns `IndividualRequestResult`. |

### The backend change (security-critical, the only one in this slice)

Today the controller reads the actor from `x-telegram-id` only and asserts `body.telegramId ===
actor` — the bot's trusted server-to-server pattern. A Mini App client token sends **no**
`x-telegram-id`, so the call would 400 ("Missing or invalid x-telegram-id header"). Fix it to mirror
the clients/bookings/waitlist controllers:

`apps/api/src/modules/trainers/trainers.controller.ts` — `requestIndividual(...)`:
- Add a trailing `@Headers("x-client-telegram-id") clientTelegramIdHeader?: string` param (placed
  **last**, after `@Param` and `@Body`, matching `BookingsController.createSingle/createGroup`).
- Resolve `actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? telegramIdHeader)`.
- Keep the existing self-only assertion: `if (input.telegramId !== actorTelegramId) throw new
  ForbiddenException(...)`. With the session-derived actor this is now the **impersonation barrier**:
  the body `telegramId` must match the **verified** actor, so a spoofed/foreign body id is rejected.
- Call `this.trainers.requestIndividual(trainerId, actorTelegramId)` (signature unchanged).

`apps/api/src/modules/trainers/trainers.service.ts` — `requestIndividual` continues to take the
resolved `requesterTelegramId`, look up the client (404 if not onboarded) and active trainer (404 if
missing/inactive), then return the unchanged `IndividualRequestResult`. This slice changes only the
identity seam; delivery routing is defined in
`docs/product/features/trainer-first-individual-request-routing.md` and must stay trainer-first with
admin/manager fallback only when direct trainer delivery is unavailable. The doc comment's
"header/body telegram-id equality is enforced in the controller" stays accurate. Do **not** move
authz into the service; do **not** add `isAdmin`/scope checks (this is a client self endpoint, not
admin).

Why "reject mismatch" rather than "ignore body and use the actor": the body field is unchanged for
bot back-compat, and the bot already sends a matching `telegramId`; rejecting a mismatch is the
strictest safe behaviour and preserves the existing test contract. The **authoritative** identity is
the verified actor — the body can only ever equal it or be rejected, never override it.

### Bot compatibility (must not regress)

The bot calls this endpoint with a raw `x-telegram-id` header **and** a matching body `telegramId`
(no `x-client-telegram-id`). After the fix: `clientTelegramIdHeader` is absent → actor falls back to
`telegramIdHeader` → body equals actor → unchanged behaviour. Bot path stays green.

## Mini App flow (`apps/miniapp`)

Replace the `individual` route's `PlaceholderScreen` with `TrainerRequestScreen` in
`apps/miniapp/src/router/Router.tsx` (`case "individual": return <TrainerRequestScreen />;`). The
route id, Home menu entry (`miniapp.home.individual`), and the `individual` deep-link mapping already
exist in `router/routes.ts` — no router-table change beyond the screen swap.

Three local sub-states, one native MainButton per actionable state, BackButton owned by the shell:

1. **list** — `useIndividualTrainers()` / `listIndividualTrainers()` (`GET
   /trainers?scope=individual`); render active, individual-visible trainers as native `Cell` rows
   (name + a `main`/`guest` type label, leading coral icon, trailing chevron). Tapping a row fires a
   selection haptic and advances to confirm. No MainButton on the bare list. Loading / error / empty
   via the shared `StateView` states (`LoadingState`/`ErrorState`/`EmptyState`), exactly like
   `GroupBookingScreen`.
2. **confirm** — show the chosen trainer's facts; native MainButton **"Запросить тренировку"**
   (`miniapp.individual.request`) with a `FallbackButton` mirror for non-Telegram/dev. On tap:
   selection haptic, then the request mutation.
3. **result** —
   - `delivered: true` → success state ("Запрос отправлен"), success haptic, MainButton back to
     Home.
   - `delivered: false` (`reason: "trainer-unavailable"`) → a **calm soft state**
     ("Тренер сейчас недоступен, попробуйте выбрать другого"), **not** an error/red alert; offer
     "выбрать другого тренера" (back to the list) and "на главную". No haptic-error.

New ApiClient method + hook (append, ordered, per the plan's shared-touchpoints note):

- `apps/miniapp/src/api/client.ts` — `listIndividualTrainers(): Promise<Trainer[]>`: `GET
  /trainers?scope=individual`, response validated against `trainersSchema`.
- `apps/miniapp/src/api/client.ts` — `requestIndividualSession(trainerId: string):
  Promise<IndividualRequestResult>`: `POST /trainers/:id/individual-request` with body
  `individualRequestSchema.parse({ telegramId })`, response validated against
  `individualRequestResultSchema`. The `telegramId` is the caller's **own** verified session id,
  never user input — the server re-derives and verifies it.
- `apps/miniapp/src/api/hooks.ts` — `useRequestIndividual()`: a mutation whose arg is the chosen
  `trainerId`; the hook supplies `telegramId` from the session (`useApiClient().getMe()`). No
  query-cache invalidation (notification-only; nothing in the cache changes). A non-`trainer-
  unavailable` failure surfaces as a generic error state; the `delivered:false` result is **success**
  (not an error) and drives the soft state.

The `delivered:false` result is a **successful** HTTP response (200), so it flows through `onSuccess`,
not `onError`. Only a true failure (network/4xx/5xx) is an error.

## Native UX

Theme-adaptive (light/dark) + BeoSand coral accent; `@telegram-apps/telegram-ui` components
(`List`/`Section`/`Cell`/`Placeholder`); one native MainButton per actionable sub-state; BackButton
wired by the shell (pops the whole route — in-screen "back" is local state); HapticFeedback on
select/confirm/success (none on the soft-unavailable state); ≤3 taps. All strings via `@beosand/i18n`
(RU authoritative, SR/EN parity enforced).

## i18n (add to `packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts`)

Reuse existing `miniapp.home.individual` / `miniapp.home.individualHint` and `miniapp.common.*`. Add
(RU authoritative; mirror SR + EN — parity is enforced):

- `miniapp.individual.listTitle` — "Выберите тренера"
- `miniapp.individual.typeMain` / `miniapp.individual.typeGuest` — trainer-type labels
- `miniapp.individual.confirmTitle` / `miniapp.individual.confirmBody`
- `miniapp.individual.request` — MainButton "Запросить тренировку"
- `miniapp.individual.sentTitle` / `miniapp.individual.sentBody` — delivered success
- `miniapp.individual.unavailableTitle` — "Тренер сейчас недоступен"
- `miniapp.individual.unavailableBody` — calm guidance (try another trainer)
- `miniapp.individual.pickAnother` / `miniapp.individual.toHome`
- `miniapp.individual.none` / `miniapp.individual.noneBody` — empty list state

## Invariants honored

- **Interaction layer only:** no domain logic/money/availability/capacity math in the Mini App; every
  response Zod-validated against a `@beosand/types` contract before render. No `@beosand/config`
  import; config via `VITE_*` only.
- **Self-only (the invariant this slice tests):** a client can request only as themselves — the body
  `telegramId` must equal the **verified** session actor.
- **No admin broadening:** `GET /trainers` stays public read-only; the request endpoint stays a client
  self endpoint (no `isAdmin`/admin guard added).
- **Picker visibility:** the Mini App individual picker uses `GET /trainers?scope=individual`, so
  hidden active trainers are excluded from the picker; direct request by id remains allowed for hidden
  active trainers.
- **No court/roster leakage** (N/A here — no court flow), and the trainer's `telegramId` is never
  rendered in the UI.
- **Notification-only:** no booking/row is persisted by an individual request.

## Acceptance criteria

1. From Home, a client reaches the trainer list, picks a trainer, and sends a request in **≤3 taps**;
   the chosen flow uses the native MainButton "Запросить тренировку" and BackButton.
2. A Mini App client session (no `x-telegram-id`, only the bridged `x-client-telegram-id`) can
   successfully send an individual request; notification delivery follows the trainer-first routing
   brief.
3. When the API returns `delivered: false` (`trainer-unavailable`), the screen renders a **calm soft
   state** (not a red error), offering "выбрать другого тренера" / "на главную".
4. The existing bot individual-request flow (raw `x-telegram-id` + matching body `telegramId`) still
   works unchanged.
5. Gate green with plain `pnpm`: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; narrow loop
   `pnpm --filter @beosand/miniapp typecheck lint test build` and
   `pnpm --filter @beosand/api test typecheck` (rebuild `@beosand/types` + `@beosand/i18n` first so
   the miniapp reads fresh `dist`).

## Tests

Backend (`apps/api`), update `trainers.controller.spec.ts` (+ keep `trainers.service.spec.ts` green):

- **Mini App path works:** actor from `x-client-telegram-id` with **no** `x-telegram-id` and a
  matching body `telegramId` → delivers / returns the typed result. (New — pass the new last param.)
- **Bot path unchanged:** `x-telegram-id` set, no `x-client-telegram-id`, matching body → still
  delivers. (Adapt the existing "on a self request delivers" test to the new signature.)
- **Unsafe — impersonation rejected (the invariant):** a body `telegramId` ≠ the session actor (set
  via `x-client-telegram-id`) → `ForbiddenException`, `requestIndividualSession` not called. Also
  cover the existing `x-telegram-id` mismatch case.
- **Missing identity:** neither header present → `BadRequestException` before any work.
- Keep existing boundary cases (non-uuid trainer id; strict body rejects extra field).

Frontend (`apps/miniapp`), a `trainer-request-flow.spec.tsx` modelled on `group-booking-flow.spec.tsx`:

- **Render/validation:** list renders trainers from `listIndividualTrainers()`; hidden trainers are
  excluded by the `GET /trainers?scope=individual` API path. A malformed trainer response is rejected
  by the contract (unsafe path) and shows the error state.
- **3-tap happy path:** pick trainer → MainButton → `delivered:true` renders the success state.
- **Soft failure:** `delivered:false` renders the calm `unavailable` state (assert it is NOT the
  generic error state and offers "pick another").
- **Self-only at the client seam:** the mutation sends the session `telegramId` (from `getMe()`),
  never a screen-supplied id — assert the request body carries the session id.

i18n: SR/EN parity test (existing harness) stays green with the new keys.

## Dependencies

- FOUNDATION (auth seam, `MiniappApiClient`, providers, native shell) and **S1** (resolved/cached
  `Client` and the session `getMe()` identity). Individual picker reuse comes from
  `GET /trainers?scope=individual`.
- Reuses: `tg/buttons.ts` (`useMainButton`/`useBackButton`/haptics), `ui/StateView`,
  `ui/FallbackButton`, `router/NavProvider`, `listIndividualTrainers`, the `individual` route + Home
  entry + deep link already in `router/routes.ts`.

## Open questions (each with a chosen default)

1. **Reject vs silently coerce a mismatched body `telegramId`?** — **Default: reject with
   `ForbiddenException`** (keeps the existing test contract and is the strictest safe behaviour; the
   authoritative identity is the verified actor regardless).
2. **Eventually drop the body `telegramId` entirely (derive solely from the session)?** — **Default:
   keep it this slice** for bot back-compat (the bot still sends it); a follow-up can remove it from
   the contract once the bot's client flows are retired in S10. Recorded as future cleanup, not part
   of S8.
3. **Render trainer `type` (main/guest) in the list?** — **Default: yes**, as a short subtitle label;
   it is non-sensitive reference data already in `GET /trainers?scope=individual` and helps the
   choice. Never render `telegramId`.

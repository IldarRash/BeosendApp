# Feature brief: Mini App — request a court rental (S9)

Slug: `miniapp-court-request` · Slice: S9 · Branch: `feature/miniapp` (per-slice
`feature/miniapp-court-request`) · Depends on: FOUNDATION (auth seam, `MiniappApiClient`, providers,
native shell, `court` route). Independent of S1 — the court flow keys off the session Telegram id,
not a resolved `clientId`.

## Goal

Let a client request a court rental for a **time + duration only** from inside the Telegram Mini App,
in a tight forward flow: Home → Аренда корта → pick a date → pick a start time (from server
availability) → pick a duration (1 / 1.5 / 2 h) → review the server-computed RSD price preview →
submit → a calm **pending** state ("Запрос отправлен, мы назначим корт"). The client **never sees or
chooses a court number** — an admin assigns the court later (C4, outside this slice).

This slice replaces the shared `PlaceholderScreen` rendered on the `court` route — the **last
placeholder** in the router — with a real `CourtRequestScreen`.

It also carries the slice plan's **one backend change**: a security-critical identity fix so the
existing `POST /court-requests/preview` and `POST /court-requests` work for a Mini App client session
(which sends **no** `x-telegram-id`) while staying self-only and keeping the bot working unchanged.
**No new contract fields** — the change is identity resolution only.

## Spec refs

- Plan `C:\Users\ilsac\.claude\plans\giggly-gathering-bee.md` — slice table row S9; "API gap to fix in
  S8 & S9 (security-critical)"; per-slice acceptance "S9: date→time→duration→price preview→submit→
  pending. *Invariant:* 6-courts-per-hour reflected in offered hours; **court number never rendered**.
  *Unsafe:* client-sent price ignored."
- Edition 2 (court-rental requests) — existing bot/API behaviour (C2/C3) being reused.
- Repo memory `miniapp-two-header-identity` — the load-bearing two-header split this fix conforms to.
- `CLAUDE.md` court invariants; `.claude/rules/{telegram-bot,nestjs-layering,security,frontend,zod-contracts}.md`.

## Identity model (two-header split — the barrier this slice extends)

The Mini App client session is bridged **server-side** to `x-client-telegram-id` **only**, never
`x-telegram-id` (the latter is only the bot's raw server-to-server header, or an admin session). The
`SessionBridgeMiddleware` strips any inbound `x-client-telegram-id` first (so a caller can't forge a
client identity), then for a `scope:"client"` token sets `x-client-telegram-id = sub` and **deletes**
`x-telegram-id`; for a `scope:"admin"` token sets `x-telegram-id = sub`.

Self/client endpoints in `apps/api` therefore resolve the actor as
`actor = (x-client-telegram-id ?? x-telegram-id)` — exactly the clients/bookings/waitlist/trainers
controllers' pattern, with the `@Headers("x-client-telegram-id")` param placed **last**.
`GET /court-requests/availability` stays a **public** reference read (no identity). The admin court
endpoints (`GET /court-requests` queue, `:id`, `:id/free-courts`, `:id/confirm`, `:id/reject`) are
**untouched** — they stay admin-only via `x-telegram-id` + `assertAdmin`, and the Mini App never calls
them (a court id must never reach the client).

## Contracts / tables

No schema change, **no new contract fields**. Reused contracts from `@beosand/types`
(`packages/types/src/court-contracts.ts`), all carrying **no court id** on the client path:

- `courtAvailabilityQuerySchema` / `CourtAvailabilityQuery` = `{ date }` — the availability query.
- `courtAvailabilitySchema` / `CourtAvailability` = `{ date, slots: SlotAvailability[] }`, where
  `slotAvailabilitySchema` = `{ startTime, freeCourts }`. The server returns **only** offerable
  30-min start times whose covered slots all still have a free court (the 6-per-hour limit already
  applied), each with a free-court **count**. **Never a court id/number.**
- `previewCourtRequestSchema` / `PreviewCourtRequest` = `{ telegramId, date, startTime, durationHours:
  1|1.5|2 }` — the preview body, **unchanged**. The Mini App keeps sending its own session
  `telegramId` for bot back-compat; the server now treats it as a value to **verify against the
  actor**, not to trust.
- `courtRequestPreviewSchema` / `CourtRequestPreview` = `{ date, startTime, endTime, durationHours,
  priceRsd, available }` — the server-computed preview the client renders. `priceRsd` is authoritative
  (RSD, whole dinars); `available` is the still-offerable flag.
- `createCourtRequestSchema` / `CreateCourtRequest` = `previewCourtRequestSchema` (same shape) — the
  create body, **unchanged**.
- `courtRequestSchema` / `CourtRequest` = the persisted request (`status: "pending"`, `courtId: null`
  on creation). The screen only needs `status`/`date`/`startTime`/`priceRsd` for the pending state and
  **never renders `courtId`** (null here anyway, by construction).
- `courtDurationHours` = `1 | 1.5 | 2` — the duration union for the picker options.

The admin-only `courtRequestAdminViewSchema` / `courtLoadGridSchema` / `courtSchema` carry a court id
and **MUST never** be referenced by the Mini App client/hook.

## API

| Method + path | Auth | Change | Notes |
|---|---|---|---|
| `GET /court-requests/availability?date=YYYY-MM-DD` | public reference read | **none** | Returns `CourtAvailability` (offerable start times + free-court counts; no court id). The server applies the 6-per-hour limit. |
| `POST /court-requests/preview` | client self-only | **identity only** | Resolve actor from the verified session; reject a body `telegramId` ≠ actor. Returns `CourtRequestPreview` (server price + availability). |
| `POST /court-requests` | client self-only | **identity only** | Resolve actor from the verified session; reject a body `telegramId` ≠ actor. Creates a `pending` request (no court assigned). Returns `CourtRequest`. |

### The backend change (security-critical, the only one in this slice)

Today both `POST /court-requests` and `POST /court-requests/preview` read identity solely from the
**body** `telegramId` (the bot's trusted server-to-server pattern) — `previewRequest`/`createRequest`
in `court-requests.service.ts` use `input.telegramId` directly, and the controller does **no** header
check. A Mini App client token sends no `x-telegram-id` and its bridged `x-client-telegram-id` is
currently ignored, so an attacker could submit **any** `telegramId` in the body and act as another
client. Fix it by deriving the actor from the **verified session** and verifying the body against it.

`apps/api/src/modules/court-requests/court-requests.controller.ts` — `preview(...)` and `create(...)`:
- Add a trailing `@Headers("x-telegram-id") rawTelegramId?: string` **and** a trailing
  `@Headers("x-client-telegram-id") clientTelegramIdHeader?: string` param (placed **last**, matching
  `BookingsController.createSingle/createGroup`). Keep `@Body() body: unknown` before them.
- Resolve `actorTelegramId = parseTelegramId(clientTelegramIdHeader ?? rawTelegramId)` (reuse the
  existing `parseTelegramId` helper / `telegramIdHeader` coercion already in this controller).
- After Zod-validating the body, assert `parsed.data.telegramId === actorTelegramId`; on mismatch
  throw `ForbiddenException("You can only request a court for yourself.")` — this is the impersonation
  barrier (the body id must equal the **verified** actor). `availability` (the public GET) is
  unchanged.
- Call the service unchanged: `this.service.previewRequest(parsed.data)` /
  `this.service.createRequest(parsed.data)` (their signatures take the full input incl. `telegramId`).

`apps/api/src/modules/court-requests/court-requests.service.ts` — **unchanged**: `previewRequest` and
`createRequest` still take the validated input, compute the price server-side (`courtPriceRsd`), apply
working-hours + the per-slot availability rule, and resolve/look up the client by
`findActiveClientByTelegramId(input.telegramId)`. With the controller now guaranteeing
`input.telegramId === verified actor`, the service's existing telegram-id lookup **is** the verified
identity. Do **not** move the actor check into the service; do **not** add `isAdmin`/scope checks (this
is a client self endpoint — the admin methods keep their own `assertAdmin`).

Why "reject mismatch" rather than "ignore body and use the actor": the body field is unchanged for bot
back-compat (the bot already sends a matching `telegramId`), and rejecting a mismatch is the strictest
safe behaviour — the **authoritative** identity is the verified actor; the body can only equal it or be
rejected, never override it. (Mirrors the S8 individual-request decision.)

### Bot compatibility (must not regress)

The bot calls preview/create with a raw `x-telegram-id` header **and** a matching body `telegramId`
(no `x-client-telegram-id`). After the fix: `clientTelegramIdHeader` is absent → actor falls back to
`rawTelegramId` → body equals actor → unchanged behaviour. Bot path stays green.

## Mini App flow (`apps/miniapp`)

Replace the `court` route's `PlaceholderScreen` with `CourtRequestScreen` in
`apps/miniapp/src/router/Router.tsx` (`case "court": return <CourtRequestScreen />;`). The `court`
route id, the Home entry (`miniapp.home.court`), and the `court` deep-link mapping already exist in
`router/routes.ts` — no router-table change beyond the screen swap (after which `PlaceholderScreen` /
the `default` arm is dead and **must be removed** per the Refactoring rule, since `court` was its last
consumer; confirm no other route falls through to it first).

One screen, forward local sub-states (BackButton owned by the shell pops the whole route; in-screen
steps are local state), one native MainButton per actionable step:

1. **date** — a compact date picker offering a small forward window of selectable dates (e.g. today +
   the next ~13 days), each as a native `Cell`/option labelled via `formatDayMonth` + weekday key.
   The offered date list is a **display input** (like `offeredMonths`/`todayLocalDate` in `ui/format`,
   single-timezone Europe/Belgrade, local calendar fields, never UTC slicing) — **not** a domain
   decision; the server re-validates the date and owns availability. No MainButton until a date is
   chosen; selection fires a selection haptic and advances.
2. **time** — `useCourtAvailability(date)` → render only the returned `slots` as options:
   `startTime` + a free-courts **count** badge (e.g. "{count} свободно"). **Never** a court id/number.
   Empty `slots` → a calm empty state ("На эту дату нет свободного времени, выберите другую дату").
   Loading/error via the shared `StateView`. Selecting a start time advances to duration.
3. **duration** — the three `courtDurationHours` options (1 / 1.5 / 2 h) via `OptionList`; selecting a
   duration triggers the price preview.
4. **preview** — `useCourtPreview()` (or a preview step of the flow) shows the server's
   `CourtRequestPreview`: date, `startTime`–`endTime`, duration, and the **server** `priceRsd` via
   `formatRsd` (display only — the client never computes or sends a price). Native MainButton
   **"Отправить заявку"** (`miniapp.court.submit`) with a `FallbackButton` mirror for non-Telegram/dev.
   If `available === false` (slot filled meanwhile), show a calm "выберите другое время" note routing
   back to the time step — not a red error. On submit: selection haptic, then the create mutation.
5. **pending** — on success, a calm pending state, success haptic, header "Запрос отправлен"
   (`miniapp.court.sentTitle`) + body "Мы назначим корт и сообщим вам" (`miniapp.court.sentBody`).
   **No court number is shown** (none is assigned, and the client path carries none). MainButton "На
   главную". A 409 on create (slot taken at submit time) surfaces the server message verbatim
   (`ConflictError`) with a "выбрать другое время" path back to the time step.

New ApiClient methods + hooks (append, ordered, per the plan's shared-touchpoints note):

- `apps/miniapp/src/api/client.ts`:
  - `getCourtAvailability(date: string): Promise<CourtAvailability>` — `GET
    /court-requests/availability?date=...`, response validated against `courtAvailabilitySchema`. A
    public read routed through the authed `request` path (so a stale session re-mints transparently),
    like `listLevels`/`listTrainers`/`listGroups`.
  - `previewCourtRequest(input: { date; startTime; durationHours }): Promise<CourtRequestPreview>` —
    `POST /court-requests/preview` with body `previewCourtRequestSchema.parse({ telegramId, ...input })`
    where `telegramId` is the caller's **own** session id (`getMe()?.telegramId`, never user input —
    reject with `AuthError` if absent, mirroring `requestIndividualSession`). Response validated against
    `courtRequestPreviewSchema`.
  - `createCourtRequest(input: { date; startTime; durationHours }): Promise<CourtRequest>` — `POST
    /court-requests` with body `createCourtRequestSchema.parse({ telegramId, ...input })` (same session
    `telegramId` rule). Response validated against `courtRequestSchema`. A 409 surfaces as
    `ConflictError`.
- `apps/miniapp/src/api/hooks.ts`:
  - `useCourtAvailability(date)` — a query keyed by date, disabled until a date is chosen; the server
    owns the offered times and the 6-per-hour limit.
  - `useCourtPreview()` — a mutation (or query keyed by date+startTime+durationHours) that fetches the
    server price/availability; the hook supplies the session `telegramId`. Display-only result.
  - `useCreateCourtRequest()` — a mutation whose arg is `{ date, startTime, durationHours }`; the hook
    supplies the session `telegramId`. On settle, invalidate the affected-date availability query (a
    new pending request does not change confirmed availability, but keeping the date fresh is cheap and
    correct). A 409 surfaces as `ConflictError` for the calm "pick another time" state.

The screen does **no** money/availability/duration math: prices, end time, offered start times, and
the availability flag all come from the server. The `telegramId` in every body is the session id, never
a screen-supplied value — the server re-derives and verifies it.

## Native UX

Theme-adaptive (light/dark) + BeoSand coral accent; `@telegram-apps/telegram-ui` components
(`List`/`Section`/`Cell`/`Placeholder` + `OptionList` for duration); one native MainButton per
actionable sub-state (none on the bare date/time lists; "Отправить заявку" on preview; "На главную"
on pending); BackButton wired by the shell (pops the whole route — in-screen "back" is local state);
HapticFeedback on select/submit/success (no haptic-error on the calm availability/pending states);
≤3 meaningful choices then submit. All strings via `@beosand/i18n` (RU authoritative, SR/EN parity
enforced). A **court number is never rendered** anywhere in this screen.

## i18n (add to `packages/i18n/src/catalogs/{ru,sr,en}/miniapp.ts`)

Reuse existing `miniapp.home.court` / `miniapp.home.courtHint`, `miniapp.common.*`, `miniapp.weekday.*`,
`miniapp.month.*`, and `miniapp.booking.{dateLabel,timeLabel,priceLabel}`. Add (RU authoritative;
mirror SR + EN — parity enforced):

- `miniapp.court.pickDate` — "Выберите дату"
- `miniapp.court.pickTime` — "Выберите время"
- `miniapp.court.freeCount` — "{count} свободно" (free-court count chip; a COUNT, never a court number)
- `miniapp.court.noTimesTitle` / `miniapp.court.noTimesBody` — empty-availability state (pick another date)
- `miniapp.court.pickDuration` — "Длительность"
- `miniapp.court.duration1` / `miniapp.court.duration1_5` / `miniapp.court.duration2` — "1 час" / "1,5 часа" / "2 часа"
- `miniapp.court.durationLabel` — confirm-row label for duration
- `miniapp.court.previewTitle` — "Подтверждение заявки"
- `miniapp.court.previewBody` — calm summary footer (date · time · duration · price)
- `miniapp.court.priceLabel` — reuse `miniapp.booking.priceLabel` ("Стоимость") rather than a duplicate
- `miniapp.court.submit` — MainButton "Отправить заявку"
- `miniapp.court.sentTitle` — "Запрос отправлен"
- `miniapp.court.sentBody` — "Мы назначим корт и сообщим вам." (no court number)
- `miniapp.court.unavailableTitle` / `miniapp.court.unavailableBody` — calm "this time is taken, pick another"
- `miniapp.court.pickAnotherTime` — "Выбрать другое время"
- `miniapp.court.toHome` — "На главную"
- `miniapp.court.conflict` — conflict fallback (used only when a `ConflictError` carries no message)

## Invariants honored

- **Interaction layer only:** no domain logic / money / availability / capacity / duration math in the
  Mini App; every response Zod-validated against a `@beosand/types` contract before render. No
  `@beosand/config` import; config via `VITE_*` only.
- **Court number never rendered or chosen (the headline invariant):** the client picks a time +
  duration only; the client-facing contracts (`CourtAvailability`, `CourtRequestPreview`,
  the created `CourtRequest` with `courtId: null`) carry no court id, so this holds by construction —
  and the screen renders **none** anywhere. The admin court-id-bearing endpoints/contracts are never
  called or imported by the Mini App.
- **6-courts-per-hour is server-enforced:** the offered start times come straight from
  `GET /court-requests/availability`, which already applied the limit; the Mini App never filters or
  computes availability and never offers a non-returned hour.
- **Price is RSD, server-computed:** the displayed price is the preview's `priceRsd`; the client never
  sends or computes a price (the server ignores any client-sent amount — the create/preview bodies have
  no price field).
- **Self-only:** a client can request only as themselves — the body `telegramId` must equal the
  verified session actor (the impersonation barrier this slice adds).
- **No admin broadening:** `availability` stays public read-only; preview/create stay client self
  endpoints; the admin queue/confirm/reject/free-courts endpoints are untouched and unreachable from
  the Mini App.

## Acceptance criteria

1. From Home → Аренда корта, a client picks a date, a start time (from the server's offered times), a
   duration, sees the **server** RSD price preview, submits via the native MainButton, and lands on a
   calm **pending** state — with **no court number shown at any step** and the BackButton wired.
2. The start-time list shows only times the server returned (free-court **counts**, never court ids);
   an over-booked hour (6 confirmed) never appears, because the server's availability already excludes
   it.
3. A Mini App client session (no `x-telegram-id`, only the bridged `x-client-telegram-id`) can preview
   and create a court request; the pending request appears in the admin queue (running app) and the
   client receives the existing bot notification on later admin confirmation/rejection.
4. The existing bot court-request flow (raw `x-telegram-id` + matching body `telegramId`) still works
   unchanged for both preview and create.
5. The `court` route renders `CourtRequestScreen` (not the placeholder); the now-unused
   `PlaceholderScreen` / router `default` arm is removed (it was its last consumer).
6. Gate green with plain `pnpm`: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; narrow loop
   `pnpm --filter @beosand/miniapp typecheck lint test build` and
   `pnpm --filter @beosand/api test typecheck` (rebuild `@beosand/types` + `@beosand/i18n` first so the
   miniapp reads fresh `dist`).

## Tests

Backend (`apps/api`), `court-requests.controller.spec.ts` (new or extended; keep
`court-requests.service.spec.ts` green):

- **Mini App path works (preview + create):** actor from `x-client-telegram-id`, **no** `x-telegram-id`,
  matching body `telegramId` → service called with the parsed input; returns the typed result.
- **Bot path unchanged (preview + create):** `x-telegram-id` set, no `x-client-telegram-id`, matching
  body → still calls the service. (Adapt to the new param signature.)
- **Unsafe — impersonation rejected (the invariant):** a body `telegramId` ≠ the session actor (set via
  `x-client-telegram-id`) → `ForbiddenException`, the service create/preview not called. Cover both
  preview and create, and the equivalent `x-telegram-id` mismatch case.
- **Missing identity:** neither header present → `BadRequestException` before any work.
- **`availability` stays public + unchanged:** the GET takes no identity header and still returns
  `CourtAvailability` for a date (regression guard that the public read wasn't gated).
- **Admin endpoints untouched:** a sanity assertion (or unchanged existing tests) that
  queue/confirm/reject/free-courts still require `x-telegram-id` admin and were not given the
  client-header fallback.
- Keep existing boundary cases (invalid `durationHours`, malformed body → 400).

Service-level (already covered, keep green): client-sent amount ignored / price computed server-side;
out-of-hours rejected; unavailable slot → `ConflictException` on create.

Frontend (`apps/miniapp`), a `court-request-flow.spec.tsx` modelled on `group-booking-flow.spec.tsx`:

- **Render/validation:** the time step renders offered slots from a stubbed `getCourtAvailability`; a
  malformed availability/preview/create response is rejected by the contract (unsafe path) and shows
  the error state — assert the screen never renders a court id/number from any response.
- **Happy path:** pick date → pick time (count shown, no court number) → pick duration → preview shows
  the **server** `priceRsd` → MainButton → pending state ("Запрос отправлен"). Assert the rendered
  price is exactly the stubbed server value (the screen computes none).
- **Unavailable at preview/submit:** `available:false` (or a create `ConflictError`) renders the calm
  "pick another time" state (assert it is NOT a generic red error and offers a path back to the time
  step); no court number anywhere.
- **Self-only / price at the client seam:** the preview and create request bodies carry the session
  `telegramId` (from `getMe()`), never a screen-supplied id, and carry **no** price field — assert the
  serialized body shape.

i18n: SR/EN parity test (existing harness) stays green with the new `miniapp.court.*` keys.

## Dependencies

- FOUNDATION (auth seam, `MiniappApiClient` + typed errors, providers, native shell, the `court` route
  + Home entry + deep link already in `router/routes.ts`). Not gated on S1 — the court flow uses the
  session Telegram id, never a resolved `clientId`.
- Reuses: `tg/buttons.ts` (`useMainButton`/`useBackButton`/`hapticSelection`/`hapticSuccess`),
  `ui/StateView` (`LoadingState`/`ErrorState`/`EmptyState`), `ui/OptionList`, `ui/FallbackButton`,
  `ui/format` (`formatRsd`/`formatDayMonth`/`formatTimeRange`/`weekday*Key`/`todayLocalDate` pattern
  for the offered date window), `router/NavProvider`. `getCourtAvailability` is a new public read added
  to the ApiClient by this slice.

## Open questions (each with a chosen default)

1. **Reject vs silently coerce a mismatched body `telegramId` on preview/create?** — **Default: reject
   with `ForbiddenException`** (strictest safe behaviour, mirrors S8 and the existing test contract;
   the authoritative identity is the verified actor regardless).
2. **How many days does the date picker offer?** — **Default: today + the next 13 days (a two-week
   forward window), local Europe/Belgrade calendar.** A display input only; the server re-validates the
   date and owns availability. Easy to widen later without a contract change.
3. **Single combined `CourtRequestScreen` with local sub-states, or separate screens?** — **Default:
   one screen with local sub-states** (date → time → duration → preview → pending), mirroring
   `GroupBookingScreen`; the native BackButton pops the whole route and in-screen back is local state.
4. **Preview as a mutation vs a query?** — **Default: fetch the preview on entering the preview step
   (mutation/imperative or a query keyed by date+startTime+duration), re-running if the duration
   changes;** the price is always the server's. Either is acceptable as long as no price is computed
   client-side.
5. **Eventually drop the body `telegramId` and derive solely from the session?** — **Default: keep it
   this slice** for bot back-compat (the bot still sends it); a follow-up can remove it from the
   preview/create contracts once the bot's client court flow is retired in S10. Recorded as future
   cleanup, not part of S9.

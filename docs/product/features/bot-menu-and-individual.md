# Feature: Bot menu reorder + group trainer name + individual-training request (Features 6 + 7 + 7b + 8)

## Goal

Three related bot-side changes plus one small client-facing API addition, delivered as one thin
vertical slice:

- **Feature 7 (menu)** — reorder and rename the main-menu buttons and add an "Индивидуальная
  тренировка" entry. Pure bot keyboard + i18n change.
- **Feature 7b (group trainer name)** — show the trainer's name in the "Записаться в группу" list,
  the same way single-visit slot cards already do. Needs `trainerName` in the bot-facing group
  response (a trainers join in the API); the bot only renders it.
- **Feature 6 (free spots today)** — replace the `menu:today` stub with the real bookable-slot list
  scoped to **today** by reusing the existing available-slots path (`from = to = today`). No API
  change.
- **Feature 8 (individual training)** — on `menu:individual`, the client picks an **active,
  individual-visible trainer** and the unchanged `POST /trainers/:id/individual-request` endpoint
  handles notification-only delivery. Routing is now trainer-first: attempt `trainer.telegramId`
  before falling back to admins/managers, and do not notify admins/managers after a successful trainer
  DM. No persistent booking row.

All four reuse existing helpers (`showFilteredSlots` / `formatSlotLine` / `listAvailableSlots`,
`ApiClient.listTrainers` for reference lists, `NotificationsService` / `TelegramSender`). The
individual picker is superseded by `ApiClient.listIndividualTrainers()` (`GET
/trainers?scope=individual`) so hidden trainers are not reintroduced there. No new screen state
machine.

## Spec / invariant refs

- `CLAUDE.md`: the **bot is an interaction layer only** — parse update → call ApiClient → render. No
  money/availability/seat math in the bot; today's date is a runtime clock string, not domain math.
  Identify users by **numeric telegram_id**; the bot must work for users **without a username**.
- `.claude/rules/telegram-bot.md`: callback-data namespaced constants, `< 64` bytes (IDs not blobs);
  show only bookable slots to clients; always a way back to the menu.
- `.claude/rules/security.md` + `.claude/rules/nestjs-layering.md`: authorization on every write in
  the **service**; controllers thin; repositories the only DB access; typed Nest exceptions.
- `.claude/rules/zod-contracts.md`: one schema per entity; reuse `packages/types` primitives; the bot
  validates every rendered value against a contract in the `ApiClient`.
- i18n: **RU authoritative**, mirror **sr/en** for every added/renamed key (placeholder = RU until
  translated). Rebuild `@beosand/i18n` and `@beosand/types` `dist` before the bot typecheck.

## Current state (read before editing)

- **Menu** (`apps/bot/src/menu.ts`): `MENU_ACTIONS` = `availableTrainings:"menu:available"`,
  `todayFreeSlots:"menu:today"`, `joinGroup:"menu:group"`, `myBookings:"menu:bookings"`,
  `rentCourt:"menu:court"`, `contactManager:"menu:contact"`, `language:"menu:lang"`,
  `backToMenu:"menu:home"`. `mainMenuKeyboard(catalog)` renders, in order: availableTrainings,
  todayFreeSlots, joinGroup, myBookings, rentCourt, contactManager, language. `adminMenuKeyboard`
  appends two admin buttons after the main menu.
- **Today stub** (`apps/bot/src/navigation.ts`): `MENU_ACTIONS.todayFreeSlots` handler replies
  `t(catalog, "bot.menu.todayStub")` with `backHomeKeyboard`. No API call. `availableTrainings`
  handler calls `showFilteredSlots(ctx, deps.api, deps.catalog, deps.slotFilters ?? {})`.
- **Filtered slots** (`apps/bot/src/slot-filters.ts`): `showFilteredSlots(ctx, api, catalog, state)`
  maps `SlotFilterState` → `AvailableSlotsQuery` and calls `api.listAvailableSlots(query)`, then
  `renderSlotsText` / `slotsKeyboard`. `SlotFilterState` carries `weekday/timeOfDay/trainerId/levelId`
  but **no `from`/`to`** — the today screen will call `listAvailableSlots` directly, not through
  `showFilteredSlots` (which has no date axis).
- **Slot card** (`apps/bot/src/slots.ts`): `formatSlotLine` already renders `card.trainerName`.
  `renderSlotsText(catalog, cards)` builds the header + one block per card.
- **Group list** (`apps/bot/src/group-booking.ts`): `formatGroupLine(catalog, group)` renders name,
  days+time, monthly price — **no trainer**. `handleGroupList(ctx, api, catalog)` →
  `renderGroupsText` → `groupsKeyboard`.
- **Group contract** (`packages/types/src/training-contracts.ts`): `groupSchema` has `trainerId: uuid`
  but **no `trainerName`**. `createGroupSchema = groupSchema.omit({ id, status })`,
  `updateGroupSchema = groupSchema.omit({ id }).partial()` — both currently include `trainerName`-free
  shapes; adding `trainerName` to `groupSchema` would leak into the create/update request shapes, so
  it must be added in a way that does **not** pollute the write contracts (see Decisions).
- **API client** (`apps/bot/src/api-client.ts`): `listTrainers(): Promise<Trainer[]>` → `GET /trainers`
  (active, name-ordered) **already exists**. `listGroups()` → `GET /groups` (validates `groupSchema[]`).
  No individual-request method.
- **Trainers API** (`apps/api/src/modules/trainers`): `GET /trainers` → `listActive()` (active,
  name-ordered). `TrainersRepository.findById` and `findByTelegramId` exist. `trainerSchema` has
  `telegramId: number|null`. `TrainersModule` currently imports nothing external and exports only
  `TrainersRepository`.
- **Groups API** (`apps/api/src/modules/groups`): `GroupsRepository.listActive()` selects
  `tables.groups` only (no join), `toGroup` normalizes times. The slot path in
  `trainings.repository.ts` already shows the **join pattern**: `.innerJoin(tables.trainers, ...)`
  selecting `trainerName: tables.trainers.name`.
- **Notifications** (`apps/api/src/modules/notifications`): `NotificationsModule` provides + exports
  `NotificationsService` and `TelegramSender`. `TelegramSender.sendMessage(telegramId, text,
  replyMarkup?)` posts to the Bot API with `parse_mode: "HTML"` and **never logs the token**; throws
  on non-OK. Individual request routing is trainer-first; admins/managers are fallback recipients only
  when the trainer has no numeric `telegramId` or trainer delivery fails.
- **Clients API**: `ClientsRepository.findByTelegramId(telegramId)` → `Client` (carries `name`,
  `telegramId`, `telegramUsername`). `clientSchema.telegramUsername: string|null`. `ClientsModule`
  exports — confirm `ClientsRepository` is exported (it is consumed by other modules); if not, export
  it.

## Decisions (open questions, each with a chosen default)

1. **`trainerName` on the group contract without polluting writes.** Add `trainerName: z.string()` to
   `groupSchema` as a **read-only display field**, and redefine the write schemas to omit it:
   `createGroupSchema = groupSchema.omit({ id: true, status: true, trainerName: true })` and
   `updateGroupSchema = groupSchema.omit({ id: true, trainerName: true }).partial()`. This keeps the
   admin create/update inputs unchanged (they still send `trainerId`, never `trainerName`), and any
   admin-console code that builds a create/update body is unaffected. `GroupsRepository.listActive`
   (and `findById`) join `tables.trainers` and select `trainerName: tables.trainers.name`.
   *Default chosen* over a separate `groupCardSchema` to avoid a parallel contract for one field.
2. **Individual-request endpoint shape.** `POST /trainers/:id/individual-request`, body
   `{ telegramId }` = the **requesting client's** telegram id. Self-only: the body `telegramId` must
   equal the `x-telegram-id` header (the bot sends both). **Not** admin-gated — any onboarded client
   may request. *Default chosen* over a query-only or header-only form so the contract is explicit and
   strict-validated.
3. **No persistence.** The feature is notification-only (the owner said no persistent record is
   required). We **log** the send (Nest `Logger`), but do **not** write a `notifications` send-log row
   (that table is keyed by `(clientId, trainingId, type)` and there is no training here) and add no new
   table. *Default chosen* to keep the slice minimal; a future "individual booking" feature can add a
   table.
4. **Delivery failure = soft result, not 500.** The service returns a typed discriminated result. It
   attempts `trainer.telegramId` first; admins/managers are fallback only when the trainer has no
   numeric `telegramId` or the trainer DM fails. If neither trainer nor fallback staff delivery works,
   the endpoint returns HTTP **200** with `{ delivered: false, reason: "trainer-unavailable" }` so the
   bot shows the existing soft message without an error. (A genuinely missing/inactive trainer →
   `404`; the bot treats that the same soft way.) *Default chosen* over a 422 so the bot's happy
   ApiClient path stays a single `request` call returning a typed body.
5. **Clickable link rule.** If the **client** has a `telegramUsername`, the staff/trainer DM links
   `https://t.me/<username>`; otherwise it uses an HTML mention `<a href="tg://user?id=<clientTelegramId>">name</a>`
   (works without a username). `TelegramSender` already sends `parse_mode: "HTML"`, so the mention
   renders. `trainerUsername` alone is not enough for Telegram DM delivery; the direct trainer path
   requires numeric `trainer.telegramId`.
6. **`telegramId` numeric range.** Telegram ids exceed 2^31; the contract uses `z.number().int()`
   (no 32-bit bound), matching `clientSchema`/`trainerSchema`. No change needed.

## Menu — final order + constants (Feature 7)

`MENU_ACTIONS` gains one constant:

```
individual: "menu:individual"   // 15 bytes, well under 64
```

`mainMenuKeyboard(catalog)` rows, **top to bottom**:

1. `bot.menu.todayFreeSlots`     → `MENU_ACTIONS.todayFreeSlots`   (`menu:today`)   — moved to TOP
2. `bot.menu.availableTrainings` → `MENU_ACTIONS.availableTrainings` (`menu:available`) — **label
   renamed** to "Разовое посещение"; flow/callback unchanged
3. `bot.menu.joinGroup`          → `MENU_ACTIONS.joinGroup`        (`menu:group`)
4. `bot.menu.individual`         → `MENU_ACTIONS.individual`       (`menu:individual`) — **NEW**
5. `bot.menu.myBookings`         → `MENU_ACTIONS.myBookings`       (`menu:bookings`)
6. `bot.menu.rentCourt`          → `MENU_ACTIONS.rentCourt`        (`menu:court`)
7. `bot.menu.contactManager`     → `MENU_ACTIONS.contactManager`   (`menu:contact`)
8. `bot.menu.language`           → `MENU_ACTIONS.language`         (`menu:lang`)

`adminMenuKeyboard` still appends its two admin buttons after this. The `menu:available` callback,
flow, and session filters are untouched (only the label string changes).

## i18n keys (RU authoritative; mirror sr/en)

**Rename** (value change only, key unchanged):

- `bot.menu.availableTrainings`: RU `"🎫 Разовое посещение"` · sr `"🎫 Pojedinačni dolazak"` ·
  en `"🎫 Single visit"`

**Add:**

- `bot.menu.individual`: RU `"🧑‍🏫 Индивидуальная тренировка"` · sr `"🧑‍🏫 Individualni trening"` ·
  en `"🧑‍🏫 Individual training"`
- `bot.today.header`: RU `"Свободные места на сегодня:"` · sr `"Slobodna mesta za danas:"` ·
  en `"Free spots today:"`
- `bot.today.none`: RU `"На сегодня свободных мест нет. Загляните позже 🙌"` · sr/en mirrored
- `bot.individual.pickTrainer`: RU `"К какому тренеру записаться?"` · sr/en mirrored
- `bot.individual.noTrainers`: RU `"Сейчас нет доступных тренеров. Загляните позже 🙌"` · sr/en mirrored
- `bot.individual.requested`: RU confirmation that the individual request was sent; do not promise
  which staff recipient received it. sr/en mirrored
- `bot.individual.trainerUnavailable`: RU `"Этот тренер пока недоступен в Telegram. Выберите другого
  или свяжитесь с менеджером."` · sr/en mirrored
- `bot.individual.pickButton`: RU `"🧑‍🏫 {name}"` (one button per trainer) · sr/en mirrored

**Remove** (superseded): `bot.menu.todayStub` — the stub handler is replaced; delete the key from
ru/sr/en.

Individual-request notification text is composed **server-side** (the API holds the bot token and
composes notification text; the bot never composes domain text). It is not added to the bot catalog.
The trainer-first delivery rules are documented in
`docs/product/features/trainer-first-individual-request-routing.md`.

## Contracts (packages/types)

### Group — add read-only `trainerName` (Feature 7b)

`packages/types/src/training-contracts.ts`:

```ts
export const groupSchema = z.object({
  id: uuid,
  name: z.string().min(1),
  levelId: uuid,
  daysOfWeek: z.array(dayOfWeek).min(1),
  startTime: timeString,
  endTime: timeString,
  trainerId: uuid,
  trainerName: z.string(),          // NEW: read-only display field (joined server-side)
  capacity: z.number().int().positive(),
  priceSingleRsd: rsd,
  priceMonthRsd: rsd,
  status: entityStatus
});
export const createGroupSchema = groupSchema.omit({ id: true, status: true, trainerName: true });
export const updateGroupSchema = groupSchema.omit({ id: true, trainerName: true }).partial();
```

### Individual request — new contract (Feature 8)

```ts
// New: packages/types/src/training-contracts.ts (or trainer-contracts if one exists)
export const individualRequestSchema = z.object({
  telegramId: z.number().int()      // the requesting client's own telegram id
}).strict();
export type IndividualRequestInput = z.infer<typeof individualRequestSchema>;

export const individualRequestResultSchema = z.object({
  delivered: z.boolean(),
  // present only when delivered === false, so the bot can pick its message
  reason: z.enum(["trainer-unavailable"]).optional()
}).strict();
export type IndividualRequestResult = z.infer<typeof individualRequestResultSchema>;
```

Export both from the package barrel and rebuild `@beosand/types`.

## API endpoints

### `GET /groups` (unchanged route; response now carries `trainerName`)

- `GroupsRepository.listActive` / `findById`: `.innerJoin(tables.trainers, eq(groups.trainerId,
  trainers.id))`, select `trainerName: tables.trainers.name` alongside the existing columns; `toGroup`
  maps it through. (Inner join is safe: every group has a non-null `trainerId`. Use the same join the
  trainings slot query uses.) No controller/service change. The bot's `listGroups` now validates the
  enriched `groupSchema`.

### `POST /trainers/:id/individual-request` (NEW — client-facing, self-only)

- **Controller** (`trainers.controller.ts`): parse `x-telegram-id` header (numeric),
  validate `uuid` path id, `individualRequestSchema` body; reject if `body.telegramId !==
  headerTelegramId` with `403` (self-only). Call `trainers.requestIndividual(trainerId,
  requesterTelegramId)`; return the `IndividualRequestResult`.
- **Service** (`trainers.service.ts`) `requestIndividual(trainerId, requesterTelegramId)`:
  1. Resolve the requesting **client** via `ClientsRepository.findByTelegramId(requesterTelegramId)`;
     `404`/throw `NotFoundException` if not onboarded (bot treats softly → menu).
  2. Resolve the **trainer** via `TrainersRepository.findById(trainerId)`; if missing or not active →
     `NotFoundException` (bot shows `trainerUnavailable`).
  3. Attempt direct delivery to `trainer.telegramId` first. If it succeeds, return
     `{ delivered: true }` and do not notify admins/managers.
  4. If `trainer.telegramId` is absent or trainer delivery fails, fall back to admins/managers.
     Return `{ delivered: true }` if at least one fallback DM succeeds; otherwise return
     `{ delivered: false, reason: "trainer-unavailable" }` so the client is told to try again/contact
     the manager. Log failed attempts (no token).
- **Authorization**: self-only — enforced in the controller/service (header id === body id). Not admin.
- **NotificationsService / TelegramSender**: render staff/trainer notification text server-side with
  a clickable client link. No send-log row.

### Module wiring

- `TrainersModule` must `imports: [NotificationsModule, ClientsModule]` (or directly provide the
  repositories it needs). Confirm `ClientsModule` **exports** `ClientsRepository`; if not, add the
  export. `NotificationsModule` already exports `NotificationsService` + `TelegramSender`.

## Bot wiring

### Feature 6 — today's free slots

Replace the `MENU_ACTIONS.todayFreeSlots` handler in `navigation.ts`:

- Derive `today` as a `YYYY-MM-DD` string from the runtime clock (no domain math; a small
  `todayDateString(now = new Date())` helper, or reuse an existing date formatter if one exists in the
  court flow — `courtDateOptions` formats dates, check for a reusable `toDateString`). Call
  `api.listAvailableSlots({ from: today, to: today })`.
- Render with `renderSlotsText` + `slotsKeyboard` (the same helpers the available-slots screen uses),
  but with the **today header**: either pass through `renderSlotsText` (which uses `bot.slots.header`)
  or add a tiny today-specific render that uses `bot.today.header` / `bot.today.none`. *Default*: a
  thin `renderTodaySlotsText(catalog, cards)` that mirrors `renderSlotsText` but swaps the header/empty
  keys, reusing `formatSlotLine`. Keep the slot "Записаться" buttons (booking flow already wired).
- The handler needs `listAvailableSlots` in its `deps.api` slice (already present in
  `MenuHandlerDeps.api`). Slot booking from the today list reuses the existing `book:start:` route.

### Feature 8 — individual training

- Add an `apps/bot/src/individual.ts` module:
  - `INDIVIDUAL_ACTIONS = { pickPrefix: "ind:pick:" }` (`ind:pick:` = 9 bytes + uuid 36 = 45 bytes).
  - `buildPickData(trainerId)` / `parseIndividualPick(data)` (mirror the group helpers).
  - `renderTrainerPickText(catalog)`, `trainerPickKeyboard(catalog, trainers)` — one
    `bot.individual.pickButton` per active trainer + back/home footer.
  - `handleIndividualEntry(ctx, api, catalog)`: `await api.listIndividualTrainers()` (`GET
    /trainers?scope=individual`); if empty → `bot.individual.noTrainers`; else render the picker.
    Do not use the default `listTrainers()` reference list for this picker.
  - `handleIndividualPick(ctx, api, catalog, telegramId, trainerId)`: if `telegramId` undefined →
    `showMainMenu`; else `const result = await api.requestIndividualSession(trainerId, telegramId)`;
    render `bot.individual.requested` on `delivered`, else `bot.individual.trainerUnavailable`.
- `ApiClient.requestIndividualSession(trainerId, telegramId): Promise<IndividualRequestResult>` (new):
  `POST /trainers/${trainerId}/individual-request`, header `x-telegram-id`, body `{ telegramId }`,
  validate with `individualRequestResultSchema`. A `404` (unknown/inactive trainer or not-onboarded
  client) resolves to `{ delivered: false, reason: "trainer-unavailable" }` (reuse a
  `requestOrNull`-style branch or map 404 explicitly) so the bot shows the soft message rather than
  throwing.
- `index.ts` dispatcher: add `menu:individual` routing — register a `bot.callbackQuery` /
  table entry that calls `handleIndividualEntry`, and a `parseIndividualPick` branch in the
  `callback_query:data` handler (before the default `resolveCallback`) that calls
  `handleIndividualPick(ctx, api, catalog, ctx.from.id, trainerId)`. Since `menu:individual` is in
  `MENU_ACTIONS`, either add it to the `menuHandlers` table (preferred, like `joinGroup`) and wire the
  pick branch in `index.ts`.

## Invariants this feature touches

- Bot stays an interaction layer: today's list and the group trainer name are both **rendered** from
  API-validated data; no seat/price/availability math in the bot. Today's date is a clock string only.
- Identity by numeric telegram id; the individual flow works for clients **without** a username (the
  id-based mention path). Nothing keys off username for identity — username is only the link form.
- Authorization on the new write is **self-only**, enforced in the API (header id === body id), not
  the bot. Trainer-first notification delivery uses the API's bot token via `TelegramSender`; the
  token is never logged.
- Callback data stays namespaced and `< 64` bytes (`menu:individual`, `ind:pick:<uuid>`).
- i18n RU authoritative, sr/en mirrored; the bundled catalog stays the offline fallback.

## Acceptance criteria

- AC1: Main menu renders the buttons in the exact order: today → single-visit → group → individual →
  my bookings → court → contact → language; admin buttons still appended last. "Разовое посещение"
  label maps to the unchanged `menu:available` flow.
- AC2: The group list ("Записаться в группу") shows the trainer's name for each group, sourced from
  the API; `GET /groups` responses include `trainerName`. Admin create/update group requests are
  unchanged (no `trainerName` accepted/required).
- AC3: "Свободные места на сегодня" lists the real bookable slots for today (the bot calls
  `listAvailableSlots` with `from === to === today`) under a "сегодня" header; the booking buttons
  work; an empty day shows `bot.today.none`. The old `todayStub` key is gone.
- AC4: `menu:individual` shows a keyboard of active, individual-visible trainers (from
  `GET /trainers?scope=individual`); picking one calls
  `POST /trainers/:id/individual-request` with the caller's telegram id and shows the
  "заявка отправлена" confirmation.
- AC5: The selected trainer receives the first DM attempt when `trainer.telegramId` is present; a
  successful trainer DM does **not** notify admins/managers. `trainerUsername` alone is not treated as
  deliverable.
- AC6: Missing/inactive trainers yield the existing soft bot result; if direct trainer delivery and
  fallback admin/manager delivery both fail, the endpoint returns
  `{ delivered:false, reason:"trainer-unavailable" }` rather than a 500.
- AC7: A non-self caller (body `telegramId` ≠ header id) is rejected with 403 and no DM is sent.
- AC8: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green; verified live (menu order, group
  name, today list, an individual request DM landing first on a trainer test account, fallback landing
  on an admin/manager test account, and a username-less client producing the id-mention link).

## Test list

Bot (vitest, pure render/route helpers):

- `mainMenuKeyboard` row order + callback_data match the final order (today first, single-visit second
  with `menu:available`, individual fourth with `menu:individual`); `adminMenuKeyboard` still appends
  admin buttons last. (`apps/bot/src/menu.spec.ts`)
- Renamed label: `t(catalog, "bot.menu.availableTrainings")` returns "Разовое посещение" (ru) and the
  flow constant is still `menu:available`.
- `formatGroupLine` / `renderGroupsText` render `group.trainerName` (group fixture carries it).
  (`apps/bot/src/group-booking.spec.ts`)
- Today handler / `renderTodaySlotsText`: handler calls `api.listAvailableSlots` with `from === to ===`
  today's date string (mock clock); empty → `bot.today.none`, non-empty → `bot.today.header` + cards.
- `buildPickData`/`parseIndividualPick` round-trip; payload `< 64` bytes; non-matching data → undefined.
- `handleIndividualEntry`: uses `listIndividualTrainers()`; empty trainer list → `noTrainers`;
  non-empty → one button per trainer.
- `handleIndividualPick`: `delivered:true` → `requested`; `delivered:false` → `trainerUnavailable`;
  undefined telegramId → main menu.
- `ApiClient.requestIndividualSession`: parses `individualRequestResultSchema`; 404 → soft
  `{ delivered:false, reason:"trainer-unavailable" }`; malformed body rejected by the contract.

Contracts (packages/types):

- `groupSchema` accepts `trainerName`; `createGroupSchema`/`updateGroupSchema` **reject** a
  `trainerName` field (omitted) and still accept `trainerId`.
- `individualRequestSchema` is strict (`telegramId` only); `individualRequestResultSchema` strict;
  `reason` enum constrained.

API (vitest):

- `GroupsRepository.listActive` returns `trainerName` (join); `findById` likewise. (service/repo or
  integration with a stubbed DB)
- `TrainersController` individual-request: 403 when body `telegramId` ≠ header id (no send); 400 on
  missing/invalid header or non-uuid id; success path calls the service once.
- `TrainersService.requestIndividual`: not-onboarded client → NotFound; unknown/inactive trainer →
  NotFound; trainer with `telegramId` is attempted first and returns `{ delivered:true }` without
  fallback when the send succeeds; no `telegramId` or trainer-send failure falls back to
  admins/managers; total delivery failure returns `{ delivered:false }`.
- Individual-request notification text: username present → `https://t.me/<username>` in text;
  username null but telegramId present → `tg://user?id=<id>` mention with HTML-escaped name; the
  chosen trainer name is included and escaped.
- `TelegramSender` is called with the trainer's numeric `telegramId` first when available; configured
  admin/manager telegram ids are called only on fallback. The token is never present in any
  thrown/logged string (existing sender invariant, asserted for the new path).

## Dependencies / sequencing

1. `packages/types`: add `trainerName` to `groupSchema` + adjust create/update; add
   `individualRequest*` contracts. Rebuild `@beosand/types`.
2. `packages/i18n`: rename `bot.menu.availableTrainings`, add the new keys, remove `bot.menu.todayStub`
   (ru/sr/en). Rebuild `@beosand/i18n`.
3. API (parallel after step 1): groups join (`trainerName`); trainers individual-request
   controller/service + trainer-first notification routing + module wiring.
4. Bot (parallel after steps 1–2 and the API contract is agreed): menu reorder + constant; today
   handler; individual module + ApiClient method + dispatcher wiring.
5. Tests alongside each; then the full gate + live run.

## Handoff

- `backend-implementer`: contracts (step 1), groups `trainerName` join, the
  `POST /trainers/:id/individual-request` endpoint (controller/service/authz), the
  trainer-first notification routing, module wiring, and the API tests.
- `bot-implementer`: i18n changes (step 2), menu reorder + `MENU_ACTIONS.individual`, the Feature 6
  today handler, the `individual.ts` module + `ApiClient.requestIndividualSession` + dispatcher wiring,
  and the bot tests. Reuse `showFilteredSlots`/`formatSlotLine`/`listAvailableSlots`,
  `listTrainers` for reference reads, `listIndividualTrainers` for the individual picker, and
  `formatGroupLine`; do not duplicate.

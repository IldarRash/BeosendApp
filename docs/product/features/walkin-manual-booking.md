# Feature: Walk-in clients & admin manual booking (Feature 5)

## Goal

Let an **admin or the training's trainer** add a person to a training and book a seat for them from
the admin console, even when that person has no Telegram account. Some players (especially Serbian
ones) reach the school via Instagram/other socials and never use the bot; today there is no way to
get them onto a roster. This feature adds:

1. **Walk-in clients** — a client record created **by name** (phone/note optional) with **no
   `telegram_id`**, distinguished by a `source` marker.
2. **Admin manual booking** — on a training in `apps/admin`, an "Добавить человека" action that lets
   the admin/trainer either pick an existing client or create a new walk-in, then books them onto the
   training. The booking goes through the **existing** `BookingsService.createSingle` so capacity,
   status recompute, duplicate-guard, and the atomic FOR-UPDATE seat math are reused verbatim.
3. **Notification-safe** — a walk-in has no Telegram id, so the post-commit booking-confirmation send
   is skipped gracefully (never throws, the booking stands).

This is a small vertical slice that reuses all existing booking domain logic; the only new domain
write is `clients.createWalkIn`. No bot-facing change.

## Spec / invariant refs

- `CLAUDE.md`: bot is an interaction layer, domain state authoritative; the bot never writes domain
  tables — but this is an **admin** write, still routed through `apps/api` services. Capacity/status
  recompute server-side after every booking; never oversell. Money is RSD server-side (untouched here
  — a single booking takes a seat).
- `.claude/rules/security.md`: authorization on every write, enforced in the **service**. Manual
  booking is admin-or-trainer (not the self-only client path).
- `.claude/rules/nestjs-layering.md`: controller thin, service owns authz + invariants, repository
  only DB.
- `.claude/rules/zod-contracts.md`: one schema per entity; reuse primitives; update entity schema +
  request schema + DB schema + migration together.
- `.claude/rules/drizzle-migrations.md`: schema lives only in `packages/db/src/schema.ts`; generate +
  commit the migration; `packages/db` and `packages/types` in lockstep.
- `.claude/rules/frontend.md`: admin is interaction layer; validate every response against a
  `packages/types` contract; RU strings (mirror sr/en in the catalog).

## Current state (read before editing)

- `packages/db/src/schema.ts` `clients`: `telegramId: integer("telegram_id").notNull()`, with a
  **unique index** `clients_telegram_id_idx` on `telegram_id`. No `phone`, no `note`, no `source`.
- `packages/types/src/client-contracts.ts`: `clientSchema.telegramId = z.number().int()`
  (non-null); `onboardClientSchema`. No walk-in schema, no list/search schema, no `source`/`phone`/
  `note`.
- `apps/api/src/modules/clients`: `ClientsService` (onboard / getByTelegramId / setLanguage,
  `assertSelfOrAdmin`); `ClientsRepository` (`findByTelegramId`, `insertIgnoreConflict`,
  `updateLanguage`, `toClient`); `ClientsController` (`GET by-telegram/:id`, `POST onboard`,
  `PATCH .../language`). **No `GET /clients` list endpoint exists.**
- `apps/api/src/modules/bookings/bookings.service.ts` `createSingle(actorTelegramId, { clientId,
  trainingId })`: `assertOwnsClient` (bypasses for admins), tx with FOR-UPDATE lock, `isBookable`
  guard (409 if not bookable), duplicate-active-booking guard (409), `insertBooking({ …, source:
  "telegram" })`, count++ + `recomputeTrainingStatus`, then post-commit `sendConfirmationSafely(() =>
  notifications.sendBookingConfirmation(clientId, trainingId))`.
- `assertTrainerOrAdmin(actorTelegramId, trainerId)` already exists in `BookingsService` (used by
  `markAttendance`): admin passes; otherwise the caller's resolved trainer id must equal the
  training's `trainerId`. **Reuse it for the manual path** — but it needs the training's `trainerId`,
  which `createSingle` does not currently read before the tx.
- `packages/types/src/common.ts`: `bookingSource = z.literal("telegram")`. `bookings.repository.ts`
  `bookingSourceOf` **throws** on any source other than `"telegram"`. Both must widen.
- Notifications: `NotificationsRepository.findClientTrainingRecipients` `innerJoin`s `clients` and
  selects `tables.clients.telegramId`. For a walk-in this row still exists (the join is on
  `clients.id`), so `telegramId` would be `null`; `NotificationRecipient.telegramId: number` and the
  `TelegramSender` would receive `null`. The clean fix is to **skip the send before it reaches the
  sender** when the client has no telegram id (see Notification handling).
- Admin auth: `SessionBridgeMiddleware` rewrites a verified Bearer session to `x-telegram-id`, so
  admin controllers resolve the actor via the same `x-telegram-id` header the bot uses. The admin
  `ApiClient` sends `Authorization: Bearer`, never `x-telegram-id`.
- `apps/admin`: `Trainings.tsx` (DataTable of trainings, per-row capacity/cancel actions, modals),
  `useTrainings.ts` (hooks + `invalidateTrainings`), `api/client.ts` (typed client; has
  `getClientByTelegram`, `onboardClient`; **no** walk-in / clients-list / manual-booking methods).

## Schema change (packages/db) + migration

`clients` table:

- `telegramId`: drop `NOT NULL` → **nullable** (`integer("telegram_id")`). Walk-ins have no Telegram
  id. Bot-onboarded clients still set it.
- Keep the unique index, but make it **partial** so multiple walk-ins (all `NULL`) don't collide:
  `uniqueIndex("clients_telegram_id_idx").on(telegramId).where(sql`telegram_id IS NOT NULL`)`. (Postgres
  treats multiple NULLs as distinct in a plain unique index, but a partial index makes the intent
  explicit and matches the `court_blocks` precedent in this schema.)
- Add `source: text("source").notNull().default("telegram")` — `"telegram"` for bot-onboarded,
  `"walk_in"` for manually created. Free-text column constrained by the Zod contract (mirrors the
  `bookings.source` precedent).
- Add `phone: text("phone")` (nullable) and `note: text("note")` (nullable) — optional walk-in
  contact details.

Migration: `pnpm --filter @beosand/db db:generate` after editing `schema.ts`; **commit** the
generated SQL under `packages/db/drizzle/` with the schema change. (Decision OQ-1: a dedicated
`client_source` pgEnum is **not** introduced; reuse the free-text + Zod pattern already used for
`bookings.source`, keeping the two source columns consistent and avoiding an enum migration.)

## Contract additions (packages/types)

`client-contracts.ts`:

- New primitive (in `common.ts`): `clientSource = z.enum(["telegram", "walk_in"])`.
- `clientSchema`: `telegramId: z.number().int().nullable()`; add `source: clientSource`,
  `phone: z.string().nullable()`, `note: z.string().nullable()`.
- `createWalkInSchema = z.object({ name: z.string().min(1), phone: z.string().min(1).optional(),
  note: z.string().min(1).optional() }).strict()`; `export type CreateWalkInInput`.
- `listClientsQuerySchema = z.object({ search: z.string().min(1).optional() }).strict()` for the
  admin picker (optional name/phone substring search); `export type ListClientsQuery`.

`common.ts`:

- `bookingSource = z.enum(["telegram", "admin", "walk_in"])` (widen from the literal). `"telegram"`
  = client booked via bot; `"admin"` = admin/trainer booked an *existing* (telegram) client;
  `"walk_in"` = admin/trainer booked a walk-in client. (Decision OQ-2.)

`training-contracts.ts`:

- `createSingleBookingSchema` is **unchanged** (`{ clientId, trainingId }`, `.strict()`). The manual
  path reuses the same endpoint/body — see "Reuse vs new endpoint" below. No new booking request
  schema is added.

After editing `packages/types` (and `packages/db`), **rebuild** them before downstream typecheck:
`corepack pnpm --filter @beosand/types build` (and `@beosand/db`).

## API (apps/api)

### Clients module

- `ClientsRepository.insertWalkIn(values: { name; phone?; note? }, tx?) -> Client` — inserts a row
  with `telegramId: null`, `source: "walk_in"`, `phone ?? null`, `note ?? null`. `toClient` updated to
  carry `telegramId` (nullable), `source`, `phone`, `note`.
- `ClientsRepository.list(search?: string) -> Client[]` — all clients, optional case-insensitive
  `ILIKE %search%` on `name` (and `phone`), ordered by `name`. No business rules.
- `ClientsService.createWalkIn(actorTelegramId, input: CreateWalkInInput) -> Client` — **admin-only**:
  `assertAdmin(actorTelegramId)` (new small private guard `if (!isAdmin(this.env, actor)) throw new
  ForbiddenException`). Inserts the walk-in, logs, returns the client. (Decision OQ-3: walk-in
  **creation** is admin-only even though manual **booking** is admin-or-trainer; trainers can still
  book the walk-ins admins create, and booking an existing client never needs creation. Keeps the
  client-creation surface minimal. Revisit if trainers need to self-serve walk-in creation.)
- `ClientsService.list(actorTelegramId, query: ListClientsQuery) -> Client[]` — **admin-only**
  (`assertAdmin`); returns `clients.list(query.search)`. Picker source for the admin.
- Controller:
  - `POST /clients/walk-in` — `validate(createWalkInSchema, body)`, resolve actor from
    `x-telegram-id`, call `createWalkIn`, return `validate(clientSchema, …)`.
  - `GET /clients` — `validate(listClientsQuerySchema, query)`, call `list`, return
    `z.array(clientSchema).parse(…)`.

### Bookings module — manual booking authorization

Reuse `createSingle`; do **not** duplicate booking logic. Two adjustments:

- **Authorization for the manual path.** A walk-in has no `telegram_id`, so `assertOwnsClient` can
  never match it for a trainer, and an admin already bypasses it — but a **trainer** booking an
  existing/walk-in client onto *their own* training must be allowed. Introduce an explicit manual
  entry that authorizes with `assertTrainerOrAdmin` against the **training's trainerId**:
  - Add `BookingsRepository` ability to read a training's `trainerId` (extend `TrainingLockRow` with
    `trainerId` in `findTrainingForUpdate`, or add a lightweight pre-read). Preferred: include
    `trainerId` in the `findTrainingForUpdate` select so the manual path authorizes inside the tx
    against the locked row.
  - New service method `createManual(actorTelegramId, { clientId, trainingId })`: identical body to
    `createSingle` except (a) authorization is `assertTrainerOrAdmin(actorTelegramId,
    training.trainerId)` performed **after** the training is fetched in the tx (admin passes
    immediately; trainer must own the training), and (b) `insertBooking({ …, source })` where
    `source = "walk_in"` if the client has no telegram id else `"admin"`. Everything else —
    `isBookable` 409, duplicate-active 409, count++ + `recomputeTrainingStatus`,
    `updateTrainingCount`, post-commit confirmation — is shared. **Factor the common tx body into one
    private helper** (`bookSeat(tx, { clientId, training, type, source })`) used by both `createSingle`
    and `createManual` so the capacity/status/duplicate logic exists once.
  - To resolve "does this client have a telegram id" for the source choice and the notification skip,
    read the client (`clients.findById` — add to `ClientsRepository`; `findByTelegramId` won't work
    for a walk-in) before the tx; 404 if missing.
- Controller: `POST /bookings/manual` — `validate(createSingleBookingSchema, body)` (same
  `{ clientId, trainingId }` body), resolve actor, call `createManual`. (Decision OQ-4: a **separate**
  `POST /bookings/manual` endpoint rather than overloading `POST /bookings/single`, because the two
  have different authorization (`assertOwnsClient` self-or-admin vs `assertTrainerOrAdmin`) and the
  thin controller should map one route to one authorization rule. `createSingle` stays the
  client/self path used by the bot.)

### Notification handling for no-Telegram clients

- `BookingsService.createManual` post-commit: only call `sendConfirmationSafely(...)` when the booked
  client has a telegram id (we already loaded the client). A walk-in (`telegramId === null`) skips the
  send entirely — no DM is attempted. This is the primary, explicit skip.
- Defense in depth in `NotificationsService.sendBookingConfirmation`: after
  `findClientTrainingRecipients`, if `recipient.telegramId == null` (walk-in), log a debug line and
  return without sending. Requires `NotificationRecipient.telegramId` to become `number | null` and
  the recipient selectors to tolerate the null; the `findDueReminders`/reminder paths only ever join
  `booked` rows of bot clients, but they too must not blow up on a null — add `WHERE
  clients.telegram_id IS NOT NULL` to the reminder/broadcast recipient queries so walk-ins are never
  selected as Telegram recipients. (Walk-ins are never sent any Telegram message anywhere.)
- `bookings.repository.ts` `bookingSourceOf` must accept the widened enum (`"telegram" | "admin" |
  "walk_in"`) and stop throwing on the new values; validate against `bookingSource` instead of the
  hardcoded literal.

## Admin (apps/admin)

- `ApiClient` additions (each validates the response against the `packages/types` contract):
  - `createWalkIn(input: CreateWalkInInput): Promise<Client>` → `POST /clients/walk-in`.
  - `listClients(search?: string): Promise<Client[]>` → `GET /clients` (validate
    `z.array(clientSchema)`).
  - `bookManual(input: CreateSingleBookingInput): Promise<Booking>` → `POST /bookings/manual`.
- `Trainings.tsx`: add an **"Добавить человека"** action button per training row (disabled when
  `status === "full" | "cancelled" | "completed"` to mirror existing affordances — the server is
  still authoritative and rejects a full booking). Opens an `AddPersonModal`:
  - Two modes via a toggle: **Pick existing** (search field → `listClients`, select a client) and
    **Create walk-in** (name required; phone, note optional → `createWalkIn`, then book the returned
    client).
  - On submit, call `bookManual({ clientId, trainingId })`; on success toast (e.g. "Записан на
    тренировку"), close, and invalidate trainings (reuse `invalidateTrainings`) so the row's
    `bookedCount`/`status` refresh from the server.
  - Render server errors verbatim (full → 409 message; duplicate → 409 message), never recompute
    capacity client-side.
- New hooks in (or alongside) `useTrainings.ts` / a `useClients.ts`: `useClientSearch(search)`,
  `useCreateWalkIn()`, `useBookManual()` (the last two invalidate trainings on success).
- i18n: add RU keys under `admin.trainings.*` (e.g. `actionAddPerson`, `addPersonTitle`,
  `addPersonExisting`, `addPersonNew`, `fieldName`, `fieldPhone`, `fieldNote`, `addPersonSubmit`,
  `addPersonBooked`, `searchPlaceholder`, `noClients`) and **mirror sr/en** in
  `packages/i18n/src/catalogs/{ru,sr,en}/admin.ts`. Rebuild `@beosand/i18n` before admin typecheck.

## Invariants honored

- **Capacity never oversold / status recompute:** manual booking reuses the FOR-UPDATE +
  `recomputeTrainingStatus` body; a full training is rejected (409). No parallel booking math.
- **Authorization in the service:** `createWalkIn`/`list` are admin-only; `createManual` is
  `assertTrainerOrAdmin` against the training's trainer. The bot's self-only `createSingle` is
  untouched.
- **Money RSD server-side:** untouched — a single seat, price shown elsewhere.
- **Lockstep:** `clients` schema, `clientSchema`, and the migration change together; `bookingSource`
  widened in `common.ts`, schema column already free-text, repo guard widened.
- **No client data leak:** `GET /clients` is admin-only and returns the same `clientSchema` the API
  already exposes; no rosters or other-user data beyond it.

## Acceptance criteria

1. An admin can create a walk-in client by name (phone/note optional); the stored row has
   `telegram_id = NULL`, `source = "walk_in"`.
2. `clients.telegram_id` is nullable; bot onboarding still sets it and is still idempotent on the
   (partial) unique index; two walk-ins with no telegram id coexist.
3. From a training in the admin console, an admin can pick an existing client OR create a new walk-in
   and book them onto that training; the row's `bookedCount`/`status` reflect the new seat.
4. A trainer (resolved by their `telegram_id` matching the training's `trainerId`) can do the same for
   **their own** training; a trainer for a different training is rejected (403).
5. Booking a walk-in (or existing client) onto a **full** training is rejected (409); the UI shows the
   server message and the seat count is unchanged.
6. A duplicate active booking for the same client + training is rejected (409).
7. Booking a walk-in (no telegram id) **does not** attempt a Telegram DM and does not throw; the
   booking is committed. The booking row's `source` is `"walk_in"` (or `"admin"` for an existing
   telegram client booked manually).
8. `GET /clients` is admin-only (non-admin/non-bridged → 403/400) and validates against `clientSchema`.
9. Gate green: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the flow verified in the
   running admin console against the API.

## Tests

`packages/types`:
- `clientSchema` accepts `telegramId: null` + `source: "walk_in"` + nullable phone/note; rejects an
  unknown `source`.
- `createWalkInSchema`: requires `name`, allows optional phone/note, rejects unknown fields.
- `listClientsQuerySchema`: optional `search`, rejects unknown fields.
- `bookingSource` accepts `telegram | admin | walk_in`, rejects others.

`apps/api` (clients.service.spec):
- `createWalkIn` as admin inserts `telegram_id = null`, `source = "walk_in"`; non-admin → 403.
- `list` admin-only; search filters.

`apps/api` (bookings.service.spec — extend existing, reuse harness):
- `createManual` as admin books an existing client (source `"admin"`) and a walk-in (source
  `"walk_in"`); count++ and status recompute (open→full at capacity) verified.
- `createManual` as the **training's trainer** succeeds; as a **different** trainer → 403; as a
  non-trainer non-admin → 403.
- Full training → 409 (no seat change); duplicate active booking → 409.
- Walk-in booking: confirmation send is **not** invoked (telegramId null) and the method does not
  throw; existing-telegram-client manual booking **does** invoke the safe send.
- The shared `bookSeat` helper is exercised by both `createSingle` and `createManual` (no duplicated
  capacity logic).

`apps/api` (clients.controller.spec / bookings.controller.spec):
- `POST /clients/walk-in`, `GET /clients`, `POST /bookings/manual` validate their bodies/queries and
  reject unknown fields.

`apps/admin`:
- `Trainings.spec` / `AddPersonModal` render test: existing-client pick and walk-in-create paths call
  the right `ApiClient` methods; a malformed `GET /clients` response is rejected by the contract
  (unsafe path); a 409 from a full training renders the server message.

## Dependencies

- Built on `feature/court-load-redesign` working tree (court files are mid-change; this feature does
  not touch court code — keep changes scoped to clients/bookings/notifications/admin trainings + i18n).
- Hand off: `backend-implementer` (schema + migration, contracts, clients service/repo/controller,
  bookings manual path + notification skip, tests), `frontend-implementer`/`ui-designer` (admin
  AddPersonModal + hooks + client + i18n). Contracts-first: land `packages/types`/`packages/db` and
  rebuild before wiring API and admin.

## Open questions (each with a chosen default)

- **OQ-1 — walk-in marker:** dedicated `client_source` enum vs free-text `source` column. **Default:
  free-text `source` column** with a Zod `clientSource` enum guard, mirroring `bookings.source`. No
  enum migration.
- **OQ-2 — booking source values:** **Default:** widen `bookingSource` to `telegram | admin |
  walk_in`; manual booking of an existing telegram client = `"admin"`, of a walk-in = `"walk_in"`.
- **OQ-3 — who may create walk-ins:** admin-only vs admin-or-trainer. **Default: admin-only
  creation**, admin-or-trainer **booking**. Trainers book the walk-ins admins create. Revisit if
  trainers need self-serve creation.
- **OQ-4 — endpoint shape:** overload `POST /bookings/single` vs a new `POST /bookings/manual`.
  **Default: new `POST /bookings/manual`** (distinct authorization rule), leaving `createSingle` as
  the bot's self path.
- **OQ-5 — search scope for `GET /clients`:** name-only vs name+phone. **Default: name + phone**
  case-insensitive substring; no telegram-username search (walk-ins have none).

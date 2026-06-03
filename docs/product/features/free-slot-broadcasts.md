# T2.4 — Free-slot broadcasts

**Goal.** Let the manager compose and send a Telegram broadcast of free slots (today / tomorrow /
week / freed-up), each line carrying an inline "Записаться" that deep-links into the existing
single-booking flow (T1.8). The broadcast itself never books.

**Spec refs.** ТЗ §12; UX §13.

## Status of prerequisites (verified)

Already present — DO NOT recreate:
- Contracts in `packages/types/src/training-contracts.ts`: `broadcastType`
  (`["today","tomorrow","week","freed-up"]`), `broadcastSchema`, `slotCardSchema`, `SlotCard`.
- `broadcasts` table in `packages/db/src/schema.ts` (`type`, `payload`, `createdBy`, `sentAt`,
  `recipientsCount`) plus the `broadcast_type` pg enum.
- Pure helpers in `packages/types/src/helpers.ts`: `freeSeats`, `isBookable`, `recomputeTrainingStatus`.
- `packages/config`: `loadEnv`, `isAdmin(env, telegramId)`.

No DB field is missing. **schemaChange = false.**

## Contracts to add (small, in `packages/types/src/training-contracts.ts`)

These are request/response wrappers only; no new entity or primitive.
- `broadcastPreviewQuerySchema = z.object({ type: broadcastType })` — `GET /broadcasts/preview` query.
- `broadcastPreviewSchema = z.object({ type: broadcastType, text: z.string(), slots:
  z.array(slotCardSchema), recipientsCount: z.number().int().nonnegative() })` — preview response
  (reuses `slotCardSchema`).
- `sendBroadcastSchema = z.object({ type: broadcastType })` — `POST /broadcasts/send` body.
- `broadcastSendResultSchema = broadcastSchema` (reuse) for the send response.
Derive types with `z.infer`. If equivalents already exist after contract work elsewhere, reuse them.

## API — `apps/api/src/modules/broadcasts/` (admin-only)

Layering: controller (thin, Zod-validates) → service (all decisions) → repository (only DB access).
Admin identity passed as `telegramId` (header or query, matching the convention other admin endpoints
use) and checked in the service via `isAdmin(env, telegramId)`.

Endpoints:
- `GET /broadcasts/preview?type=<today|tomorrow|week|freed-up>&telegramId=<id>`
  → `BroadcastPreview`. Service: assert admin; select the slot set for `type` (see selection rules);
  validate each row is bookable with `isBookable` at query time; map to `slotCard` (free seats via
  `freeSeats`, prices straight from the group, never recomputed in the bot); compose `text`; compute
  `recipientsCount` = count of active clients. Does NOT write.
- `POST /broadcasts/send` body `{ type }`, admin `telegramId`
  → `Broadcast` row. Service: assert admin; re-run the same selection + bookability filter at send
  time (slots can have gone full since preview); fan-out sends to the audience (active clients) using
  the bot token directly from the API (the established notifications pattern); insert ONE `broadcasts`
  row (`type`, `payload` = composed text, `createdBy` = admin telegramId, `recipientsCount`). The
  inline keyboard per slot carries `book:slot:<trainingId>` callback data (T1.8 entry point).

Slot selection rules (server-side, Europe/Belgrade dates):
- `today` — bookable trainings dated today.
- `tomorrow` — bookable trainings dated tomorrow.
- `week` — bookable trainings dated today..today+6.
- `freed-up` — trainings that have free seats again (status `open`, `freeSeats > 0`) for upcoming
  dates; same bookable filter. (No new state needed for the slice — "freed-up" = currently-bookable
  upcoming slots; richer freed-up detection is a later refinement, recorded as open question.)

Repository: read upcoming `trainings` joined to `groups`/`trainers`/`levels` for the slot cards, and
count active clients. No business rules in the repo.

## Bot flow — `apps/bot`

Handlers (thin; render only, all data from `ApiClient`, validated against contracts):
- Manager menu entry `menu:broadcast` (admin-gated via API role check) → keyboard of the 4 types
  (`broadcast:type:today` etc.).
- On type pick → call `ApiClient.previewBroadcast(type)` → render the composed text; each slot line
  is followed by an inline "Записаться" button with callback `book:slot:<trainingId>` (reuses the
  T1.8 single-booking confirmation entry — the broadcast never books). Footer button
  `broadcast:send:<type>` ("Отправить") + back to menu.
- On send → call `ApiClient.sendBroadcast(type)` → confirm "Отправлено N получателям".

ApiClient methods (typed, validate responses):
- `previewBroadcast(type, adminTelegramId): Promise<BroadcastPreview>`
- `sendBroadcast(type, adminTelegramId): Promise<Broadcast>`

No domain logic, no money/availability math, no DB in the bot. Callback data stays < 64 bytes (only
a type or a trainingId is carried).

## Invariants

1. **Admin-only.** Both endpoints reject non-admins in the service via `isAdmin`. (Most important.)
2. Slots in the message are bookable (status `open` + `freeSeats > 0`) — filtered with `isBookable`
   at BOTH preview and send time; full/cancelled slots are never advertised.
3. The broadcast never creates a booking; the inline button funnels into the normal T1.8 flow which
   re-checks availability and capacity/status recompute.
4. Prices/free counts come from the server; the bot only displays them. Money is integer RSD.
5. Exactly one `broadcasts` row per send (type, recipientsCount, sentAt).

## Unsafe / forbidden path (must be rejected, with a test)

A non-admin `telegramId` calling `GET /broadcasts/preview` or `POST /broadcasts/send` must get
`ForbiddenException` and no `broadcasts` row is written. (Secondary forbidden behavior to assert: a
`full`/`cancelled` training never appears in preview or send output.)

## Acceptance criteria

- "Today" preview lists exactly today's bookable slots with correct free counts.
- Tapping a slot's "Записаться" opens the T1.8 confirmation for that training.
- `POST /broadcasts/send` writes one `broadcasts` row with type, recipientsCount, and sentAt.
- Non-admin caller is rejected on both endpoints.

## Tests

- Service: slot selection per `type` (today/tomorrow/week/freed-up boundaries); bookable filter
  excludes `full`/`cancelled`; message formatting; audience (active-client) count; admin gate
  (forbidden for non-admin, allowed for admin); send writes exactly one `broadcasts` row.
- Contracts: `broadcastPreviewQuerySchema`, `sendBroadcastSchema`, `broadcastPreviewSchema` accept
  valid input and reject unknown fields / bad `type`.
- Bot: inline "Записаться" produces `book:slot:<trainingId>` deep link into the T1.8 flow.

## Dependencies

- T1.5 availability (slot selection + `slotCardSchema`).
- T1.8 single-booking flow (`book:slot:<trainingId>` is its entry point).
- Outbound send uses the API's bot-token send path (notifications module pattern).

## Open questions (with chosen defaults)

- **Audience.** Default: all active clients (segmentation is T3.2).
- **"freed-up" semantics.** Default for this slice: currently-bookable upcoming slots (no new
  "was-full-now-open" tracking). Revisit if product wants true freed-up detection (would need a
  status-transition log; out of scope here).
- **Admin identity transport.** Default: same mechanism existing admin endpoints use (`telegramId`
  param/header checked by `isAdmin`); align with the first admin endpoint implemented.

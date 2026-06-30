# Trainer-first individual request routing

## Goal

Route individual-training requests to the selected trainer first while keeping the public request
API unchanged. Admins/managers are a fallback recipient only when the trainer cannot be reached by
Telegram.

## Spec refs

- Existing individual-training request flow in `docs/product/features/bot-menu-and-individual.md`.
- Mini App individual request flow in `docs/product/features/miniapp-individual-request.md`.
- Trainer visibility rules in `docs/product/features/trainer-individual-visibility.md`.
- Architecture invariants: bot/Mini App are interaction layers; API owns notification delivery;
  Telegram identity is numeric `telegramId`, not username.

## Contracts & tables

- `packages/types/src/training-contracts.ts`
  - `individualRequestSchema` remains `{ telegramId: number }`.
  - Response contract remains `IndividualRequestResult` via `individualRequestResultSchema`.
  - `Trainer.telegramId` remains the delivery address for trainer DMs.
  - `trainerUsername` alone is not enough for Telegram DM delivery; it can identify/link a trainer,
    but Bot API `sendMessage` needs a numeric chat id.
- Database
  - No migration.
  - No new table.
  - No individual-request row is persisted; routing remains notification-only.

## API

| Method + path | Request | Response | Change |
|---|---|---|---|
| `POST /trainers/:id/individual-request` | unchanged `individualRequestSchema` | unchanged `IndividualRequestResult` | delivery routing only |

Routing behavior:

1. Resolve and authorize the requester exactly as today: body `telegramId` must match the verified
   actor (`x-client-telegram-id ?? x-telegram-id`).
2. Resolve the requested active trainer.
3. If `trainer.telegramId` is present, attempt the trainer DM first.
4. If the trainer DM succeeds, return `{ delivered: true }` and do not notify admins/managers.
5. If the trainer has no `telegramId`, or the trainer DM fails, fall back to admins/managers.
6. If at least one fallback admin/manager DM succeeds, return `{ delivered: true }`.
7. If neither trainer nor fallback staff delivery succeeds, return
   `{ delivered: false, reason: "trainer-unavailable" }`.

## Bot flow

- `menu:individual` still lists active, individual-visible trainers.
- Picking a trainer still calls `POST /trainers/:id/individual-request` with the caller's own
  `telegramId`.
- The bot still renders only the `IndividualRequestResult`: success confirmation on
  `delivered: true`, soft unavailable copy on `delivered: false`.
- The bot does not decide whether the trainer or fallback staff receive the DM.

## Invariants

- Successful trainer delivery must not notify admins/managers.
- Admins/managers are fallback recipients only when `trainer.telegramId` is missing or trainer DM
  delivery fails.
- `trainerUsername` alone must not be treated as deliverable for Telegram DM.
- The route, request body, response contract, and self-only authorization stay unchanged.
- The feature adds no persistence; no booking/request row and no DB migration.
- Notification failures stay soft for the client through `IndividualRequestResult`.

## Acceptance criteria

1. `POST /trainers/:id/individual-request` keeps the same path, request body, response contract, and
   caller behavior for bot and Mini App clients.
2. A trainer with `telegramId` receives the first delivery attempt.
3. When trainer delivery succeeds, no admin/manager DM is sent.
4. A trainer with only `trainerUsername` and no `telegramId` is treated as not directly deliverable.
5. Admins/managers are attempted only if `trainer.telegramId` is absent or the trainer DM fails.
6. A successful fallback staff DM returns `{ delivered: true }`.
7. A total delivery failure returns `{ delivered: false, reason: "trainer-unavailable" }`.
8. No DB migration or new table is introduced.

## Tests

- Service: trainer with `telegramId` and successful send returns delivered and does not call
  admin/manager fallback.
- Service: trainer with no `telegramId` calls admin/manager fallback.
- Service: trainer send failure calls admin/manager fallback.
- Service: `trainerUsername` without `telegramId` does not attempt a trainer DM.
- Service: trainer and fallback failures return `trainer-unavailable`.
- Controller/API contract: `POST /trainers/:id/individual-request` still validates the same request
  body and returns `IndividualRequestResult`.
- Bot/Mini App: callers do not change their request shape and continue rendering only the result.

## Dependencies

- Existing `POST /trainers/:id/individual-request` endpoint.
- Existing trainer `telegramId` field.
- Existing admin/manager fallback recipient list and Telegram sender.
- Existing bot and Mini App individual request clients.

## Open questions

1. **Should fallback staff receive separate stored copy from trainers?** Default: no. Shared staff
   template/copy is acceptable for now, and no separate DB template is introduced in this slice.
2. **Should trainer send failures be logged?** Default: yes, without tokens or sensitive payloads,
   matching existing notification failure handling.
3. **Should fallback staff be notified after a trainer DM succeeds for audit visibility?** Default:
   no. Successful trainer delivery must not notify admins/managers.

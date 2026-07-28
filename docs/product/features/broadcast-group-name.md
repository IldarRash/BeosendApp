# Broadcast Group Name

## Goal

Show the full group name in Telegram free-slot broadcasts, especially the "tomorrow" broadcast, so recipients and admins can distinguish slots that share the same level. Keep the slice narrow: add `groupName` to the existing slot response contract, assemble it in the API from `groups.name`, and render it in the sent/previewed broadcast content.

## Spec refs

- Polished request: "Telegram broadcasts about tomorrow's available slots" must show the full group name, not only the level.
- Live contract comments: `packages/types/src/training-contracts.ts` marks broadcasts as section 12/T2.4 and previews as server-computed.
- Live message comments: `apps/api/src/modules/broadcasts/broadcast-messages.ts` cites UX section 13 and currently composes one line per slot from level, trainer, free seats, and price.
- Architecture refs read: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`, `docs/architecture/database.md`.
- `docs/product/feature-roadmap.md` is absent in this worktree, so there is no roadmap entry to link.
- This is not part of the admin redesign task.

## Smallest correct slice

Use the existing broadcast data path end to end:

1. Extend the shared slot card response with required `groupName: string`.
2. Read `groups.name` in the broadcast slot repository and carry it through `BroadcastSlotRow` -> `SlotCard`.
3. Include `groupName` in the API-composed Telegram broadcast text.
4. Pass `groupName` into the per-slot button model and include it in the inline button only if the label stays compact.
5. Show `groupName` in the admin broadcast preview slot metadata, while continuing to render `preview.text` verbatim from the API.

Do not add new broadcast types, scheduling automation, audience logic, migrations, admin redesign work, or booking behavior.

## Contracts & tables

Contracts:

- `packages/types/src/training-contracts.ts`
  - Add required `groupName: z.string()` to `slotCardSchema`.
  - `broadcastPreviewSchema.slots` then gains required `groupName` through `slotCardSchema`.
  - Because `SlotCard` is shared, update every `SlotCard` producer and test fixture to satisfy the same contract. This includes public available-slot responses; the route remains compatible except for the added response field.
- `apps/api/src/modules/notifications/notification-keyboards.ts`
  - Extend `BookSlotButton` with `groupName`.
  - Keep callback data unchanged: `book:slot:<trainingId>`.

Tables:

- Read from existing `groups.name` via the current `trainings.group_id -> groups.id` join.
- Existing reads remain on `trainings`, `groups`, `levels`, and `trainers`.
- Existing broadcast audit write remains on `broadcasts`.
- No DB schema change and no migration.

## API

- `GET /broadcasts/preview`
  - Request: unchanged `broadcastPreviewQuerySchema` with `type` and optional `audience`.
  - Response: unchanged top-level `BroadcastPreview` shape, but each `slots[]` item now requires `groupName`.
  - `text` must be the exact Telegram message body and must include `groupName` for each advertised slot.

- `POST /broadcasts/send`
  - Request: unchanged `sendBroadcastSchema`.
  - Response: unchanged `Broadcast`.
  - Side effect: the sent Telegram text and stored `broadcasts.payload` include the group name because both use the API-composed text.

- Public slot routes using `SlotCard`, especially `GET /trainings/available`, must include `groupName` in each returned card after the shared contract change. This is contract fallout, not a separate feature.

## Message flow

- Admin preview flow:
  - Manager/admin opens Broadcasts.
  - Admin chooses type/audience.
  - Admin preview calls `GET /broadcasts/preview`.
  - Preview shows recipient count, exact API `text`, and a slot table that includes group name, level, trainer, free seats, and price.

- Send flow:
  - Admin sends the previewed broadcast with `POST /broadcasts/send`.
  - API reselects bookable slots at send time, composes the text with `groupName`, builds inline booking buttons, sends Telegram messages, and writes one `broadcasts` row.
  - Recipient taps `book:slot:<trainingId>` and continues through the existing booking confirmation path.

- Telegram copy:
  - Message body is authoritative and must include the group name.
  - Keep Russian UX compact and clear. Suggested line shape:
    - `2026-07-08 18:00-19:30 | Gruppa: Plyazhny start | Uroven: Beginner | Ana | 5 mest | 1500 RSD`
  - Inline button default: include group name if readable, for example `Zapisatsya | 18:00 | Plyazhny start`.
  - If compactness suffers, keep existing button structure and rely on the message body for group identity.

## Invariants

- API remains the source of truth for broadcast data assembly, text composition, recipient counts, and send-time bookability.
- Bot/admin remain thin renderers: they call typed API clients and render validated output; they do not derive group names or recompute availability.
- Broadcast still advertises only bookable group trainings: `open`, active/visible group, active trainer, active level, non-null group, and `bookedCount < capacity`, with `isBookable` rechecked in the service.
- Broadcast send still writes exactly one `broadcasts` row and tolerates per-recipient Telegram send failures as today.
- Inline button callback data must stay under Telegram limits and remain byte-compatible: `book:slot:<trainingId>`.
- Existing audience narrowing must not widen recipients.
- No secrets, pricing, capacity, money, or booking status logic moves into bot or admin.

## Acceptance criteria

- `BroadcastPreview.slots[]` rejects missing `groupName` and accepts a valid non-empty group name.
- `GET /broadcasts/preview?type=tomorrow` returns slot cards with `groupName` sourced from `groups.name`.
- The preview `text` for every non-empty broadcast type includes the group name on each slot line.
- `POST /broadcasts/send` sends Telegram text containing the group name and stores that same text in `broadcasts.payload`.
- Broadcast inline buttons include `groupName` when the final label remains compact; otherwise callback behavior and message body remain correct.
- Admin Broadcasts preview renders the exact API message body and shows the group name in slot metadata, not just the level.
- Public `SlotCard` consumers continue to parse responses after the required `groupName` addition.
- Non-admin preview/send remains forbidden and writes/sends nothing.
- Full/cancelled/non-bookable slots remain excluded from preview and send.
- Existing unrelated admin redesign or dirty worktree changes are preserved during implementation.

## Tests

- `packages/types/src/broadcast-contracts.spec.ts`
  - Add `groupName` to the valid preview fixture.
  - Assert a preview slot without `groupName` is rejected.
- `packages/types/src/training-contracts.spec.ts`
  - Update shared `SlotCard` and `trainingScheduleSlotSchema` fixtures for required `groupName`.
  - Cover `slotCardSchema` rejection when `groupName` is absent.
- `apps/api/src/modules/broadcasts/broadcasts.service.spec.ts`
  - Update `BroadcastSlotRow` fixtures with `groupName`.
  - Assert preview slots and composed text carry `groupName`.
  - Assert send passes `groupName` into button construction where labels are changed.
  - Keep non-admin and bookability exclusion tests green.
- `apps/api/src/modules/broadcasts/broadcast-messages.spec.ts`
  - Assert every slot line contains group name and level.
- `apps/api/src/modules/notifications/notification-keyboards.spec.ts`
  - If button labels include group names, assert label text includes `groupName` and callback data stays `book:slot:<trainingId>`.
  - If button labels stay compact without group name, assert callback behavior is unchanged and document that message text is authoritative.
- `apps/api/src/modules/trainings/trainings.service.spec.ts`
  - Update shared `SlotCard` producer expectations so `GET /trainings/available` cards include `groupName`.
- `apps/bot/src/*SlotCard*` and `apps/miniapp/src/*SlotCard*` specs
  - Update fixtures for the required `groupName`; only add rendering assertions where existing UI already displays group context.
- `apps/admin/src/pages/Broadcasts.spec.tsx`
  - Add `groupName` to `samplePreview`.
  - Assert the admin preview displays group name and still displays `preview.text` verbatim.

## Dependencies

- Existing broadcasts module and admin Broadcasts page.
- Existing `groups.name` data and `trainings.groupId` joins.
- Existing typed API clients and Zod response parsing.
- Existing `book:slot:<trainingId>` booking callback flow.
- No dependency on admin redesign.

## Open questions

- Should `groupName` be nullable for legacy or broken rows?
  - Default: no. Broadcast slots are group-training rows joined to `groups.name`; response `groupName` is required.

- Should all `SlotCard` responses gain `groupName`, not only broadcast previews?
  - Default: yes, because broadcasts reuse `slotCardSchema`; update all shared `SlotCard` producers rather than inventing a parallel broadcast-only schema.

- Should the inline button include the group name?
  - Default: yes when readable, for example `Zapisatsya | 18:00 | Plyazhny start`; fall back to the current compact button if labels become too long. Message text is authoritative either way.

- Does admin preview need to show inline button labels?
  - Default: no. It must show the exact Telegram message body plus slot metadata with `groupName`; button preview is optional unless implementation changes the label.

- Should this slice change audience selection, send scheduling, or "freed-up" semantics?
  - Default: no. Preserve current audience and date-window behavior.

- Should implementation happen in the current worktree if unrelated admin redesign changes appear?
  - Default: preserve unrelated changes and avoid mixing this slice with admin redesign work; use the project GitHub/worktree flow if the full agent implementation flow is approved.

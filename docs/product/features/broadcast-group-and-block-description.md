# Broadcast group name and court-block description

## Goal

Issue #55 fixes two operator-visible content gaps without changing pricing, capacity, availability,
or broadcast audience logic:

- available-slot Telegram broadcasts and the admin preview show the full group name, not only level;
- manual/admin court blocks can carry optional long-form description notes, editable from the
  CourtLoad block modal.

## Spec refs

- GitHub issue #55.
- Architecture refs: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`,
  `docs/architecture/database.md`.
- Existing code anchors: T2.4 broadcasts, C5 court blocks, C6 CourtLoad grid.
- `docs/product/feature-roadmap.md` is absent in this worktree; issue #55 is the slice source.

## Contracts & tables

- `packages/types/src/training-contracts.ts`
  - Add required `groupName: string` to `slotCardSchema`.
  - Because `broadcastPreviewSchema.slots` and `trainingScheduleSlotSchema` reuse `slotCardSchema`,
    update every SlotCard producer and fixture.
- `packages/types/src/court-contracts.ts`
  - Add `description: string | null` to `courtBlockSchema` and `courtLoadCellSchema`.
  - Add optional nullable `description` to `createCourtBlockSchema` and
    `createRecurringCourtBlocksSchema`.
  - Replace/evolve `reassignCourtBlockSchema` into a PATCH body that accepts `courtId?` and
    `description?`, with at least one field present.
- `packages/db/src/schema.ts`
  - Add nullable `court_blocks.description text`.
  - Keep `court_blocks.reason text not null` as the required short reason/type.

Default normalization: missing, `null`, empty, or whitespace-only description stores as `null`;
non-empty descriptions are trimmed. Default max length: 1000 characters.

## API

- `GET /trainings/available`
  - Response `SlotCard[]` includes `groupName` from `groups.name`.
- Public schedule producer using `trainingScheduleSlotSchema`
  - Include the same `groupName` because it extends `slotCardSchema`.
- `GET /broadcasts/preview?type=&audience=`
  - Response `BroadcastPreview.slots[*].groupName`.
  - Response `text` is the exact server-composed Telegram body and includes the group name in each
    advertised slot line.
- `POST /broadcasts/send`
  - Reuses the same server composition path as preview; stored `broadcasts.payload` and Telegram
    message text include group names.
- `POST /court-blocks`
  - Body adds optional `description?: string | null`; response includes `description`.
- `POST /court-blocks/recurring`
  - Body adds optional `description?: string | null`; every created block gets the normalized value.
- `GET /court-blocks`
  - Response rows include `description`.
- `GET /courts/load?date=`
  - Block/training cells with a `blockId` include `description`; non-block cells return `null`.
- `PATCH /court-blocks/:id`
  - Body accepts `{ courtId?: uuid; description?: string | null }`.
  - If `courtId` is present, keep the existing server-side overlap and six-per-slot checks.
  - If only `description` changes, do not run availability/capacity logic.
  - Response includes the updated `CourtBlock`.

## Bot flow

- Available-slot broadcast recipients see the same inline booking path as today:
  1. Manager sends a broadcast from admin.
  2. Client receives a Telegram message where each slot line includes the full group name.
  3. Client taps the existing `book:slot:<trainingId>` button and enters the existing booking flow.
- No new bot screens, commands, callbacks, or booking semantics.

## Admin flow

- Broadcasts page:
  - Preview renders `preview.text` verbatim from the API.
  - Slot table adds/displays `groupName`; it does not compose broadcast copy locally.
- CourtLoad:
  - Creating a manual block lets the manager enter optional description notes.
  - Opening an existing block from the grid shows reason and description, and lets the manager edit
    description.
  - The UI calls typed API methods and invalidates court-block/load-grid queries after save; it does
    not compute availability, capacity, or overlap.

## Invariants

- Contracts remain the source of truth; browser/bot clients parse updated Zod contracts.
- API services remain the only place for broadcast slot filtering, audience resolution, court
  availability, overlap checks, and six-per-slot limits.
- Admin preview and sent Telegram text share one API message composition path.
- `reason` stays required and short; `description` is optional notes only and never drives business
  rules.
- Court numbers, block ids, reasons, and descriptions remain admin-only; public slot responses only
  add the user-facing group display name already used for training context.

## Acceptance criteria

- Broadcast preview text and sent Telegram text include each slot's full group name from
  `groups.name`.
- Admin Broadcasts preview shows the exact API `text` body and a slot table column/value for group
  name.
- `SlotCard` contract requires `groupName`; available slots, public schedule slots, and broadcast
  slots all populate it.
- Court block create and recurring create accept omitted, `null`, or non-empty description; responses
  include normalized `description`.
- CourtLoad block modal can edit description for an existing block without moving the block.
- `PATCH /court-blocks/:id` can update description alone, court alone, or both; invalid/empty PATCH
  bodies are rejected.
- Existing court availability, booking, capacity, pricing, and broadcast audience behavior is
  unchanged.

## Tests

- Contract tests:
  - `slotCardSchema` rejects missing `groupName`.
  - `broadcastPreviewSchema` accepts slots with `groupName`.
  - court block create/recurring/PATCH schemas accept nullable optional description and reject
    overlong description.
- API tests:
  - broadcast repository/service maps `groups.name` to `groupName` and message text includes it.
  - preview and send compose identical slot lines for group names.
  - non-admin broadcast preview/send remains forbidden before DB/send work.
  - court-block create, recurring create, list, and load-grid responses include description.
  - PATCH description-only update does not call availability reassignment logic.
  - non-admin court-block PATCH remains forbidden before writes.
- Admin tests:
  - Broadcasts renders API `preview.text` verbatim and displays group name in slot rows.
  - CourtLoad block modal renders existing description, saves changed/cleared description, and
    invalidates/refetches load data.

## Dependencies

- Existing broadcast preview/send endpoints and `composeBroadcastText`.
- Existing CourtLoad grid, `ReassignCourtDialog`/block modal path, and court-block mutation hooks.
- DB migration generation for the nullable `court_blocks.description` column.

## Open questions

- Should the Telegram slot line replace level with group name or show both?
  - Default: show both, with group name first, because managers still use level for targeting/context.
- Should recurring block descriptions apply to every generated occurrence?
  - Default: yes, copy the normalized description to every created block.
- Should auto-generated group-training blocks get editable descriptions?
  - Default: yes, any block with a `blockId` can store notes; description does not affect the linked
    training or scheduling logic.
- Should description be localized?
  - Default: no; it is manager-authored free text stored as-is.

## Implementation handoff

- Approved for implementation.
- Main planner/docs role only; no production code, tests, or config edited in this planning step.
- Estimated context load for implementation handoff: under 20% per role if split into backend,
  frontend/admin, bot-message, tests, review/security.

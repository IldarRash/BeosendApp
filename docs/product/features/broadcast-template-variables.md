# Broadcast Template Variables

## Goal

Add admin-managed custom templates for existing free-slot broadcasts, with server-defined variables resolved by the API into exact preview/send text. Keep this separate from notification templates and from the admin Dispatch Desk redesign.

## Spec refs

- User request: add a separate feature for custom broadcast templates with parameters such as free seats and other variables resolved automatically.
- Existing broadcast brief: `docs/product/features/broadcast-group-name.md` covers the known `groupName` gap and preview fidelity for current free-slot broadcasts.
- Existing contracts: `packages/types/src/training-contracts.ts` defines fixed broadcast types, audience narrowing, `BroadcastPreview`, and `SlotCard`.
- Existing notification template contracts: `packages/types/src/notification-template-contracts.ts` are event-key overrides with permissive placeholders; this feature must not reuse that table/model for custom broadcasts.
- Existing DB schema: `broadcasts` audit rows and `notification_templates` override rows are separate.
- Existing API path: `apps/api/src/modules/broadcasts/*` composes fixed `today`, `tomorrow`, `week`, and `freed-up` messages with preview/send.
- Existing admin path: `apps/admin/src/pages/Broadcasts.tsx` renders API preview text and slot metadata.
- Architecture: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`, `docs/architecture/database.md`.
- `docs/product/feature-roadmap.md` is absent in this worktree, so there is no roadmap entry to link.

## Smallest correct slice

Create a contracts-first broadcast-template catalog for the existing free-slot broadcast flow only:

- Existing broadcast types remain `today`, `tomorrow`, `week`, and `freed-up`.
- Existing audiences remain `all`, `level`, `active`, and `lapsed`; no new recipient logic or scheduling.
- Admin can manage reusable broadcast templates and select one for preview/send.
- API renders preview text from the selected template and curated variable values.
- API sends using the selected template version rule, not a browser-rendered body.
- Admin renders exact API-produced preview text and server variable metadata; it does not interpolate locally.

This does not broaden notification templates, redesign the Broadcasts page, add scheduled sends, add new recipient segments, or change booking callbacks.

## Contracts & tables

Contracts:

- Add a new shared contract file, default `packages/types/src/broadcast-template-contracts.ts`, or an equivalent existing export location if the implementer finds a better local pattern.
- Add schemas/types for:
  - `broadcastTemplateVariableSchema`: server-defined variable metadata with `key`, `label`, `description`, `example`, and value type.
  - `broadcastTemplateSchema`: catalog row with `id`, `name`, `broadcastType`, `status`, `bodyTemplate`, `slotLineTemplate`, `emptyBodyTemplate`, `version`, `createdAt`, `updatedAt`, and `updatedBy`.
  - `createBroadcastTemplateSchema` and `updateBroadcastTemplateSchema`.
  - `broadcastTemplatePreviewSchema`: selected `templateId`, `templateVersion`, `previewToken`, `type`, `audience`, `text`, `slots`, `recipientsCount`, and variables used.
- Extend existing broadcast preview/send contracts without breaking the default flow:
  - `broadcastPreviewQuerySchema`: optional `templateId`.
  - `broadcastPreviewSchema`: optional `templateId`, `templateVersion`, `previewToken`, and variable metadata.
  - `sendBroadcastSchema`: optional `templateId` and optional/required `previewToken` when a custom template is selected.
- Server-defined curated variables for the first slice:
  - `{freeSeats}` from server-computed free seats.
  - `{date}` from the training date.
  - `{startTime}` from the training start time.
  - `{endTime}` from the training end time.
  - `{trainer}` from trainer display name.
  - `{level}` from level display name.
  - `{price}` from server-owned RSD price display.
  - `{groupName}` only after or alongside the `groupName` SlotCard/repository gap from `broadcast-group-name.md`.
- Unlike current notification templates, broadcast templates should reject unknown placeholders by default. Unknown tokens in broadcast messages are operational errors, not literal output.

Tables:

- Add `broadcast_templates` in `packages/db/src/schema.ts`:
  - `id uuid primary key defaultRandom()`
  - `name text not null`
  - `broadcast_type broadcast_type not null`
  - `status entity_status not null default active`
  - `body_template text not null`
  - `slot_line_template text not null`
  - `empty_body_template text not null`
  - `version integer not null default 1`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - `updated_by bigint`
  - unique index on active `(broadcast_type, name)` or equivalent duplicate guard.
- Keep existing `notification_templates` unchanged.
- Keep existing `broadcasts` as the send audit table. Store the final rendered text in `broadcasts.payload` as today; include template id/version in payload metadata only if the existing payload contract is expanded intentionally.

Default persistence decision:

- Use a same-template-version preview rule. Preview returns a server-signed `previewToken` containing `templateId`, `templateVersion`, broadcast `type`, audience descriptor, and expiry. Send rejects expired tokens or template-version mismatch, then re-renders current bookable slots with the same template version so stale previews cannot advertise full/cancelled slots.

## API

New admin endpoints:

- `GET /broadcast-templates?type=<broadcastType>`
  - Response: `BroadcastTemplate[]`.
  - Lists active templates for a free-slot broadcast type. Admin-only.
- `POST /broadcast-templates`
  - Body: `CreateBroadcastTemplateInput`.
  - Response: `BroadcastTemplate`.
  - Creates a reusable template. Admin-only.
- `PATCH /broadcast-templates/:id`
  - Body: `UpdateBroadcastTemplateInput`.
  - Response: `BroadcastTemplate`.
  - Updates body/name/status and increments `version`. Admin-only.
- `GET /broadcast-templates/variables?type=<broadcastType>`
  - Response: `BroadcastTemplateVariable[]`.
  - Returns the curated server variable list and examples for the selected broadcast type. Admin-only.

Changed existing endpoints:

- `GET /broadcasts/preview`
  - Request: existing `type` and optional `audience`, plus optional `templateId`.
  - Response: existing preview text/slots/recipient count, plus `templateId`, `templateVersion`, `previewToken`, and variable metadata when a template is selected.
  - Behavior: API selects bookable slots, resolves variables, validates allowed placeholders, and returns the exact composed message body.
- `POST /broadcasts/send`
  - Request: existing `type` and optional `audience`, plus optional `templateId` and `previewToken`.
  - Response: existing `Broadcast`.
  - Behavior: API validates admin, token expiry, token audience/type/template/version, reselects current bookable slots, resolves variables, sends the API-rendered body, and writes one `broadcasts` row.

Admin API client:

- Add typed `ApiClient` methods and hooks for template list/create/update, variables, custom preview, and custom send.
- The admin page must display `preview.text` verbatim and never call the interpolation helper.

## Bot flow

Recipient flow remains the existing broadcast booking path:

1. Admin previews and sends a free-slot broadcast.
2. API sends Telegram text rendered from the selected template and attaches existing per-slot booking buttons.
3. Recipient taps `book:slot:<trainingId>`.
4. Existing bot booking flow re-checks availability and continues through current confirmation/waitlist behavior.

Bot implementation should only change if button label data needs `groupName` from the existing `broadcast-group-name` dependency. Callback data remains `book:slot:<trainingId>`.

## Invariants

- API remains the source of truth for broadcast preview text and template variable resolution.
- Browser/admin never interpolates variables for the authoritative preview or send body.
- Broadcast templates are separate from `notification_templates`; event-key notification overrides remain unchanged.
- Broadcasts still advertise only server-selected bookable group trainings: open, visible active group, active trainer, active level, non-null group, and `bookedCount < capacity`, with service-level `isBookable` recheck.
- Send must not use stale capacity/availability. The selected template version can be fixed by the preview token, but current slots are reselected at send time.
- Audience selection can only narrow the active-client base; no new recipient segment is introduced.
- Non-admin preview/template management/send is forbidden and writes/sends nothing.
- Unknown broadcast template variables are rejected server-side.
- `groupName` is only available when the shared slot/repository contract includes it; do not fake it in the admin.
- Existing `broadcasts` audit behavior still writes one row per send and tolerates per-recipient Telegram failures as today.

## Acceptance criteria

- Admin can list active broadcast templates for `today`, `tomorrow`, `week`, and `freed-up`.
- Admin can create/update/archive a template for an existing broadcast type.
- API rejects templates containing unknown placeholders.
- API exposes the curated variable list with examples for the selected type.
- `GET /broadcasts/preview?type=tomorrow&templateId=...` returns API-composed text, slots, recipients count, template id/version, and preview token.
- Admin Broadcasts page renders the exact `preview.text` returned by the API and shows variable metadata without local interpolation.
- `POST /broadcasts/send` with a custom template validates preview token expiry and template version, re-renders current bookable slots server-side, sends the rendered text, and writes one `broadcasts` row.
- If the template is edited after preview, send is rejected with a clear error that requires a fresh preview.
- If slots become full/cancelled after preview, send uses current bookable slots and does not advertise unavailable slots.
- Existing default fixed broadcasts keep working when no `templateId` is selected.
- Current notification template editor and `notification_templates` data are unchanged.
- The feature does not add scheduling, new audiences, admin Dispatch Desk redesign work, or new booking callback semantics.

## Tests

- Contract tests:
  - valid broadcast template create/update payloads parse;
  - empty body/slot/empty templates reject;
  - unknown placeholders reject;
  - allowed placeholders parse for `freeSeats`, `date`, `startTime`, `endTime`, `trainer`, `level`, `price`, and `groupName` when available;
  - preview/send schemas accept optional template fields without breaking existing fixed broadcasts.
- DB/repository tests:
  - create/list/update/archive template rows;
  - update increments `version`;
  - duplicate active names per type are rejected or normalized by the chosen DB rule.
- API service tests:
  - non-admin list/create/update/preview/send is forbidden;
  - preview resolves variables from server slot rows and returns exact text;
  - unknown variable templates fail before send;
  - send rejects expired/mismatched preview token;
  - send rejects template-version mismatch after edit;
  - send reselects current bookable slots and excludes newly full/cancelled slots;
  - default no-template preview/send behavior remains unchanged.
- Message rendering tests:
  - multiple slots render through `slotLineTemplate`;
  - empty slot set renders `emptyBodyTemplate`;
  - price/freeSeats/date/time/trainer/level/groupName are formatted consistently.
- Admin tests:
  - template selector/list states;
  - variable chips/help render from API metadata;
  - preview text is displayed verbatim;
  - create/update errors surface server messages;
  - send requires a fresh preview after template edits.
- Bot/keyboard tests only if button labels change; callback data must remain `book:slot:<trainingId>`.

## Dependencies

- Existing broadcasts preview/send module and `Broadcasts.tsx`.
- Existing `broadcasts` audit table.
- Existing audience narrowing and active-client recipient resolution.
- `broadcast-group-name.md` should land before or alongside this feature if `{groupName}` is included in the first variable set.
- New DB migration for `broadcast_templates`.
- No dependency on the admin Dispatch Desk redesign.
- No worktree or branch is created during this planning step; use a separate implementation worktree after approval.

## Open questions

- Should custom broadcast templates reuse `notification_templates`?
  - Default: no. Use a separate `broadcast_templates` catalog because notification templates are event-key overrides with permissive placeholders, while broadcasts need reusable free-slot templates with strict variables.
- Should unknown broadcast placeholders be left literal like notification templates?
  - Default: no. Reject unknown placeholders server-side so managers do not send broken broadcast copy.
- Should sends use the exact preview snapshot or re-render at send time?
  - Default: use a preview token with same template version, then re-render current slots at send time. This protects availability while preventing silent template edits between preview and send.
- Should `{groupName}` ship in the first template variable set?
  - Default: yes only if the `broadcast-group-name` contract gap lands before or alongside this feature; otherwise hide/reject `{groupName}` until the server can provide it.
- Should templates be localized by RU/SR/EN?
  - Default: no for the first slice. Current broadcast body is RU-oriented; add locale dimension later if product asks for localized broadcasts.
- Should this add scheduled broadcasts or new recipient audiences?
  - Default: no. Existing free-slot broadcast types and audiences only.
- Should admin page layout be redesigned as part of this work?
  - Default: no. Add only the controls required for templates and variables; leave broader Broadcasts page redesign to the Dispatch Desk/body redesign track.
- Should implementation start now?
  - Default: no. Wait for user approval of the full agent flow and then create the requested separate worktree.

## Agent flow approval gate

Do you want to run the full agent flow for this broadcast-template-variables slice?

Planned roles/subtasks after approval:

- `planner`: keep this brief current and enforce separation from admin redesign.
- `architect`: finalize contracts, table shape, preview-token/version rule, and migration boundaries.
- `backend-implementer`: add contracts, schema/migration, repository/service/controller, and message renderer.
- `frontend-implementer`: add admin API client methods, hooks, and focused Broadcasts page controls.
- `bot-implementer`: adjust button data only if required by `groupName` label changes.
- `test-writer`: cover contracts, repository, service, message rendering, admin UI, and unsafe paths.
- `reviewer`: check correctness and scope.
- `security-reviewer`: verify admin authz, token integrity, validation, availability, and no secret leaks.
- `app-runner`: verify preview/send in the running app stack.

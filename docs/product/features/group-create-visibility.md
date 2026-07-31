# Group visibility during creation

## Goal

Let an admin choose whether a new group is shown to clients or hidden while creating it, and persist
that choice through the existing group create path. Keep visible (`hidden: false`) as the default and
do not change training visibility or any existing group behavior.

## Spec refs

- Approved Factory slice `WF-2026-07-31-feedback-to-backlog-01`, revision 2: add Hide/Show to group
  creation, persist the boolean, retain the visible default, and make no database or
  training-terminal visibility changes.
- `docs/architecture/domain-model.md`: a group owns recurring-slot visibility.
- `docs/architecture/database.md`: `groups` stores visibility; repositories write the database and
  services own invariants.
- Current admin visibility wording in `packages/i18n/src/catalogs/{en,ru,sr}/admin.ts`.
- No repository feature-roadmap or separate product-spec document currently exists for this slice;
  the approved workflow package and current architecture/code are the scoped source of truth.

## Contracts & tables

- `packages/types/src/training-contracts.ts`
  - Extend `createGroupSchema` to accept `hidden` as a boolean.
  - Preserve backward compatibility for callers that omit it by applying the existing
    `false` default at contract validation; invalid non-boolean values remain rejected.
  - `CreateGroupInput` carries the validated boolean to the API service/repository path.
  - `groupSchema` and `updateGroupSchema` remain otherwise unchanged.
- `packages/db/src/schema.ts`
  - Reuse `groups.hidden`, which is already `notNull().default(false)`.
  - No schema edit, generated migration, new table, or backfill.

## API

| Method and path | Request | Response | Change |
| --- | --- | --- | --- |
| `POST /groups` | `CreateGroupInput`, now accepting `hidden: boolean` with omission defaulting to `false` | Existing `Group` | The controller validates the value and the existing service/repository pass it through to `groups.hidden`. |

Authorization, time ordering, active-court validation, status defaults, and error behavior are
unchanged. `PATCH /groups/:id` already accepts `hidden` and needs no contract or behavior change.

## Admin flow

1. Admin opens **Create group**.
2. The existing client-visibility selector is shown with **Shown** selected by default; the admin may
   choose **Hidden**.
3. On save, `apps/admin/src/pages/Groups.tsx` includes `form.hidden` in `CreateGroupInput`; the normal
   success/error behavior remains unchanged.

Reuse the existing selector, translations, hint, and form state. The selector remains available in
edit mode.

## Bot flow

None. No bot screen, button, callback, or API-client change is required.

## Invariants

- `hidden: false` remains the default for a newly opened create form and for API callers that omit
  the field.
- An explicit `hidden: true` or `hidden: false` is persisted exactly as selected.
- Only an authorized admin can create a group; the existing service authorization remains the
  enforcement point.
- Hidden groups retain the existing semantics: excluded from client-facing group listings but
  available to admins and existing server-side flows.
- Group visibility does not alter generated or existing training terminal state, training status,
  capacity, prices, court assignment, or schedule generation.
- The database remains the single persistence source; no UI-only visibility rule or duplicate field
  is introduced.

## Acceptance criteria

- The create-group dialog exposes the localized **Visibility to clients** selector.
- A fresh create form selects **Shown** and submits `hidden: false` unless the admin changes it.
- Selecting **Hidden** submits `hidden: true`; the returned/stored group is hidden and remains visible
  in the admin group list under existing admin read rules.
- `POST /groups` accepts both boolean values and continues to create a visible group when `hidden` is
  omitted.
- A non-boolean `hidden` value is rejected by request validation and does not reach persistence.
- Existing edit visibility behavior and all unrelated group/training behavior remain unchanged.
- No database migration is generated.

## Tests

- `packages/types/src/training-contracts.spec.ts`
  - Accept explicit `hidden: true` and `hidden: false`.
  - Parse omission as `hidden: false`.
  - Reject a non-boolean value.
- `apps/admin/src/pages/Groups.spec.tsx`
  - Replace the create-only omission assertion with a selector/default-visible assertion.
  - Assert default creation submits `hidden: false`.
  - Assert changing the create selector to hidden submits `hidden: true`.
  - Retain the edit payload coverage to guard against regression.
- `apps/api/src/modules/groups/groups.service.spec.ts` as needed for typed fixtures/fakes:
  - Make the fake create path preserve the validated input boolean.
  - Assert admin creation with `hidden: true` returns/stores a hidden group and existing role-aware
    listing rules exclude it for clients but include it for admins.
  - Retain the forbidden non-admin create test to prove no write occurs.
- Run the repository definition-of-done checks:
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Dependencies

- Existing `groups.hidden` column and default.
- Existing `POST /groups` controller/service/repository path and admin `useCreateGroup` mutation.
- Existing visibility selector component and `admin.groups.fieldVisibility`, `visShown`, `visHidden`,
  and `visibilityHint` translations.
- No prerequisite feature, bot change, deployment configuration, or migration.

## Decisions & assumptions

- **Resolved:** visible is the default; no default behavior change is allowed.
- **Resolved:** visibility is selected during creation and persisted on the group row.
- **Resolved:** this slice changes group visibility only, not training terminal visibility or status.
- **Resolved:** no database migration is needed because `groups.hidden` already exists with the
  correct default.
- **Implementation decision:** use a contract-level `false` default so omission remains compatible
  while downstream typed code receives a concrete boolean.
- **Supported assumption:** reuse the edit selector and existing localized copy in create mode; no new
  UX copy or product decision is required.

## Selected-role handoff

- `backend-implementer`: update the shared create contract and any API test fixtures only; no schema,
  migration, service, or repository production changes are expected.
- `frontend-implementer`: expose the existing selector in create mode and include `hidden` in the
  create payload.
- `test-writer`: add the focused contract, admin, and service regression coverage above.
- `reviewer`: verify default compatibility, exact boolean persistence, authorization preservation,
  and the absence of training-visibility or migration scope creep.

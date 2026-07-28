# Court load context actions

## Goal

Let an admin act on an occupied CourtLoad timeline segment without leaving the load view. The
segment detail exposes only the actions appropriate to its current server-backed type and status,
while existing APIs continue to own authorization, status, time, cardinality, and availability
constraints.

## Spec refs

- Ready pre-plan package `court-load-actions-20260718`, revision 1.
- Existing court-request moderation and reassignment behavior marked C4 in
  `packages/types/src/court-contracts.ts` and the court-request API/admin implementation.
- Existing court-block management behavior marked C5 in the shared contracts and court-block API.
- Existing admin load-grid behavior marked C6 in `courtLoadGridSchema`, `GET /courts/load`, and
  `apps/admin/src/pages/CourtLoad.tsx`.
- `apps/admin/PRODUCT.md`: keep the admin operationally precise, render server-decided facts, make
  conflicts explicit, and keep availability/domain logic out of the browser.
- The current tree has no `docs/product/feature-roadmap.md`; this brief scopes the ready workflow
  package against the live C4/C5/C6 implementation instead of inventing a roadmap entry.

## Contracts & tables

No shared-contract, database-schema, or migration change is expected.

Existing contracts reused unchanged:

- `courtLoadGridSchema`, `courtLoadCellSchema`, and their `request | hold | block | training`
  states identify the segment and carry the existing request, training, and block IDs.
- `courtRequestAdminViewSchema` supplies request status, current court numbers, requested
  `courtCount`, client, date/time, duration, and price for the detail/action UI.
- `reassignCourtRequestSchema` carries the complete replacement `courtIds` set.
- `cancelCourtRequestSchema` carries the matching request ID.
- `courtSchema` supplies active court IDs and display numbers for the existing pickers.
- `courtBlockSchema` and `reassignCourtBlockSchema` cover block identity and court reassignment.

Existing tables affected only through existing endpoints:

- `court_requests`: cancellation changes a confirmed request to `cancelled` and retains its
  decision/history fields.
- `court_request_courts`: request reassignment atomically replaces the complete assigned court set.
- `court_blocks`: block reassignment changes `court_id`; manual block cancellation uses the
  existing hard delete and removes the row.
- `courts`: read only, to populate active-court choices.

## API

No new endpoint or response field is required. The admin reuses the typed `ApiClient` methods and
React Query hooks already used by the request/block pages.

| Method and path | Existing contract | Use in this slice |
| --- | --- | --- |
| `GET /courts/load?date=YYYY-MM-DD` | `courtLoadGridSchema` | Render segments and obtain their existing IDs/state. |
| `GET /court-requests/:id` | `courtRequestAdminViewSchema` | Resolve current request status/details before showing actions. |
| `GET /court-requests/:id/free-courts` | `Court[]` via `courtSchema` | Populate the confirmed-request replacement picker; the server includes the request's own assigned courts and rejects ineligible requests. |
| `PATCH /court-requests/:id/courts` | Request: `reassignCourtRequestSchema`; response: `courtRequestAdminViewSchema` | Replace the entire court set for a future confirmed request. |
| `POST /court-requests/:id/cancel` | Request: `cancelCourtRequestSchema`; response: `courtRequestSchema` | Cancel a confirmed request and release its occupancy. |
| `GET /courts` | `Court[]` via `courtSchema` | Populate block reassignment choices. |
| `PATCH /court-blocks/:id` | Request: `reassignCourtBlockSchema`; response: `courtBlockSchema` | Move a manual or training-linked block to another active court. |
| `DELETE /court-blocks/:id` | `204 No Content` | Hard-delete a manual block after explicit confirmation. |

All errors, including stale status, past-request reassignment, inactive courts, overlap, and
capacity conflicts, are rendered from the existing API error path. The admin does not recompute
availability.

## Bot flow

N/A. This is an authenticated admin CourtLoad interaction only; bot and Mini App behavior do not
change.

## Action matrix

| CourtLoad segment | Detail | Available actions |
| --- | --- | --- |
| Confirmed request (`request`) dated today or later | Existing request detail | Change courts by submitting one complete replacement set; cancel request. |
| Confirmed request (`request`) in the past | Existing request detail | Cancel request only. Reassignment remains future-only, matching the existing backend invariant and request-page rule. |
| Pending request hold (`hold`) | Existing request detail | Read-only; no confirm, reject, reassign, or cancel action is added to CourtLoad. |
| Manual block (`block`) | Segment date/time, court, reason, and manual type | Change court; cancel/delete after confirmation. Cancellation is the existing hard delete, not a soft status transition. |
| Training-linked block (`training`) | Existing training detail plus block reason | Change court only; no block delete/cancel action. |

The current `/court-requests` page and its reassignment flow remain unchanged. CourtLoad may reuse
the same selection rules and hooks, but this slice does not refactor or redesign that page.

## Invariants

- The API remains the source of truth for admin authorization, current request status, active
  courts, resolved working hours, availability, overlap, and per-slot court capacity.
- A request reassignment submits the complete replacement court set. After deduplication, its
  cardinality must equal `court_requests.court_count` exactly; partial single-court editing of a
  multi-court request is not allowed.
- Request reassignment is atomic, excludes the request's own current occupancy during validation,
  and remains limited to future confirmed requests.
- Request cancellation is confirmed-request-only. Assigned join rows remain as history, while the
  `cancelled` status removes the request from pending/confirmed occupancy reads.
- Pending holds remain visible but read-only on CourtLoad; moderation stays on the existing request
  page.
- A manual block can be moved or hard-deleted. A training-linked block exposes only reassignment in
  this CourtLoad detail, so the training-to-block link is not severed by a load-grid action.
- Block reassignment reuses the existing server transaction, date lock, active-court check, overlap
  check, current-block exclusion, and per-slot active-court limit.
- The UI decides action visibility only from validated load/detail state and sends intent through
  typed APIs; it does not infer freeness from the rendered grid.
- Mutations disable their destructive/submit controls while pending, require explicit confirmation
  for cancellation/deletion, keep actionable errors visible, and preserve keyboard/focus behavior
  of the existing modal primitives.
- After request reassignment or cancellation settles, refetch/invalidate all request, free-court,
  and court-load queries. After successful block reassignment or deletion, invalidate/refetch all
  court-block and court-load queries. Closing a successful action returns the admin to the same
  CourtLoad date with refreshed segments.

## Acceptance criteria

- Clicking a confirmed-request segment opens its current detail and offers cancellation; a request
  dated today or later also offers complete-set court reassignment.
- The request reassignment picker loads eligible courts from
  `GET /court-requests/:id/free-courts`, preselects current courts when returned, prevents submission
  until exactly `courtCount` courts are selected, and sends the full `courtIds` array.
- A multi-court request cannot be submitted with a partial replacement set, duplicate courts, or a
  different number of courts; the existing server validation remains authoritative.
- Cancelling a confirmed request requires explicit confirmation, uses the existing cancel endpoint,
  and removes its segment after the invalidated CourtLoad query refetches.
- Clicking a pending-hold segment opens request detail without any mutation control.
- Clicking a manual-block segment opens a detail with its court, time span, and reason, and offers
  both change-court and cancel/delete actions.
- Confirming manual-block cancellation calls the existing `DELETE /court-blocks/:id` hard-delete
  path; cancelling the confirmation makes no request.
- Clicking a training-linked segment keeps the existing training detail and offers change-court
  only; no delete/cancel control is present.
- Successful request or block reassignment refreshes the timeline so the whole segment leaves its
  previous court and appears on the selected replacement court set.
- API conflicts and stale-state responses are shown in the active dialog; request mutations still
  invalidate/refetch on settle so the detail and grid converge on server state.
- Existing request-page reassignment, request moderation, CourtBlocks page behavior, working-hours
  editing, orphan-training assignment, bot flows, and Mini App flows are unchanged.
- New controls have localized RU/SR/EN labels, accessible names, visible focus, non-color-only state,
  and no mouse-only interaction.

## Tests

- Extend `apps/admin/src/pages/CourtLoad.spec.tsx` for each action-matrix row:
  future confirmed request, past confirmed request, pending hold, manual block, and training-linked
  block.
- Verify the confirmed-request detail loads current data, preselects the current court set, enforces
  exact `courtCount`, sends the complete replacement payload, and surfaces a conflict without local
  availability math.
- Verify confirmed-request cancellation requires confirmation, calls the existing mutation once,
  handles success/error states, and leaves pending holds mutation-free.
- Verify manual-block detail exposes both actions, cancelled confirmation performs no deletion,
  confirmed deletion uses the block ID, and training-linked detail never exposes delete/cancel.
- Preserve and extend the existing CourtLoad reassignment coverage so manual and training-linked
  blocks both use `ReassignCourtDialog`, exclude the current court, and render server conflicts.
- Extend hook tests to prove request reassignment/cancellation invalidates request, free-court, and
  load keys on settle, and block reassignment/deletion invalidates block and load keys on success.
- Keep existing API service/controller specs green for future-only request reassignment, exact
  cardinality, duplicate/inactive/occupied court rejection, confirmed-only cancellation, block
  overlap/capacity checks, and admin authorization. No new backend test is required unless
  implementation changes backend behavior unexpectedly.
- Run the repository checks required by the BeoSand definition of done, including admin, types,
  API, i18n, typecheck, lint, tests, and build.

## Dependencies

- Existing C4 court-request detail, free-court, reassignment, and cancellation endpoints and typed
  admin hooks.
- Existing C5 block reassignment/delete endpoints, `useReassignCourtBlock`,
  `useDeleteCourtBlock`, and `ReassignCourtDialog`.
- Existing C6 CourtLoad segment IDs/state and request/training detail modals.
- Existing active-court read, modal/button/toast primitives, React Query cache keys, and RU/SR/EN
  i18n catalogs.
- Implementation must be prepared on a separate feature branch/worktree through the approved
  BeoSand agent workflow.

## Decisions & assumptions

- Clarification package status is `ready`; no material product question remains.
- The slice adds context actions only to CourtLoad segment detail. It does not consolidate actions
  across the separate request or block pages.
- "Change courts" for a confirmed request means replacing the complete court set, including for a
  multi-court request; it never means editing only the clicked row/court.
- The existing request-page future-date predicate and backend future-only reassignment rule are
  reused; the current request-page reassignment UI remains unchanged.
- "Cancel" for a manual block is presented as a destructive UI action but uses the existing
  `DELETE /court-blocks/:id` hard delete. There is no block status or restore path.
- `block` and `training` load states are sufficient to distinguish manual from training-linked
  blocks for action visibility; no new `groupTrainingId` field is needed in the grid contract.
- Pending holds are deliberately informational in CourtLoad. Confirm/reject stays in the existing
  request moderation queue.
- No new notifications or domain events are emitted for reassignment, request cancellation, or
  manual block deletion in this slice.

## Out of scope

- Redesigning or refactoring `/court-requests`, including its existing reassignment picker.
- Changing `/court-blocks` page actions or layout.
- Confirming/rejecting pending holds from CourtLoad.
- Changing request date, start time, duration, price, client, court count, or status other than the
  existing confirmed-request cancellation.
- Changing training date/time/group data or deleting/cancelling a training-linked block from the
  CourtLoad detail.
- New contracts, tables, migrations, endpoints, availability rules, notifications, webhooks, bot
  steps, Mini App behavior, or a broader CourtLoad redesign.
- Bulk actions, undo/restore, audit-history UI, optimistic grid movement, or cross-date navigation.

## Rollout & runtime verification

- Implement on a dedicated feature branch/worktree and keep the patch limited to the admin
  CourtLoad action UI, localized labels, and focused tests unless a concrete implementation blocker
  is documented.
- No feature flag or data migration is required; deployment uses the existing admin/API release
  path.
- In a running authenticated admin app, open one date containing a future confirmed request, a
  pending hold, a manual block, and a training-linked block. Exercise every action-matrix row and
  verify the modal stays understandable at loading, success, conflict, and stale-state boundaries.
- Verify request reassignment moves all courts as one replacement set, request cancellation frees
  its occupied segments, manual block deletion removes its segment, and both block types move only
  after server acceptance and query refetch.
- Verify a pending hold has no action controls and a training-linked block has no delete/cancel
  control. Confirm `/court-requests` behavior is unchanged.
- Complete correctness review, then security review for admin authorization and server-owned
  availability/integrity, followed by the repository-wide checks and running-app verification before
  PR handoff.

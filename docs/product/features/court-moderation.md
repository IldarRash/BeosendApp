# C4 — Court moderation (admin)

**Goal.** Let the admin review a pending court request, see which courts are free that hour, and either
confirm with a court assignment or reject — notifying the client either way.

**Spec refs.** Edition 2 — admin interface.

## Implementation plan (planner-agreed slice)

Smallest correct vertical slice: contracts → admin-gated service methods in the **existing**
`court-requests` module → repository reads/writes in one transaction → outbound client notification →
admin bot handlers. The client-facing C2/C3 flow must keep working unchanged.

### Module

Extend the existing `apps/api/src/modules/court-requests/` module. Do **not** create a parallel module.
Add the admin moderation methods to `CourtRequestsService`, new reads/writes to
`CourtRequestsRepository`, and the new routes to `CourtRequestsController`.

### Contracts & tables

- Reuse: `confirmCourtRequestSchema` (`{ requestId, courtId, decidedBy }`), `courtRequestSchema`,
  `courtRequestStatus`, `courtSchema`, `courtDurationHours`, primitives in `common.ts`.
- Reuse helpers: `freeCourtsByHour`, `courtHoursCovered`, `freeForDuration` (already exported from the
  service), `courtPriceRsd`.
- **Add (types only, no DB field):**
  - `courtRequestAdminViewSchema` — a pending-queue row the admin can read: the full
    `courtRequestSchema` fields plus `clientName: z.string()`, `clientTelegramId: z.number().int()`,
    and `endTime: timeString` (derived). Name/telegram come from a join on `clients`; no schema change.
  - `rejectCourtRequestSchema` — `{ requestId: uuid, decidedBy: z.number().int() }`.
  - `courtRequestQueueQuerySchema` — `{ status: courtRequestStatus.default("pending") }` for the queue
    filter.
  - Export all from `packages/types/src/court-contracts.ts` (already re-exported via `index.ts`).
- Tables: reads `court_requests`, `courts`, `court_blocks`, `clients` (for name/telegram on notify);
  writes `court_requests` only. **No DB schema change.** All needed columns exist (`court_id`,
  `status`, `decided_at`, `decided_by`).

### API (`apps/api/src/modules/court-requests/`, admin)

Identity convention matches `courts`/`court-blocks`: numeric Telegram id in the `x-telegram-id`
header, parsed at the controller, authorized in the service via `isAdmin(env, telegramId)` (inject
`ENV` like `CourtBlocksService`). All four endpoints are admin-only.

- `GET /court-requests?status=pending` → `CourtRequestAdminView[]`. The pending moderation queue
  (joined with client name/telegram). Admin-gated.
- `GET /court-requests/:id/free-courts` → `Court[]`. Active courts that are free for **every** hour the
  request covers (re-using `freeCourtsByHour` + per-court occupancy from confirmed requests and
  blocks). Never exposed to clients. Admin-gated.
- `POST /court-requests/:id/confirm` → body `confirmCourtRequestSchema` (`{ requestId, courtId,
  decidedBy }`; `:id` must equal `requestId`). In **one transaction**: load the `pending` request
  (FOR UPDATE), re-check the per-hour limit and that the chosen `courtId` is active and free for every
  covered hour (no confirmed request and no block on that court/hour), then set `status=confirmed`,
  `court_id=courtId`, `decided_at=now()`, `decided_by=decidedBy`. After commit, notify the client with
  the assigned court number and total RSD. Admin-gated. Returns the updated `CourtRequest`.
- `POST /court-requests/:id/reject` → body `rejectCourtRequestSchema`. Set `status=rejected`,
  `decided_at=now()`, `decided_by`. After commit, notify the client with the "choose another time"
  message. Admin-gated. Returns the updated `CourtRequest`.

Both confirm and reject reject a request that is not currently `pending` (`ConflictException`) so a
double-decision can't flip a settled request.

### Outbound notification

Per CLAUDE.md, outbound Telegram sends use the bot token directly from the API. Add a small injectable
`CourtNotifier` (in the court-requests module) that wraps a Telegram `sendMessage` call using
`TELEGRAM_BOT_TOKEN` from `ENV`. The service calls it **after** the DB transaction commits, so a send
failure never rolls back a confirmed assignment (log a warning on failure). Messages:
- Confirm: `Корт №{number}, {date} {startTime}–{endTime}, итог: {priceRsd} RSD`.
- Reject: `К сожалению, нет свободных мест на это время — выберите, пожалуйста, другое время.`

### Bot flow (admin, gated by `ADMIN_TELEGRAM_IDS`)

The admin moderation surface is the bot (the web `apps/admin` console auth is a separate follow-up).
A new admin handler set (namespaced callback constants, IDs only in payloads):
- `court_mod:queue` — lists pending requests (date/time/duration/price/client name), each with
  `[Подтвердить]` (`court_mod:pick:<requestId>`) and `[Отклонить]` (`court_mod:reject:<requestId>`).
- `court_mod:pick:<requestId>` — calls `GET /:id/free-courts`, renders one button per free court
  `[Корт №X]` (`court_mod:assign:<requestId>:<courtId>`).
- `court_mod:assign:<requestId>:<courtId>` — calls confirm; shows admin "Подтверждено".
- `court_mod:reject:<requestId>` — calls reject; shows admin "Отклонено".
Every entry first checks the caller is in `ADMIN_TELEGRAM_IDS` (via the API; non-admins get nothing).

`apps/bot/src/api-client.ts` additions (all send `x-telegram-id` admin header, validate responses):
`listPendingCourtRequests(adminId)`, `freeCourtsForRequest(adminId, requestId)`,
`confirmCourtRequest(adminId, requestId, courtId)`, `rejectCourtRequest(adminId, requestId)`.

### Invariants

- **Admin-only** every read/write (queue, free-courts, confirm, reject), enforced in the service by
  `isAdmin`, never in the bot.
- **Court assignment is manual** — the admin picks the court; the service never auto-assigns.
- **The per-hour limit and chosen-court freeness are re-checked atomically inside the confirm
  transaction** so the read (free-courts) and the write can't diverge; never confirm more than the
  number of active courts for any overlapping hour, and never two confirmations onto the same court/hour
  or onto a blocked court/hour.
- **The client only learns the court number on confirmation** — it is never returned by free-courts to
  a client path and never sent before confirm.

### Acceptance criteria

- Confirming assigns the chosen court, flips the request to `confirmed`, stamps `decided_*`, and
  notifies the client with that court number and total RSD.
- Rejecting flips to `rejected`, stamps `decided_*`, and notifies the client with the "choose another
  time" message.
- Confirming onto a court already taken (confirmed request or block) for any covered hour, exceeding the
  per-hour limit, or onto an inactive court is rejected (`ConflictException`/`BadRequestException`).
- A non-admin caller on any C4 endpoint is rejected (`ForbiddenException`); a client never receives a
  court number before confirmation.
- Confirming/rejecting a non-`pending` request is rejected.

### Tests

- Service: confirm assigns court + flips status + stamps decided_* + calls notifier; double-assign onto
  an occupied court/hour rejected; over-limit (all active courts taken that hour) rejected; confirm onto
  a blocked court/hour rejected; reject flips status + notifies; admin gate on all four methods;
  non-pending request rejected on confirm and reject.
- Contracts: `rejectCourtRequestSchema`, `courtRequestAdminViewSchema`,
  `courtRequestQueueQuerySchema` accept valid / reject unknown fields.
- Bot: admin keyboard renders one button per free court and never a court number for non-confirmed
  requests; non-admin sees nothing.

### Dependencies

C2, C3 (both present in this worktree). Notification send pattern anticipates T2.2; since no
`notifications` module/sender exists yet, this slice adds a minimal in-module `CourtNotifier` rather
than blocking on T2.2.

### Open questions

- **Log court notifications to the `notifications` table?** The `notification_type` enum has no
  court value. **Default: do not log** in this slice (out of scope; would need an enum + migration).
  Revisit when T2.2 lands a shared notifications module; the `CourtNotifier` is the seam to fold in.
- **Where does moderation live — bot or web console?** **Default: bot**, gated by
  `ADMIN_TELEGRAM_IDS` (the web console's admin auth is an unbuilt follow-up). The API endpoints are
  surface-agnostic, so the web console can reuse them later.

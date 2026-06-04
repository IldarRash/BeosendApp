# Advanced web admin console (`apps/admin`)

**Status.** Implemented on `feature/admin-console` (M0–M4), pending live end-to-end verification.
All five milestones below are built and pass the full static gate (`pnpm typecheck && lint && test &&
build`, 476 tests). What remains is exercising the flows against a running API + Postgres + a real
Telegram-widget admin login — see **Delivery status** at the end. Each milestone was implemented as a
separate multi-agent workflow (`admin-console-m0`…`m4`).

**Goal.** Give the manager a web counterpart to the Telegram manager menu (A1) that is faster for
data-dense work: tables, dashboards, multi-field forms, and an at-a-glance court load grid. It must
cover all admin domains — schedule & reference data, operations (rosters/attendance), the court
domain (moderation, blocks, load grid), and reach/insight (broadcasts, analytics).

**Non-goal.** No new domain behaviour. The bot manager menu (A1) and all bot client journeys keep
working unchanged; the console is a parallel interaction layer over the same API.

**Spec refs.** ТЗ §14, §15, §17; Edition 2 admin. Supersedes the "web admin is a follow-up" note in
the former `admin-manager-console` brief and the bot text-grid view in the former `court-load-grid`
brief (the web grid replaces it).

## Guardrails (non-negotiable — see `.claude/rules/frontend.md`)

- **Interaction layer only.** No domain logic in the browser: no money, availability, capacity, or
  status math. The console renders values the API already decided. Prices are RSD whole dinars via the
  shared `formatRsd` (`apps/admin/src/lib/format.ts`); availability/capacity/status come from the API.
- **Validate everything rendered** against a `packages/types` contract inside the `ApiClient`
  (`apps/admin/src/api/client.ts`) before use. Reuse contracts/helpers; never redeclare a schema.
- **Config via `import.meta.env` (`VITE_*`) only.** Never import `@beosand/config` (server secrets).
  The only shared app dependency stays `@beosand/types`.
- **Admin-only, enforced server-side.** Authorization lives in the API; the browser never asserts its
  own role. Never render a court number for a pending request; never show data the API wouldn't return.
- **UI strings Russian** (Serbian where the bot already uses it). Accessibility (semantics, focus,
  contrast, `aria-*`, keyboard) is part of done.

## Smallest correct slice

A thin vertical slice that runs end-to-end: **M0** (auth seam + router + data layer + one real screen
wired through login) before any domain breadth. Each later milestone is one more route reusing an
existing endpoint — no milestone introduces domain logic.

## Auth seam (Telegram Login Widget) — prerequisite for M0

Today admin endpoints trust a raw `x-telegram-id` header. That is safe from the bot (the bot owns the
id) but **must not** be trusted from a browser. Replace it for web callers with a verified session.

**API — new `auth` module in `apps/api`** (controller → service → no new tables):

- `POST /auth/telegram` — body is the Telegram Login Widget payload
  (`id, first_name, username?, photo_url?, auth_date, hash`). The service:
  1. Builds the data-check-string (sorted `key=value` lines, excluding `hash`).
  2. Computes `HMAC-SHA256(dataCheckString, key = SHA256(TELEGRAM_BOT_TOKEN))` and compares to `hash`.
  3. Rejects a stale `auth_date` (e.g. older than 24h) → `UnauthorizedException`.
  4. Confirms `id ∈ ADMIN_TELEGRAM_IDS` (reuse the existing admin check) → else `ForbiddenException`.
  5. Issues a short-lived signed **session JWT** (default: HS256, ~12h, claim `sub = telegram_id`)
     returned to the client. *(Default chosen: JWT in an Authorization header — simplest to wire from
     a Vite SPA and to validate in a Nest guard; revisit httpOnly cookie if CSRF surface grows.)*
- `GET /auth/me` — validate the session, return the admin identity (id, display name) for the app to
  show "logged in as".
- **`AdminAuthGuard`** (Nest guard): validates the `Authorization: Bearer <jwt>`, resolves
  `telegram_id`, attaches it to the request. Admin controllers adopt the guard instead of re-parsing
  `x-telegram-id`; services keep their existing `isAdmin`/`assertAdmin` checks (defence in depth). The
  bot continues to call with `x-telegram-id` (still valid for trusted server-to-server callers).
- **Env:** add a session secret (e.g. `ADMIN_SESSION_SECRET`) to the `packages/config` Zod contract
  (fail-closed); `TELEGRAM_BOT_TOKEN` and `ADMIN_TELEGRAM_IDS` already exist. Never log tokens/secrets.

**Admin app:**

- A **login screen** mounting the Telegram Login Widget (bot username via `VITE_TELEGRAM_BOT_USERNAME`);
  on `onauth`, `POST /auth/telegram`, store the returned JWT (in-memory + `sessionStorage`), then route
  to the dashboard.
- The `ApiClient` sends `Authorization: Bearer <jwt>` on every admin call (replacing the interim
  `x-telegram-id` header on the court-block methods). A **401 → redirect to login**; logout clears it.
- A **route guard** wraps all domain routes; unauthenticated access redirects to `/login`.

**Legacy to remove when M0 lands:** the `telegramId`-as-header arguments on the court-block methods in
`apps/admin/src/api/client.ts` — replaced by the session. Call this out in the implementation summary.

## M0 — Console foundation

- **Routing:** add `react-router-dom`; one route per domain (`/`, `/groups`, `/trainings`,
  `/trainers`, `/levels`, `/courts`, `/court-requests`, `/broadcasts`, `/analytics`, `/login`). Wire
  `AppShell` nav (`apps/admin/src/ui/AppShell.tsx`) to the router and flip `скоро` items live per
  milestone.
- **Server state:** add `@tanstack/react-query` for fetch/cache/refetch/mutation; one query/mutation
  hook per `ApiClient` method.
- **`ApiClient` expansion:** one typed method per admin endpoint below, each validating the response
  against the matching `@beosand/types` contract (existing `request<T>(path, schema, init)` pattern).
- **Design-system growth (on `theme.css` tokens):** `DataTable`, `Modal`/`Drawer`, `Button`,
  form fields (text/number/select/time/day-picker), `DatePicker`, `Toast`, plus shared
  loading/empty/error states. Keep the warm sand/coral, serif-display + mono-figures language; not
  generic AI aesthetics. Build via the `ui-designer` + `frontend-design` skill.
- **First wired screen:** the existing dashboard, now behind login, with its `StatCard`s populated
  from `GET /analytics/summary`.

## M1 — Schedule & reference data

Reuses: `levels` (GET/POST/PATCH), `trainers` (GET/POST/PATCH incl. `telegramId` linking),
`groups` (GET/POST/PATCH), `trainings` (`POST /generate`, `GET /trainings?from&to&groupId`,
`POST /:id/cancel`, `PATCH /:id/capacity`).

- **Groups:** table + create/edit form (name, days-of-week, start/end time, capacity, trainer, prices
  single/month RSD, status). Server validates time order — render its error.
- **Month generation:** trigger for a group/month; surface idempotency feedback (generated vs skipped).
- **Trainers:** CRUD; assign `telegramId` (gates the trainer's bot UI). **Levels:** CRUD (rename,
  deactivate).
- **Trainings:** list by date range (+ group filter) with status `open/full/cancelled` and
  booked/capacity. **Cancel** training behind a confirm dialog, surfacing the client-notification
  result. **Change capacity** — the server rejects below `booked_count`; render that error, never
  compute the floor locally.
- *Unsafe path:* a capacity lowered below booked must be refused by the API and shown as an error,
  not silently clamped client-side.

## M2 — Operations (rosters & attendance)

Reuses: `GET /trainings/:id/roster`, `POST /bookings/:id/attendance`,
`GET /clients/by-telegram/:id`, `POST /clients/onboard`.

- **Roster** per training (booked clients, excluding cancelled/waitlist).
- **Attendance** marking (`attended`/`no_show`) — respects the trainer/admin gate (API enforces it).
- **Client lookup / onboard** on behalf of a walk-in (with optional level).
- *Unsafe path:* render headcounts/capacity straight from the API; never reconstruct capacity in the
  browser. A non-admin/non-owning caller is rejected server-side.

## M3 — Courts

Reuses: `GET /court-requests?status=`, `GET /court-requests/:id/free-courts`,
`POST /court-requests/:id/confirm`, `POST /court-requests/:id/reject`, court-blocks CRUD
(`/court-blocks` POST/GET/DELETE), `GET /courts`, `GET /courts/load?date=`.

- **Moderation queue:** tabs `pending/confirmed/rejected/cancelled` with client name/telegram (as the
  API joins them). For a pending request, open the **free-courts** picker → **confirm** (assign a
  court) or **reject**; both notify the client server-side.
- **Manual court blocks:** create (court, date, start/end, reason) / list / delete.
- **Load grid:** courts × working-hours (08:00–21:00) cells `free/request/block` from
  `GET /courts/load?date=` — the web grid **supersedes** the never-built bot text-grid.
- *Unsafe path:* **never render a court number for a pending request**; the 6-per-hour confirmation
  limit and the per-hour court-free check are the server's to enforce — the UI only displays the
  courts the API returns as free and surfaces a `409`/conflict if the slot filled meanwhile.

## M4 — Reach & insight

Reuses: `GET /broadcasts/preview`, `POST /broadcasts/send`, and all `/analytics/*`.

- **Broadcast composer:** type (`today/tomorrow/week/freed-up`) + audience
  (`all` / `level:<id>` / `active:<days>` / `lapsed:<days>`). Always **preview the recipient count and
  composed message before send**; send persists one broadcast row server-side (per-recipient failures
  tolerated by the API).
- **Analytics dashboard:** the seven reports + `summary`, with a date-range filter; tables/figures use
  `formatRsd` and mono numerals. Read-only.
- *Unsafe path:* recipient counts and effectiveness numbers come only from the API; the browser does
  no segmentation or attribution math.

## Acceptance criteria

- A non-admin Telegram account cannot obtain a session (`/auth/telegram` → 403); an admin can log in,
  and every domain route is unreachable without a valid session (redirects to `/login`).
- Each milestone's screens perform their reads/writes against the live API and reflect changes
  immediately (e.g. cancel a training in the console → it disappears from client-facing availability;
  change capacity → status flips; confirm a court request → client notified, queue updates).
- No court number is ever shown for a pending request; the load grid matches confirmed requests +
  blocks for the date.
- "Done" means the flow works in the **running `apps/admin` against the API** (per
  `.claude/rules/agent-workflow.md` §6), not "compiles".

## Tests

- `ApiClient`: response **validation incl. the unsafe path** — a malformed/extra-field API response is
  rejected by the contract (extend `apps/admin/src/api/client.spec.ts`).
- Auth: widget-payload → session flow; **401 redirect** and route-guard logic; logout clears session.
- API `auth` service: hash verification accepts a correctly signed payload and rejects a tampered hash,
  a stale `auth_date`, and a non-admin id.
- Keep `pnpm --filter @beosand/admin typecheck lint test build` green; back-end auth covered by
  `@beosand/api` tests.

## Invariants reaffirmed

No domain/money/availability/capacity/status math in the browser · RSD whole dinars via the shared
formatter · admin gating enforced server-side (session + service checks) · no court number for pending
requests · never leak other users' data · secrets only from the environment via `packages/config`.

## Dependencies & open defaults

- New deps in `apps/admin` only: `react-router-dom`, `@tanstack/react-query`. New back-end work: the
  `auth` module + `AdminAuthGuard` + the `ADMIN_SESSION_SECRET` config entry.
- **Default chosen:** session = HS256 JWT in an `Authorization` header (revisit httpOnly cookie if
  CSRF surface grows); session lifetime ~12h; `auth_date` freshness window 24h.
- Sequencing: **M0 (auth + foundation) is a hard prerequisite**; M1–M4 are contracts-first against the
  already-shipped endpoints and can proceed in parallel once M0 lands.

## Delivery phases

- **M0 ✅** — auth seam: `apps/api/src/modules/auth` (`POST /auth/telegram` widget-HMAC verify + 24h
  freshness + admin gate, `GET /auth/me`, `node:crypto` HS256 session — no new deps, `AdminAuthGuard`);
  `apps/admin` router + react-query, session-aware `ApiClient` (legacy court-block `x-telegram-id`
  headers removed), Telegram-widget login + `RequireAuth`, dashboard from `/analytics/summary`, design
  primitives (Button/DataTable/Modal/Field/Toast).
- **M1 ✅** — global `SessionBridgeMiddleware` (verified session → `x-telegram-id`; bot raw-id path
  intact) + screens: Groups, Trainers, Levels, Trainings (list/generate/cancel/capacity).
- **M2 ✅** — operations: Attendance (per-training roster + attended/no_show) and Clients
  (lookup-by-telegram with `404→null`, onboard).
- **M3 ✅** — courts: moderation queue (free-courts confirm/reject, no court number for pending),
  manual blocks CRUD, per-day load grid (supersedes the bot text-grid).
- **M4 ✅** — reach & insight: broadcast composer (type + audience union, preview-before-send) and
  analytics dashboard (seven reports + summary, date-range filter).

## Delivery status

- **Static gate green:** `pnpm typecheck` (9 tasks), `pnpm lint` (6 pkgs, `--max-warnings=0`),
  `pnpm test` (476: 388 API + 88 admin), `pnpm build` (6 pkgs incl. the admin SPA).
- **Security:** M0 auth reviewed — no ship-blockers. Residual gap (raw `x-telegram-id` accepted from
  any origin — the bot's server-to-server path) is pre-existing and documented in `admin-auth.guard.ts`.
- **Not yet verified (live):** Telegram-widget login needs a bot domain in BotFather +
  `VITE_TELEGRAM_BOT_USERNAME`; end-to-end needs the running API + Postgres
  (`pnpm db:up && db:migrate && db:seed`, `pnpm dev`) and `ADMIN_SESSION_SECRET`. **`POST
  /broadcasts/send` dispatches real Telegram messages** — exercise with seed data; the preview is a
  safe dry-run.
- **Known follow-ups (out of scope):** list endpoints are active-only (inactive groups/levels/trainers
  aren't listable — needs an admin "list all"); the moderation view resolves a confirmed request's
  court *number* client-side from `/courts` (a `courtNumber` field on the admin view would remove that);
  fully rejecting browser-origin raw `x-telegram-id` (origin allowlist) is the next auth hardening.

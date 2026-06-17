# Feature: External Connectors (v1)

Status: planned (design only — no production code yet)
Branch suggestion: `feature/connectors`
Owner-chosen scope: FULL integration depth (real provider adapters), config-gated. When a provider's
creds are absent the connector is **disabled and logged once**, and the rest of the app runs
unchanged. NOT payments.

## 1. Goal

Add three "external connectors" to BeoSand so domain state can reach the outside world beyond the
existing Telegram sends:

1. **Calendar export** — trainings as a subscribable calendar (signed-token iCal `.ics` feed;
   optional Google Calendar push behind Google creds).
2. **Email / SMS notifications** — a channel abstraction so existing domain notifications can also go
   out by email (SMTP/SendGrid) and SMS (Twilio), especially for walk-in clients who have a phone but
   no Telegram.
3. **Outbound webhooks + Google Sheets export** — HMAC-signed JSON POSTs to admin-configured URLs on
   domain events, with a delivery log + retry; plus append-to-Google-Sheet export with a CSV-export
   endpoint as the account-light fallback.

Hard constraints (CLAUDE.md invariants honored): the bot never gains domain logic; all decisions stay
in `apps/api` services; secrets stay in `packages/config` (fail-closed) and are never logged; admin
writes are admin-only; money stays RSD computed server-side; connectors are **best-effort and never
roll back a committed booking/court decision**.

## 2. Spec / architecture refs (read before implementing)

- Existing send abstraction to extend: `apps/api/src/modules/notifications/notifications.service.ts`,
  `notifications.repository.ts`, `telegram-sender.ts`, `notifications.scheduler.ts`,
  `notifications.module.ts`; the `notifications` send-log table in `packages/db/src/schema.ts`.
- In-module ad-hoc sender to fold in / keep parallel: `apps/api/src/modules/court-requests/court-notifier.ts`.
- Env contract: `packages/config/src/env.ts` (`loadEnv`, fail-closed Zod). Note the existing
  `setDbAdminIds` / `isAdmin` pattern (do NOT touch).
- DB rules: `.claude/rules/drizzle-migrations.md`; schema at `packages/db/src/schema.ts`.
- Contracts: `packages/types/src/*` (split request vs entity, reuse `common.ts` primitives,
  re-export from `index.ts`).
- Layering: `.claude/rules/nestjs-layering.md`. Domain-event hook points already exist and call the
  notifier directly post-commit:
  - booking confirm: `apps/api/src/modules/bookings/bookings.service.ts` (lines ~116, 180, 726, 813)
  - booking declined: same file ~773, 865
  - training cancel/delete fan-out: `apps/api/src/modules/trainings/trainings.service.ts`
    `deleteTraining` (~573) → `sendTrainingCancelled` (~791)
  - court request decision: `apps/api/src/modules/court-requests/court-requests.service.ts`
    `confirmRequest` (~237) / reject (~293) → `notifyDecision` (~323)
- Admin console pattern: `apps/admin/src/api/client.ts`, `apps/admin/src/hooks/useManagers.ts`,
  `apps/admin/src/pages/Managers.tsx` (CRUD page reference); controller auth pattern at
  `apps/api/src/modules/managers/managers.controller.ts` (`x-telegram-id` header → `assertAdmin`).
- App module registration: `apps/api/src/app.module.ts`.
- Security: `.claude/rules/security.md`.

## 3. Architecture: the shared connector layer

A new domain module **`connectors`** (`apps/api/src/modules/connectors/`) owns all third-party
integrations. Domain services do **not** call provider SDKs; they emit domain events, and the
connector layer consumes them. This avoids scattering provider calls across `bookings` / `trainings`
/ `court-requests`.

### 3.1 Event bus seam

Use NestJS event emitter (`@nestjs/event-emitter`, `EventEmitter2`, added once in `AppModule` via
`EventEmitterModule.forRoot()`). Domain services emit **typed domain events** post-commit (alongside,
not replacing, the existing direct notification calls in v1 — see §11 sequencing); connector listeners
subscribe.

- `DomainEventsService` (in `connectors` module, but injected into domain modules) exposes
  `emitBookingCreated`, `emitBookingDeclined`, `emitTrainingCancelled`, `emitCourtRequestConfirmed`,
  `emitCourtRequestRejected`. Each builds a typed payload (a `packages/types` contract) and calls
  `eventEmitter.emit("booking.created", payload)` etc. Emission is fire-and-forget and wrapped so an
  emit failure never propagates into the committed flow (same tolerance contract as the existing
  notifier).
- Event names (constants, not raw strings): `connector-events.ts` →
  `DOMAIN_EVENT.BOOKING_CREATED`, `BOOKING_DECLINED`, `TRAINING_CANCELLED`, `COURT_REQUEST_CONFIRMED`,
  `COURT_REQUEST_REJECTED`.

### 3.2 Ports / interfaces

```
// connectors/ports/channel.port.ts
interface NotificationChannel {
  readonly id: "telegram" | "email" | "sms";
  isEnabled(): boolean;                      // config-gated
  send(msg: OutboundMessage): Promise<void>; // throws on failure; dispatcher tolerates
}

// connectors/ports/connector.port.ts  (for webhooks / sheets / calendar-push)
interface OutboundConnector {
  readonly id: string;
  isEnabled(): boolean;
}
```

`OutboundMessage` = `{ clientId; channel-target (telegramId|email|phone); subject?; text; eventType }`.

### 3.3 Components and where each connector plugs in

- **`ChannelDispatcher`** (`connectors/channels/channel-dispatcher.service.ts`) — registry of
  `NotificationChannel` adapters. Given a recipient + message, it fans out to every **enabled** channel
  the recipient can receive on (telegram if `telegramId`, email if `email`, sms if `phone`), logging
  each attempt to the connector delivery log. The existing `NotificationsService` is **refactored to
  call the dispatcher** instead of `TelegramSender` directly; `TelegramSender` becomes the
  `TelegramChannel` adapter (`channel.id === "telegram"`). `CourtNotifier` is removed and replaced by
  a dispatcher call from `court-requests` (clean up the superseded path per CLAUDE.md).
  - Adapters: `TelegramChannel` (wraps existing sender), `EmailChannel` (nodemailer SMTP **or**
    SendGrid — default SMTP, see §10), `SmsChannel` (Twilio).
- **`WebhookDispatcher`** (`connectors/webhooks/webhook-dispatcher.service.ts`) — a domain-event
  listener. On each fired event it loads active `webhook_endpoints`, builds the JSON payload, signs it
  (HMAC-SHA256 over the raw body using the endpoint secret), POSTs, and writes a `webhook_deliveries`
  row. A `WebhookRetryScheduler` (`@nestjs/schedule`, every 1 min) re-POSTs failed deliveries with
  capped exponential backoff.
- **`CalendarFeedService`** (`connectors/calendar/calendar-feed.service.ts`) — builds `.ics` text from
  a trainer's or client's upcoming trainings (account-light signed-token feed). Optional
  `GoogleCalendarPush` (behind Google creds) mirrors the same events into a Google Calendar; it is a
  domain-event listener like the webhook dispatcher.
- **`SheetsExportService`** (`connectors/sheets/sheets-export.service.ts`) — appends clients/bookings
  rows to a configured Google Sheet (service account); `CsvExportService` is the always-on fallback
  that streams CSV from the same query.
- **`ConnectorRegistry`** (`connectors/connector-registry.service.ts`) — collects every channel +
  connector, exposes `status()` (each connector's `id`, `enabled`, `configured`) for the admin
  settings screen and the `test-send`.

### 3.4 Config-gated enablement (fail-open at runtime, fail-closed on bad config)

Each adapter's `isEnabled()` checks that its required env vars are present. All connector env vars are
**optional** in the Zod contract (so a missing provider is a normal "disabled" state, not a boot
failure), but **if present they must be well-formed** (e.g. a malformed SMTP URL still fails closed at
startup). On boot, `ConnectorRegistry` logs one line per connector: `enabled` or
`disabled (missing X)`. A disabled channel/connector is skipped silently at dispatch time (logged at
debug).

## 4. Config additions (`packages/config/src/env.ts`)

All optional; presence enables the connector. Never logged. Add to `envSchema`:

```
// --- Calendar ---
CALENDAR_FEED_SECRET: z.string().min(16).optional(),   // HMAC key for signed .ics feed tokens
PUBLIC_BASE_URL:      z.string().url().optional(),     // absolute base for feed URLs shown to users
GOOGLE_CALENDAR_ID:        z.string().optional(),
GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),    // raw JSON or base64; shared with Sheets

// --- Email ---
EMAIL_PROVIDER: z.enum(["smtp", "sendgrid"]).optional(), // absent => email disabled
EMAIL_FROM:     z.string().email().optional(),
SMTP_URL:       z.string().url().optional(),             // smtp(s)://user:pass@host:port
SENDGRID_API_KEY: z.string().optional(),

// --- SMS (Twilio) ---
TWILIO_ACCOUNT_SID: z.string().optional(),
TWILIO_AUTH_TOKEN:  z.string().optional(),
TWILIO_FROM_NUMBER: z.string().optional(),

// --- Webhooks / Sheets ---
WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
GOOGLE_SHEETS_ID:     z.string().optional(),
// (Google service account reused from GOOGLE_SERVICE_ACCOUNT_JSON)
```

Cross-field rule (add a `.superRefine` on the schema): if `EMAIL_PROVIDER === "smtp"` then `SMTP_URL`
+ `EMAIL_FROM` required; if `"sendgrid"` then `SENDGRID_API_KEY` + `EMAIL_FROM` required. This keeps a
half-configured email channel from booting. Webhook signing secret is **per-endpoint** (DB column), not
env. Update `packages/config/src/env.spec.ts` for the new cross-field cases.

## 5. DB schema + migrations (`packages/db/src/schema.ts`)

One migration via `pnpm --filter @beosand/db db:generate`, committed with the schema change.

### 5.1 `clients.email` (new column)

```
email: text("email"),   // nullable; walk-ins may have email, phone, both, or neither
```

No unique constraint (a family can share an email). Mirror in `client-contracts.ts`.

### 5.2 `webhook_endpoints` (new table)

```
id          uuid pk default random
url         text not null
secret      text not null         // per-endpoint HMAC key (generated server-side; never returned in list payloads)
events      text[] not null       // subscribed event keys (subset of the domain-event enum)
status      entity_status not null default 'active'
createdAt   timestamptz not null default now
createdBy   bigint                // acting admin telegram id (mirrors courtRequests.decidedBy)
```

### 5.3 `webhook_deliveries` (new table)

```
id          uuid pk default random
endpointId  uuid not null references webhook_endpoints(id) on delete cascade
eventType   text not null
payload     text not null         // the exact signed JSON body (for replay/inspection)
status      webhook_delivery_status not null default 'pending'  // new pgEnum: pending|delivered|failed
attempts    integer not null default 0
lastError   text
responseStatus integer
nextAttemptAt timestamptz         // retry scheduling; null when delivered/exhausted
createdAt   timestamptz not null default now
deliveredAt timestamptz
```

`on delete cascade` on `endpointId`: deleting an endpoint discards its delivery history (acceptable;
the log is operational, not domain truth). New `webhookDeliveryStatus` pgEnum.

### 5.4 Calendar tokens — **stateless signed tokens (chosen)**

No new table. A feed URL carries a token `base64url(payload).base64url(hmac)` where
`payload = { sub: "trainer"|"client", id: <uuid>, v: <int> }` and `hmac = HMAC-SHA256(payload,
CALENDAR_FEED_SECRET)`. **Revocation** is by bumping a per-subject version: store an integer
`calendarFeedVersion` on `clients` and `trainers` (default 1); a valid token must match the current
version. "Revoke / rotate my feed" = increment the version (old URLs 401). This is account-light, needs
no token table, and is still revocable — justified over a `calendar_tokens` table because the only
state needed is a single rotating counter per subject.

```
// add to clients and trainers:
calendarFeedVersion: integer("calendar_feed_version").notNull().default(1)
```

## 6. `packages/types` contracts (new files, re-exported from `index.ts`)

Reuse `common.ts` (`uuid`, `entityStatus`, `dateString`, `timeString`). Split request vs entity.

- `connector-contracts.ts`:
  - `connectorId = z.enum(["telegram","email","sms","calendar-ics","google-calendar","webhooks","google-sheets","csv-export"])`
  - `connectorStatusSchema` = `{ id: connectorId, enabled: boolean, configured: boolean }`
  - `connectorStatusListSchema = z.array(connectorStatusSchema)`
  - `testSendSchema` (admin test-send) = `{ channel: z.enum(["email","sms","telegram"]); to: string }`
  - `domainEventType = z.enum(["booking.created","booking.declined","training.cancelled","court-request.confirmed","court-request.rejected"])`
  - Event payload schemas (the webhook JSON + the in-process event bus payload), e.g.
    `bookingCreatedEventSchema`, `courtRequestConfirmedEventSchema`, each `{ event: domainEventType,
    occurredAt: z.string().datetime(), data: {...ids + display fields, RSD where relevant} }`. A
    discriminated union `domainEventSchema` over `event`. **Never** include court numbers for a
    *pending* request payload; confirmed payloads may include the assigned court.
- `webhook-contracts.ts`:
  - `webhookEndpointSchema` (entity; **omits `secret`** — never returned to the client)
  - `createWebhookEndpointSchema` = `{ url: z.string().url(); events: z.array(domainEventType).min(1) }`
  - `updateWebhookEndpointSchema` = partial of `{ events, status }`
  - `webhookDeliverySchema` (entity for the delivery-log view; `payload` included, `secret` never)
- `calendar-contracts.ts`:
  - `calendarFeedLinkSchema` = `{ subject: z.enum(["trainer","client"]); url: z.string().url() }`
    (the admin/bot UI requests "give me my feed URL").

`client-contracts.ts`: add `email: z.string().email().nullable()` to the client entity + the
create/update walk-in schemas.

## 7. API endpoints (`apps/api/src/modules/connectors/connectors.controller.ts` + sub-controllers)

Auth model:
- **Feeds: public but signed.** No admin header; the signed token IS the auth. Validate token +
  version; 401 on mismatch. Served as `text/calendar; charset=utf-8`.
- **Everything else: admin-only** via the existing `x-telegram-id` header → `assertAdmin` pattern
  (see `managers.controller.ts`).

Endpoints:
- `GET /connectors/calendar/:subject/:id.ics?token=...` — public signed iCal feed (subject ∈
  trainer|client). Returns upcoming trainings as VEVENTs.
- `GET /connectors/calendar/link?subject=trainer|client&id=...` — admin-only: returns the signed feed
  URL to display (built from `PUBLIC_BASE_URL`). (Bot/Mini App get the link via the same service for a
  client's own feed; that path resolves `id` from the caller's own client record — never an arbitrary
  id.)
- `POST /connectors/calendar/:subject/:id/rotate` — admin (or self): bump `calendarFeedVersion`
  (revoke old URLs).
- `GET /connectors` — admin: connector status list (for the settings screen).
- `POST /connectors/test-send` — admin: send a test email/sms/telegram to a given address.
- `GET/POST/PATCH /connectors/webhooks` + `/webhooks/:id` — admin CRUD for endpoints (POST returns the
  generated `secret` **once**; list/get never return it).
- `GET /connectors/webhooks/:id/deliveries` — admin: delivery log for one endpoint.
- `POST /connectors/webhooks/deliveries/:id/retry` — admin: force a retry.
- `GET /connectors/export/clients.csv` and `GET /connectors/export/bookings.csv` — admin: CSV export
  (always available, the Sheets fallback).
- `POST /connectors/sheets/sync` — admin: trigger a Sheets append (no-op + 409/clear message when
  Google creds absent).

## 8. Admin surface (`apps/admin`)

New page **Connectors** (route + nav entry in `routes.ts` / `AppShell.tsx`). Follows the
Managers/NotificationTemplates pattern (page + hook + `ApiClient` methods, every rendered value
validated against a `packages/types` contract).

- **Status panel** — list connectors with enabled/configured badges (from `GET /connectors`);
  per-channel **Test send** form (email/sms/telegram + target).
- **Webhook endpoints** — table (url, events, status) with create/edit/disable; on create, show the
  generated signing secret once with a copy button + warning it won't be shown again.
- **Delivery log** — per-endpoint deliveries table (event, status, attempts, last error, response
  status) with a **Retry** action.
- **Exports** — buttons to download `clients.csv` / `bookings.csv`; a "Sync to Google Sheet" button
  (disabled with a tooltip when Sheets is not configured).
- New hook `useConnectors.ts`, `useWebhooks.ts`; `ApiClient` methods added in `apps/admin/src/api/client.ts`
  with response validation. UI strings RU (SR where used); a11y per `.claude/rules/frontend.md`.

## 9. Dependencies to add

- `apps/api`: `@nestjs/event-emitter`, `eventemitter2`, `nodemailer` (+ `@types/nodemailer` dev),
  `@sendgrid/mail` (only if SendGrid kept — but default is SMTP, so SendGrid adapter can be a thin
  HTTP `fetch` call and `@sendgrid/mail` is optional), `twilio`, `googleapis` (Calendar + Sheets),
  `ical-generator` (clean typed VCALENDAR/VEVENT builder — preferred over `ics`). HMAC + CSV use Node
  built-ins (`node:crypto`, manual CSV join — no dep).
- `packages/types`, `packages/config`, `packages/db`: no new runtime deps (Zod / Drizzle already
  present).
- `apps/admin`: none beyond existing (`@tanstack/react-query`, `@beosand/types`).

Prefer thin `fetch`-based adapters for SendGrid/Twilio HTTP if avoiding heavy SDKs keeps the bundle
lean; `googleapis` and `nodemailer` are worth the real SDK. Decide per-adapter; keep adapters small
and individually testable.

## 10. Open questions — each with a chosen default

1. **Email provider default**: **SMTP via nodemailer** (works with any host's mailbox, no vendor
   lockup; `EMAIL_PROVIDER=sendgrid` switches to the HTTP adapter). Default chosen: **SMTP**.
2. **Google auth model**: **service account** (`GOOGLE_SERVICE_ACCOUNT_JSON`) for both Calendar push
   and Sheets — no per-user OAuth dance, fits a single-org school, one shared calendar/sheet. Default
   chosen: **service account** (OAuth deferred).
3. **Calendar token storage**: **stateless signed token + per-subject version counter** (no table).
   Default chosen as in §5.4.
4. **Which domain events fire webhooks in v1**: **`booking.created`, `booking.declined`,
   `training.cancelled`, `court-request.confirmed`, `court-request.rejected`**. (reminders, waitlist
   promotions, attendance marks deferred.)
5. **Channel fan-out policy**: domain notifications fan out to **all channels the recipient can
   receive on** (telegram + email + sms when present). Default: fan-out, not "primary only" — walk-ins
   (no telegram) still get reached. A per-event "channels" allow-list is a follow-up.
6. **Idempotency for non-telegram channels**: the existing `notifications` send-log is
   telegram-shaped (one row per client/training/type). v1 keeps that log authoritative for telegram and
   records email/sms attempts in the **connector delivery log** (§ a small `channel_deliveries` table
   OR reuse `webhook_deliveries`-style row). Default: a single generic delivery-log table per channel is
   over-engineering for v1 — **log email/sms attempts via the existing Nest Logger + a `notifications`
   row tagged by channel** is rejected (schema churn); instead **add a nullable `channel` column to
   `notifications`** (default `'telegram'`) so the existing anti-join idempotency still works and
   non-telegram sends are logged. (Implementer: confirm this is cleaner than a parallel table; flag if
   not.)
7. **CSV vs Sheets default-on**: CSV export is **always on** (no creds); Sheets is gated. Default: CSV
   always available.

## 11. Slice / sequencing plan

**Slice 0 — Foundation (SERIAL, do first, single implementer).** No parallelism until this lands.
- `connectors` module skeleton + `EventEmitterModule.forRoot()` in `AppModule`.
- Config additions (§4) + `env.spec.ts`.
- DB migration (§5: `clients.email`, `calendarFeedVersion` on clients+trainers, `webhook_endpoints`,
  `webhook_deliveries`, `notifications.channel`, new pgEnum) — generated + committed.
- All `packages/types` contracts (§6), re-exported.
- Ports/interfaces (`NotificationChannel`, `OutboundConnector`), `DomainEventsService` + event
  constants, `ConnectorRegistry` shell with `isEnabled()` wiring + boot log.
- Refactor `NotificationsService` to send via `ChannelDispatcher` with only the `TelegramChannel`
  adapter registered (behavior-preserving), and remove `CourtNotifier` in favor of a dispatcher call.
  **Gate must stay green here** before any connector slice starts.

**Slices A/B/C — the three connectors (PARALLEL after Slice 0).**
- **A. Calendar** — `CalendarFeedService` + iCal builder + public feed controller + signed-token
  helper + rotate endpoint; optional `GoogleCalendarPush` listener (gated).
- **B. Email/SMS** — `EmailChannel` + `SmsChannel` adapters registered in the dispatcher; recipient
  resolution extended to include `email`/`phone`; `test-send` endpoint.
- **C. Webhooks + Sheets** — `WebhookDispatcher` listener + HMAC signing + `webhook_deliveries` writes
  + `WebhookRetryScheduler`; webhook CRUD endpoints/service/repo; `SheetsExportService` +
  `CsvExportService` + export endpoints. **Depends on Slice 0's `DomainEventsService` emit points**;
  emit calls are added into `bookings`/`trainings`/`court-requests` services in Slice 0 so A/B/C only
  consume.

**Slice D — Admin UI + cross-cutting tests (after A/B/C contracts are stable).**
- Connectors page, hooks, `ApiClient` methods; render/validation tests; end-to-end verification.

**Cross-slice dependencies:** Slice 0 is a hard prerequisite for all. A/B/C are independent of each
other (different adapters, no shared mutable state beyond the registry). D depends on A/B/C endpoints.
The `notifications.channel` column (Slice 0) is what B relies on for idempotency — keep it in
foundation.

## 12. Tests to write

- **Channel dispatch fan-out** (`channel-dispatcher.spec.ts`): a recipient with telegram+email+phone
  → all three enabled adapters called; with only phone → only SMS; a disabled channel skipped; one
  adapter throwing does not stop the others and is logged (never the token/secret).
- **Per-adapter, mocked provider**: `EmailChannel` (mock nodemailer transport / SendGrid fetch),
  `SmsChannel` (mock Twilio), `TelegramChannel` (existing telegram-sender test stays green).
- **Config-absent → disabled**: each adapter's `isEnabled()` false when its env vars are missing;
  `ConnectorRegistry.status()` reports `configured:false`; dispatch is a no-op (not an error).
- **HMAC signing** (`webhook-signer.spec.ts`): signature is deterministic over the raw body; tamper →
  verify fails; secret never appears in any logged/returned value.
- **iCal output shape** (`calendar-feed.spec.ts`): VCALENDAR/VEVENT per upcoming training, correct
  DTSTART/DTEND in Europe/Belgrade, UID stable per training; empty feed still valid.
- **Calendar token** (`calendar-token.spec.ts`): valid token passes; wrong secret/version 401;
  rotate bumps version and invalidates the old token.
- **Webhook delivery + retry** (`webhook-dispatcher.spec.ts`): success writes `delivered`; failure
  writes `failed` + schedules `nextAttemptAt`; retry scheduler re-POSTs up to `WEBHOOK_MAX_ATTEMPTS`
  then gives up; only subscribed events fire an endpoint.
- **CSV export** (`csv-export.spec.ts`): correct header + escaped rows; RSD as whole dinars.
- **Domain-event emission**: booking confirm / training cancel / court confirm emit the right typed
  event (and the existing telegram notification still fires).
- **Config cross-field** (`env.spec.ts`): smtp without `SMTP_URL` fails closed; absent email block
  boots fine.
- **Contracts** (`*-contracts.spec.ts`): webhook CRUD, connector status, event payloads; secret is
  never present in `webhookEndpointSchema`.

## 13. Acceptance criteria

Per connector:
- **Calendar**: with `CALENDAR_FEED_SECRET` + `PUBLIC_BASE_URL` set, a client/trainer feed URL
  subscribed in Google/Apple Calendar shows their upcoming trainings; rotating the feed 401s the old
  URL. With Google service account set, the same events appear in the configured Google Calendar.
  Creds absent → feed endpoint still serves (token-signed) but Google push is disabled+logged.
- **Email/SMS**: a walk-in client with an email and/or phone (no telegram) receives a
  booking-confirmed email/SMS on confirm; telegram clients are unaffected (still get the DM). Creds
  absent → channel disabled+logged, telegram path unchanged.
- **Webhooks + Sheets**: creating an active endpoint subscribed to `booking.created` causes a signed
  POST (verifiable HMAC) on the next booking, logged as `delivered`; a failing endpoint retries and is
  visible in the delivery log. CSV export downloads valid clients/bookings files; with Sheets
  configured, "Sync" appends rows; absent → Sync is a clear no-op, CSV still works.

Validation gate (per `.claude/rules/agent-workflow.md`; use plain `pnpm`, not `corepack pnpm`, for the
cross-workspace gate per MEMORY): `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, then the
end-to-end check above against the running API/admin. A connector is "done" only when its end-to-end
flow works with creds present and degrades cleanly with creds absent.

## 14. Invariants honored / non-goals

- Bot stays an interaction layer; no provider calls or money math added to `apps/bot`.
- All connector work is **post-commit, best-effort**: a provider/webhook failure never rolls back a
  booking or court decision (mirrors the existing notifier tolerance).
- Secrets via `packages/config` only, never logged; webhook secret never returned after creation.
- Court numbers never appear in a *pending* court-request payload.
- Money stays RSD whole dinars, server-computed; connectors only render decided values.
- **Non-goals (v1)**: payments/Stripe; per-user Google OAuth; inbound webhooks; multi-locale
  email/SMS templates (RU-only, reuse existing notification message text); a generic per-channel
  retry framework beyond webhooks.

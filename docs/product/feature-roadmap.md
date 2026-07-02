# Feature roadmap

This file is the current project index. It is based on the code in `apps/*` and `packages/*`, not on
the original feature briefs alone.

Feature briefs under `docs/product/features/` are design and handoff records. A brief is historical
once the code, contracts, and tests for that slice exist. Keep those files for context, but use this
roadmap plus the code as the source of truth for current status.

## Current product surface

| Surface | Status from code | Main evidence |
| --- | --- | --- |
| Telegram bot | Shipped client, trainer, and manager flows | `apps/bot/src/*`, including booking, group booking, individual requests, trainer confirmation, trainer-today, my-bookings, navigation tests |
| API | Shipped modular Nest API | `apps/api/src/app.module.ts` wires analytics, auth, bookings, broadcasts, clients, connectors, courts, court-requests, groups, i18n, levels, managers, notification templates, notifications, settings, subscriptions, trainers, trainings, waitlist |
| Admin console | Shipped web admin surface | `apps/admin/src/routes.ts` has all nav routes live: schedule/reference, rosters, courts, broadcasts, analytics, labels, notification templates, connectors |
| Mini App | Shipped client surface | `apps/miniapp/src/router/routes.ts` exposes home, calendar, my bookings, group, individual, court, profile; screens and flow specs exist under `apps/miniapp/src/screens` |
| Shared contracts | Shipped and tested | `packages/types/src/*-contracts.ts` plus colocated specs |
| Database schema | Shipped and broader than the original MVP | `packages/db/src/schema.ts` currently exports 20 tables |

## Shipped domains

**Foundation.** pnpm/Turborepo workspace, shared env/config, Drizzle schema and migrations, Nest API,
grammY bot, React/Vite admin, React/Vite Telegram Mini App, shared Zod contracts.

**Training booking.** Levels, trainers, clients, groups, generated trainings, single bookings, monthly
group subscriptions, my bookings, cancellation, booked-count recompute, trainer confirmations, roster
and attendance management.

**Waitlist.** Waitlist join, active waitlist reads, promotion/displacement flows, admin waitlist tools,
and client-facing waitlist visibility in the Mini App.

**Individual training.** Trainers can be hidden from individual pickers via `individualVisible`.
Client requests are durable rows in `individual_training_requests`; trainer/admin decisions can confirm
or decline and create the final training/booking on confirmation.

**Court rental.** Six-court model, client court requests, availability/price preview, multi-court
holds via `court_request_courts`, admin confirm/reject, court blocks, court load grid, Mini App court
request flow, and admin court screens.

**Notifications and templates.** Telegram sends, reminder/booking/waitlist/court messages, notification
send log, editable notification templates, and connector-aware channel dispatch.

**Localization.** RU/SR/EN catalogs in `packages/i18n`, editable UI labels in the API/admin surface,
and locale-aware bot/admin/Mini App rendering.

**Connectors.** Connector registry, status/test-send endpoints, calendar feed links, Google Calendar
push adapter, CSV/Sheets exports, webhook endpoints, delivery logs, retry scheduler, signed webhook
payloads, and admin connector UI.

**Operations settings.** Manager contact setting and request-logging toggle are represented by
`app_settings`, `SettingsModule`, `RequestLoggingInterceptor`, admin hooks, and the connectors page
operational settings panel.

## Feature briefs by status

### Current or recently changed

| Brief | Status |
| --- | --- |
| `request-logging-toggle.md` | Present in the working tree with API, settings contracts, interceptor, admin hooks/UI, and specs. Treat as recently changed until the full gate is green. |
| `admin-training-edit-visibility.md` | Reflected in admin/API code through `includeTerminal` queries and terminal-status toggles. |
| `roster-avatars-and-confirm-visibility.md` | Reflected in roster contracts/helpers/UI through `telegramPhotoUrl` and client-narrowed roster rows. |

### Implemented historical briefs

| Area | Briefs |
| --- | --- |
| Bot flows | `bot-menu-and-individual.md`, `bot-manual-testing-ru.md`, `booking-small-fixes.md`, `no-group-approval.md`, `trainer-first-individual-request-routing.md`, `trainer-individual-visibility.md`, `telegram-client-identity.md` |
| Admin console | `admin-console.md`, `admin-table-controls.md`, `admin-training-roster-management.md` |
| Mini App | `miniapp-home-nav.md`, `miniapp-onboarding-identity.md`, `miniapp-calendar-training-context.md`, `miniapp-browse-book.md`, `miniapp-my-bookings.md`, `miniapp-group-booking.md`, `miniapp-individual-request.md`, `miniapp-court-request.md`, `miniapp-waitlist.md` |
| Courts | `court-30min-granularity.md`, `group-court-scheduling.md`, `recurring-court-blocks.md`, `walkin-manual-booking.md` |
| Integrations and ops | `connectors.md`, `local-run.md`, `localization.md`, `railway-deploy.md` |
| Waitlist and individual refinements | `frictionless-waitlist.md`, `individual-confirm-auto-waitlist.md` |

## Cleanup rule

Do not delete a feature brief just because the feature is shipped. If a brief is superseded by code,
either leave it as historical context or add a short status note to that file. Central status belongs
here; implementation truth belongs in code and tests.

## Definition of done for future feature cleanup

- The code path exists in the owning app/module.
- Shared Zod contracts and DB schema match the behavior.
- There are focused tests for the changed invariant.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` has been run or a precise blocker is
  documented.
- The relevant feature brief is either updated with a status note or listed above as historical.

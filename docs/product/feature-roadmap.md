# Product index

This is the current-state product index. It is based on `apps/*`, `packages/*`, and the active schema,
not on historical feature briefs.

## Product surfaces

| Surface | Current state |
| --- | --- |
| Telegram bot | Client, trainer, and manager Telegram flows backed by the API. |
| Admin console | Live routes for schedule/reference data, attendance, clients, subscriptions, courts, broadcasts, analytics, labels, notification templates, connectors. |
| Telegram Mini App | Home, unified calendar, my bookings, group subscription, individual request, court request, and profile. |
| API | Modular Nest API for booking, scheduling, courts, communication, i18n, settings, and connectors. |
| Shared packages | Zod contracts/helpers, Drizzle schema/migrations/seed, i18n catalogs, config/env helpers. |

## Shipped domains

- **Foundation:** pnpm/Turborepo, shared contracts, Drizzle/Postgres, Nest API, grammY bot, React/Vite
  admin, React/Vite Mini App.
- **Training booking:** levels, trainers, clients, groups, generated trainings, single bookings,
  monthly subscriptions, cancellation, rosters, attendance, and payment status.
- **Waitlist:** queue entries, promotion/displacement behavior, subscription waitlist entries, and
  narrowed client-facing visibility.
- **Individual training:** client requests, trainer visibility, confirm/decline decisions, final
  training creation on confirmation.
- **Court rental:** physical courts, client requests, multi-court holds, admin confirmation/rejection,
  blocks, and court load views.
- **Communication:** Telegram notifications, broadcasts, send logs, editable notification templates.
- **Localization:** RU/SR/EN static catalogs plus editable UI label overrides.
- **Connectors:** calendar/feed support, webhooks, delivery logs/retries, exports, connector status
  and admin UI.
- **Operations:** editable managers, app settings, manager contact, and request logging.

## Source-of-truth rule

Use code and tests for implementation truth:

- API modules: `apps/api/src/app.module.ts`
- Schema: `packages/db/src/schema.ts`
- Admin navigation: `apps/admin/src/routes.ts`
- Mini App routes: `apps/miniapp/src/router/routes.ts`
- Env contract: `packages/config/src/env.ts`

Historical feature briefs are not required for this index. Do not add links to missing planning docs.

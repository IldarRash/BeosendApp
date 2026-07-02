# BeoSand design guidance

The current app CSS is the source of truth:

- Admin console: `apps/admin/src/ui/theme.css` and components under `apps/admin/src/ui`.
- Mini App: `apps/miniapp/src/ui/theme.css` and components under `apps/miniapp/src/ui`.

This directory intentionally keeps only lightweight guidance. The old standalone prototypes and token
CSS files were removed because they drifted from the committed React apps.

## Admin console

- Work-tool density: compact tables, clear filters, stable row actions, visible loading/empty/error
  states.
- Sidebar groups follow `apps/admin/src/routes.ts`: schedule, courts, communications.
- Server data is authoritative. The UI may format prices, dates, and statuses, but must not recompute
  money, availability, capacity, payment, or booking state.
- Keep RU/SR/EN text lengths in mind; labels come from `packages/i18n` and API label overrides.

## Mini App

- The Mini App is a Telegram surface with a shallow in-memory route stack; routes live in
  `apps/miniapp/src/router/routes.ts`.
- Keep flows short and native-feeling: Home is the hub, sub-screens use Telegram back/main-button
  patterns where the app code supports them.
- Client-facing court requests should not reveal court numbers before admin confirmation.

## Shared rules

- Money is whole RSD.
- Use semantic states for loading, empty, error, disabled, pending, confirmed, cancelled, and paid.
- Keep accessibility basics: keyboard focus, labels, contrast, and readable table/action targets.

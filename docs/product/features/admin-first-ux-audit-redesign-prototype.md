# Admin-first UX audit and redesign prototype

## Goal

Create an admin-first UX audit and standalone clickable redesign prototype that covers the live
BeoSand admin console end to end. The slice is planning/design-only: it must not change production
admin code, Mini App code, API behavior, shared contracts, database schema, or bot flows.

The output should let the team evaluate a route-complete admin redesign in isolation before deciding
whether to implement it in `apps/admin`.

## Spec refs

- `apps/admin/PRODUCT.md` - admin users, product purpose, brand personality, design principles, and
  accessibility target.
- `apps/admin/DESIGN.md` - "Warm Control Room" design system, corrective runtime redesign brief,
  visual thesis, component vocabulary, page priorities, and runtime acceptance checks.
- `apps/admin/src/routes.ts` - current admin route inventory and navigation grouping.
- `apps/miniapp/src/router/routes.ts` - secondary client-surface context only; Mini App routes are
  not part of this admin-first prototype.
- `docs/architecture/overview.md`, `docs/architecture/domain-model.md`,
  `docs/architecture/database.md` - architecture invariants: UI surfaces are thin over API contracts,
  domain rules stay server-side, and secrets stay server-side.
- `prototypes/design-refresh/selected` - selected prototype location. In this checkout the directory
  exists, but no selected `index.html` artifact is present.

No `docs/product/feature-roadmap.md` or broader product roadmap file is present in this checkout.

## Smallest correct slice

Produce one standalone clickable admin prototype artifact, backed by an explicit UX audit, that can
be opened directly in a browser and reviewed without a running API, database, Telegram bot, or Mini
App. The prototype should cover every live admin route template from `apps/admin/src/routes.ts` and
use static mock data only.

Do not implement the redesign in production. Production implementation requires a separate approved
feature plan after the prototype is reviewed.

## Surfaces and scenarios

Primary surface: `apps/admin`.

Route coverage must follow `NAV_ITEMS`:

- Schedule: `/`, `/groups`, `/trainings`, `/trainers`, `/managers`, `/levels`, `/attendance`,
  `/clients`, `/subscriptions`.
- Courts: `/court-requests`, `/court-blocks`, `/court-load`.
- Communications and operations: `/broadcasts`, `/analytics`, `/labels`,
  `/notification-templates`, `/connectors`.
- Public entry: `/login`.

Required admin scenarios:

- Unauthenticated `/login` proof point with Telegram admin sign-in states, missing-bot/config state,
  loading state, and error state.
- Authenticated shell with sidebar, grouped navigation, active route state, mobile drawer, language
  or user area, logout, focus states, and count/status badges where shown.
- Dense schedule operations: dashboard, groups, trainings, calendar-like training view, trainers,
  managers, levels, attendance, clients, and subscriptions.
- Court operations: request queue, court blocks, and court-load/timeline view.
- Communications and settings-like operations: broadcasts, analytics, labels, notification templates,
  and connectors.
- Shared states: loading, empty, API error copy, disabled actions, destructive confirmation mock,
  toasts, modal/dialog, drawer, filters, tabs, row actions, pagination or scroll behavior.

Secondary context: `apps/miniapp` routes (`home`, `calendar`, `my-bookings`, `group`, `individual`,
`court`, `profile`) can inform vocabulary consistency, but Mini App redesign is out of scope.

## Contracts and tables

None.

This feature must not add or change Zod contracts in `packages/types`, Drizzle schema or migrations
in `packages/db`, API DTOs, repository queries, or seed data.

## API

None.

The standalone prototype must not call API endpoints. It must use static local mock data and avoid
`fetch`, `XMLHttpRequest`, `ApiClient`, `VITE_API_URL`, `DATABASE_URL`, auth tokens, or live Telegram
integration.

## Bot flow

None.

The Telegram bot and Mini App deep-link behavior are not changed by this slice.

## Invariants

- Admin remains a thin interaction layer over server-owned facts. The prototype may display mock
  prices, capacity, availability, waitlists, payment state, court assignment, request decisions, and
  pricing provenance, but it must label them as displayed facts and must not imply frontend
  recomputation.
- No production domain behavior changes. Backend services continue to own money, capacity,
  availability, waitlists, court assignment, payment state, status, and pricing provenance.
- Secrets stay server-side. The prototype contains no real tokens, real webhook secrets, real
  Telegram bot config, or environment-specific URLs.
- The route inventory stays grounded in `apps/admin/src/routes.ts`; Mini App routes remain secondary
  context and must not drive admin route coverage.
- The prototype is standalone and isolated under `prototypes/design-refresh/selected` or an approved
  successor path; it does not import production runtime code or mutate production app files.
- Accessibility targets follow `apps/admin/PRODUCT.md` and `apps/admin/DESIGN.md`: keyboard focus is
  visible, controls have accessible names, state is not color-only, contrast targets WCAG 2.1 AA,
  and reduced-motion behavior is represented where motion is shown.

## Acceptance criteria

- A UX audit exists for the current admin experience, organized by route group and shared component
  pattern, with concrete findings tied to operational clarity rather than generic visual taste.
- A standalone clickable prototype can be opened directly from disk and does not require dev server,
  API server, database, Telegram, network access, or environment variables.
- The prototype includes `/login` plus every live admin route listed in `apps/admin/src/routes.ts`.
- Navigation between prototype routes works through visible UI controls; active route and group
  context are clear on desktop and mobile-width layouts.
- The first viewport at `/login` and the authenticated shell visibly follow the "BeoSand Dispatch
  Desk" / "Warm Control Room" direction: dense, calm, precise, warm, and operational rather than a
  generic SaaS dashboard or marketing hero.
- Dense pages use stable workspace structure: toolbar or filter area, primary table/calendar/timeline
  or form, explicit empty/loading/error states, and clear action areas.
- Prototype controls for destructive or high-integrity actions are mocked with dialogs/toasts only;
  they do not send requests or imply live data mutation.
- Money, capacity, availability, payment state, court assignment, and pricing provenance are
  displayed as server-owned facts in the prototype copy and layout.
- Tables and timelines remain legible at desktop and narrow widths through stable sizing or
  horizontal scrolling; critical domain facts are not crushed or hidden.
- The prototype does not introduce thick side-stripe accents greater than 1px, gradient text,
  glassmorphism defaults, decorative grid/stripe backgrounds, nested decorative cards, bounce or
  elastic motion, or color-only status.
- Mini App is documented as secondary context only; no Mini App route or flow is redesigned in this
  slice.

## Tests and verification

- Static artifact check: open the prototype file directly in a browser from disk and verify it
  renders without a dev server.
- Route coverage check: compare prototype navigation against `apps/admin/src/routes.ts` and confirm
  `/login` plus all 17 authenticated route templates are reachable.
- Isolation scan: search the prototype artifact for forbidden live-integration strings including
  `fetch`, `XMLHttpRequest`, `ApiClient`, `DATABASE_URL`, `VITE_API_URL`, real tokens, and external
  script or image URLs.
- Responsive review: inspect desktop and mobile-width layouts for `/login`, shell navigation,
  dense table pages, court timeline/load view, modal/dialog, toast, and drawer states.
- Accessibility review: keyboard-tab through primary navigation and representative controls; confirm
  visible focus, accessible labels, non-color-only status, and readable contrast.
- Product-invariant review: verify the audit and prototype keep domain decisions server-owned and do
  not move pricing, capacity, availability, waitlist, request-decision, or payment logic into UI.
- Visual rule review: check the prototype against `apps/admin/DESIGN.md` for typography, palette,
  workspace structure, card usage, status tags, motion, and forbidden decoration.

## Dependencies

- Current `apps/admin/PRODUCT.md` and `apps/admin/DESIGN.md` remain the product/design source for
  this prototype.
- Current `apps/admin/src/routes.ts` remains the source of truth for route coverage.
- `prototypes/design-refresh/selected` is the preferred isolated prototype location. If the selected
  artifact is absent, recreate it there rather than editing production files.
- No backend, database, bot, Mini App, or API dependency is required for this planning/design slice.

## Open questions

- Should the full agent flow run after this brief?
  Default: no. Wait for explicit user approval before analyst, architect, designer, implementer,
  tester, reviewer, security reviewer, runner, or GitHub handoff agents run.
- Where should the final prototype live if `prototypes/design-refresh/selected` is empty?
  Default: create or replace the standalone selected artifact at
  `prototypes/design-refresh/selected/index.html`, keeping any source snapshots in the same isolated
  prototype directory.
- Should the prototype include Mini App screens for visual consistency?
  Default: no. Use Mini App only as secondary context for route vocabulary and cross-surface
  consistency notes.
- Should the prototype use production data fixtures?
  Default: no. Use static representative mock data with no real user records, tokens, API URLs, or
  secrets.
- Should production admin implementation begin immediately after the prototype is accepted?
  Default: no. Treat implementation as a separate feature requiring its own approved plan because it
  touches `apps/admin` production code and shared UI behavior.

# Admin Dispatch Desk Redesign

## Goal

Move the production admin console toward the approved "BeoSand Dispatch Desk" direction with the smallest visible runtime slice: login, app shell, shared UI primitives, and dashboard framing. The slice must make daily operations feel queue-first while preserving all existing routes and keeping domain facts server-owned.

## Spec refs

- User request: implement the admin Dispatch Desk redesign from the prototype/audit in a separate worktree after approval.
- `prototypes/design-refresh/selected/AUDIT.md`: queue/workspace/inspector direction, all 17 authenticated routes, and static production risks.
- `apps/admin/PRODUCT.md`: admin is a calm, precise, warm operations console over server-decided state.
- `apps/admin/DESIGN.md`: "Warm Control Room" and "BeoSand Dispatch Desk" runtime correction.
- `apps/admin/src/routes.ts`: `/login` plus 17 authenticated routes are the route coverage source.
- Architecture: `docs/architecture/overview.md`, `docs/architecture/domain-model.md`, `docs/architecture/database.md`.
- Polished request: productionize the Dispatch Desk direction in a separate worktree, but keep this planning step docs-only and do not mix in broadcast template behavior.
- `docs/product/feature-roadmap.md` is absent in this worktree, so there is no roadmap entry to link.

## Smallest correct slice

Implement a production shell slice, not a full page-body redesign:

- Redesign `/login` as the Dispatch Desk sign-in proof point with Telegram login states, missing bot config, API/admin gate copy, and error handling.
- Redesign authenticated `AppShell`: operator-prioritized navigation, mobile drawer, top context bar, current queue badge, language/user/logout footer, focus states, and route reachability.
- Tighten shared primitives used across pages: buttons, fields, tabs, tags, DataTable shell, Modal, Toast, StatCard, workspace/toolbars, empty/loading/error states.
- Reframe `Dashboard` as the first authenticated dispatch overview using existing API data only.
- Keep all 17 authenticated routes reachable, but do not redesign every page body in the first slice. Dense page bodies such as Trainings, CourtRequests, CourtLoad, Subscriptions, Broadcasts, Analytics, and setup pages are follow-on body work unless a shared primitive change naturally improves them.

Explicit boundary: this slice does not add or change custom broadcast template behavior.

## Contracts & tables

Contracts:

- No new shared Zod contract is expected for the first shell slice.
- Continue using existing typed admin contracts in `packages/types`, especially auth/session, analytics summary, court request queue, labels/i18n, and any page data already consumed by shared primitives.
- If navigation badges need additional counts beyond pending court requests, add a later API-backed contract instead of counting in the browser. Default for this slice: reuse the existing pending court request read only.

Tables:

- No schema change and no migration.
- Existing reads remain on current API modules. The UI must not read tables directly.

Admin frontend surfaces touched after approval:

- `apps/admin/src/pages/Login.tsx`
- `apps/admin/src/ui/AppShell.tsx`
- `apps/admin/src/pages/Dashboard.tsx`
- shared primitives and CSS such as `theme.css`, `DataTable.tsx`, `Toast.tsx`, `Button`, `Field`, `Modal`, `StatCard`, and route/i18n labels where needed.
- `apps/admin/src/routes.ts` only if route grouping metadata must change to support Dispatch Desk grouping while preserving all paths.

Static risks to fix or contain in this slice:

- Define or remove the undefined `--ink-600` token usage.
- Remove the external Google Fonts import; use local/system font stacks or already bundled assets.
- Replace auto-dismiss-only toasts with persistent/dismissible behavior that still supports polite live-region announcements.
- Keep DataTable empty states inside valid table semantics, not as an orphan paragraph when a table is expected.
- Verify calendar semantics before changing `TrainingsCalendar`; if not changed in this slice, record it as follow-on.
- Pricing editor mobile pressure is a follow-on body issue unless touched by shared primitive CSS; first slice must not make it worse.

## API

No new endpoint is required for the first slice.

Existing endpoints rendered by the shell/dashboard remain source-of-truth:

- `POST /auth/telegram` for Telegram login exchange.
- `GET /auth/me` for logged-in admin identity.
- `GET /analytics/summary` for dashboard figures.
- Existing pending court-request reads for the shell badge, if retained.
- Existing i18n catalog and label endpoints for localized nav/chrome.

The admin frontend must render validated API responses through `ApiClient`; it must not compute money, capacity, availability, waitlists, payment state, court assignment, pricing, or request decisions.

## Bot flow

No Telegram bot flow changes are in scope.

The only Telegram-adjacent path is the existing admin login widget:

1. Admin opens `/login`.
2. Telegram Login Widget returns a payload to the browser.
3. Admin SPA calls `POST /auth/telegram`.
4. API verifies identity/admin privileges and returns the session.

Bot commands, keyboards, client booking flows, and notification copy are unchanged.

## Invariants

- API remains the source of truth for money, capacity, availability, waitlists, payment status, request decisions, broadcast preview text, and pricing.
- Admin surfaces render validated contract data and collect manager intent only.
- All 17 authenticated routes from `apps/admin/src/routes.ts` remain reachable after shell changes.
- The redesigned shell must not hide forbidden/error/empty/loading states.
- High-integrity actions keep their existing API-backed confirmation and error behavior; shared UI changes must not introduce local optimistic domain decisions.
- Secrets stay server-side; browser code only receives `VITE_*` public values.
- Accessibility target remains WCAG 2.1 AA: keyboard focus, semantic nav/table/dialog/toast regions, reduced motion, and non-color-only status.

## Acceptance criteria

- `/login` is visibly Dispatch Desk aligned at desktop and mobile widths, with Telegram widget, missing-config, loading, bad-widget-payload, not-admin, and API failure states.
- Authenticated shell uses operator-prioritized Dispatch Desk framing and keeps every route reachable: `/`, `/groups`, `/trainings`, `/trainers`, `/managers`, `/levels`, `/attendance`, `/clients`, `/subscriptions`, `/court-requests`, `/court-blocks`, `/court-load`, `/broadcasts`, `/analytics`, `/labels`, `/notification-templates`, `/connectors`.
- Dashboard first viewport reads as a dispatch overview using existing server-provided facts; no local domain recompute is introduced.
- Shared primitives have stable responsive dimensions and states: buttons, fields, tabs, tags, DataTable, Modal, Toast, StatCard, workspace/toolbars, and empty/loading/error blocks.
- Undefined `--ink-600` is fixed or removed.
- No external Google Fonts network import remains in production admin CSS.
- Toasts are dismissible/persistent enough for users to control them and remain announced accessibly.
- DataTable renders empty and filtered-empty states with valid table semantics.
- Calendar semantics verification is completed if calendar code is touched; otherwise it is documented as follow-on.
- Pricing editor mobile pressure remains an explicit follow-on boundary unless directly touched.
- No broadcast template behavior, template variables, or broadcast API changes are included in this slice.
- The implementation is prepared in a separate worktree only after user approval of the full agent flow.

## Tests

- Component tests for `/login` states: widget configured, missing bot username, invalid widget payload, login pending, 403/not-admin, and generic API error.
- Component tests for `AppShell`: all 17 route links render, active route state, mobile drawer open/close/Esc/route-change behavior, language selector, logout, pending badge.
- Component tests for `Dashboard`: loading, error, and server-data states; figures are formatted only for display.
- Shared primitive tests:
  - DataTable empty rows stay inside table semantics and filtered-empty uses `colSpan`.
  - Toasts render in a live region and can be dismissed.
  - Modal focus/close behavior remains intact if touched.
- CSS/static checks:
  - no `--ink-600` unresolved token usage;
  - no `@import` to Google Fonts or other external font CSS;
  - no side-stripe accents greater than 1px, gradient text, glassmorphism defaults, decorative grid/stripe backgrounds, bounce/elastic motion, or nested decorative cards introduced.
- Accessibility smoke with keyboard navigation across login, shell nav, drawer, and dashboard.
- Running-app verification by `app-runner`: open `/login`, authenticate or use approved local auth path, verify dashboard/shell, and spot-check route reachability.

## Dependencies

- Existing admin auth/session flow and `ApiClient`.
- Existing route table in `apps/admin/src/routes.ts`.
- Existing i18n labels for nav/chrome; add labels only where the shell requires new copy.
- Existing Dispatch Desk audit/prototype artifacts under `prototypes/design-refresh/selected`.
- Separate implementation worktree after approval. No branch/worktree is created during this planning step.
- Follow-on body redesign slices for Trainings, CourtRequests, CourtLoad, Subscriptions, Broadcasts, Analytics, and setup pages.

## Open questions

- Should the first production slice regroup the nav into Dispatch, Schedule, Courts, Clients & Money, Comms, and Setup?
  - Default: yes for shell metadata/chrome, while preserving all existing paths and labels through i18n.
- Should route body redesigns be bundled into this slice?
  - Default: no. Only dashboard framing and shared primitive improvements land first; every route remains reachable.
- Should the shell add new queue counts beyond pending court requests?
  - Default: no. Reuse existing API reads only; add a later contract if new counts are required.
- Should pricing editor mobile layout be fixed now?
  - Default: no unless shared CSS changes touch it. Track as a follow-on body issue.
- Should calendar semantics be changed in this slice?
  - Default: verify if touched; otherwise leave behavior unchanged and document the follow-on.
- Should implementation start now?
  - Default: no. Wait for user approval of the full agent flow and then create the requested separate worktree.

## Agent flow approval gate

Do you want to run the full agent flow for this admin redesign slice?

Planned roles/subtasks after approval:

- `planner`: keep this brief current and enforce scope boundaries.
- `ui-designer`: translate Dispatch Desk direction into production component/page guidance.
- `frontend-implementer`: implement login, shell, shared primitives, dashboard framing, labels, and route reachability in a separate worktree.
- `test-writer`: add focused component/static/accessibility tests.
- `reviewer`: check correctness, scope, and design-system consistency.
- `security-reviewer`: verify auth/session boundaries and no secret/domain-logic leaks.
- `app-runner`: run admin and verify login/shell/dashboard/route reachability.

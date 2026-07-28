# Admin-First UX / Design Audit

## Method / Provenance

This report consolidates two independent assessments and a local repo check. It is scoped to the admin-first redesign prototype package, not production implementation.

Inputs used:

- Assessment A: Nielsen heuristic score 25/40; coherent warm operational system; good accessibility foundations; server-truth discipline; P1/P2 UX findings.
- Assessment B: detector command `node C:\Users\ilsac\.agents\skills\impeccable\scripts\detect.mjs --json apps/admin/src prototypes/design-refresh/selected` exited 0 with `[]`; at that initial checkpoint the selected prototype directory was empty and browser overlay was skipped because no `index.html` existed yet. Current verification now covers the completed selected package.
- Repo facts checked: `docs/product/features/admin-first-ux-audit-redesign-prototype.md`, `apps/admin/PRODUCT.md`, `apps/admin/DESIGN.md`, `docs/architecture/overview.md`, `apps/admin/src/routes.ts`, `apps/miniapp/src/router/routes.ts`, `apps/admin/src/ui/theme.css`, `DataTable.tsx`, and `Toast.tsx`.

Confirmed facts:

- Admin has `/login` plus 17 authenticated routes grouped as schedule, courts, and comms.
- Mini App has 7 client route ids: `home`, `my-bookings`, `group`, `individual`, `court`, `calendar`, `profile`.
- `prototypes/design-refresh/selected/index.html` now exists as a standalone direct-open prototype artifact.
- The completed artifact implements `/login` plus the 17 authenticated admin paths from `apps/admin/src/routes.ts` through path-based prototype navigation.
- Admin architecture requires UI surfaces to stay thin over API contracts; money, capacity, availability, waitlists, payment state, court assignment, and request decisions stay server-owned.
- Static risks are real in current admin code: undefined `--ink-600`, external Google Fonts import, auto-dismiss toasts, DataTable empty state outside table context, TrainingsCalendar grid semantics risk, and pricing editor mobile pressure.

Assumptions:

- The next deliverable is a standalone clickable admin prototype under `prototypes/design-refresh/selected`, not a production rewrite.
- Static mock data is acceptable, provided high-integrity actions are clearly mocked and never imply live state mutation.

Open questions:

- Which admin queue counts matter most for the first viewport: court requests, unassigned trainings, unpaid subscriptions, pending broadcasts, or another operational queue?
- Should the prototype use Russian-only copy first, or include language-switch proof points for RU/SR/EN layout stress?

## Health Score

| Area | Score | Health | Evidence | Required Move |
| --- | ---: | --- | --- | --- |
| Nielsen heuristics | 25/40 | Acceptable, not shippable | Strong system coherence, but high cognitive load in core operator pages. | Redesign around dispatch queues and route priority. |
| AI-slop detector | Pass | Clean | Detector returned `[]`; court timeline measurement grid is a false-positive risk, not decorative stripe slop. | Preserve operational grid only where it measures time/courts. |
| Prototype readiness | 3/4 | Package present; visual smoke limited | `index.html` exists, route coverage is implemented by path, and static scans pass. Browser visual smoke remains limited because the Playwright browser binary is missing in this environment. | Run full browser visual smoke after installing the Playwright browser binary. |
| Accessibility foundation | 3/4 | Good base | Visible focus/token intent and semantic table work exist. | Fix toast persistence, grid semantics, empty states, and responsive pressure. |
| Server-truth clarity | 3/4 | Good invariant, weak scan | Repo docs enforce server-owned facts; provenance is not scannable enough in dense pages. | Make provenance a visible row/panel pattern. |

## Executive Summary

This is not AI slop. The admin direction is coherent: warm, operational, accessible, and disciplined about server-owned truth. The problem is not taste; it is operator focus.

The current admin experience asks managers to parse too many equal-weight actions, mixed configuration and daily operations, and dense pages where provenance is present but not fast to scan. Trainings, CourtRequests, CourtLoad, and Subscriptions carry the highest cognitive load because they combine decisions, exceptions, money/capacity/availability facts, and configuration-like controls in the same workspace.

The completed redesign slice is a standalone "BeoSand Dispatch Desk" prototype: queue-first admin navigation, 17 live admin routes grouped by operator priority, today-first queue surfaces in the first authenticated viewport, route templates for core patterns plus path-specific placeholders for catalog routes, Mini App context panels only as secondary context, and mock-only interactions where visible controls respond or are explicitly disabled.

Primary actor: BeoSand manager/admin running daily operations.
Primary flow: sign in -> land on today's dispatch queues -> resolve schedule/court/subscription exceptions -> inspect provenance -> take mocked action -> receive confirmation/toast without live mutation.
Alternate flows: empty queues, API error copy, loading states, destructive confirmation, mobile drawer navigation, table horizontal scroll, disabled forbidden actions.

## Priority Issues

### P0 - Selected Prototype Artifact Exists

Impact: The original blocker is resolved for package review: `prototypes/design-refresh/selected/index.html` exists and can be opened directly from disk.

Remaining limitation: Browser visual smoke, overlay inspection, keyboard walkthrough, and responsive screenshots still need a local Playwright browser binary. Static verification passed in this environment.

### P1 - Core Operator Screens Have Too Many Equal-Weight Actions

Impact: Managers cannot quickly tell what needs action now versus what is available as secondary maintenance. This slows high-frequency work in Trainings, CourtRequests, CourtLoad, and Subscriptions.

Recommendation: Establish one primary action zone per screen, then demote secondary actions into row menus, inspector panels, or disabled/mock states. The first viewport should show today's queues and exceptions before configuration.

### P1 - Configuration Is Mixed With Daily Operations

Impact: Settings-like work competes with live operational work. Pricing tiers, connectors, templates, labels, and management setup can look as urgent as pending queues.

Recommendation: Group routes by operator priority, not only domain. Keep dispatch routes first; move configuration to a clearly lower-priority "Setup / Reference" region in nav and page layout.

### P1 - Provenance Is Not Scannable Enough

Impact: Server-truth discipline exists in the architecture, but managers still need faster visual answers to "where did this price/status/capacity number come from?"

Recommendation: Add a reusable provenance pattern: compact source chip, timestamp or calculation scope, server-owned note, and detail drawer for breakdowns. Use it in Subscriptions, CourtLoad, CourtRequests, and Trainings.

### P2 - Navigation Is Broad, But Not Operator-Prioritized

Impact: The 17 routes are complete, but route order does not yet tell the manager what matters today.

Recommendation: Prototype nav groups around work cadence: Dispatch, Schedule, Courts, Clients & Money, Comms, Setup. Keep all 17 routes reachable; change emphasis, not coverage.

### P2 - Mini App/Admin Role Contrast Needs Sharpening

Impact: Client-facing vocabulary can blur with admin control vocabulary. Admin should feel like an operations desk; Mini App should remain a guided client booking surface.

Recommendation: Use Mini App context panels only to explain what the client sees after admin action. Do not redesign Mini App flows in this slice.

### P2 - Static Implementation Risks Need Prototype Rules

Impact: Existing risks can leak into the prototype if copied uncritically: undefined `--ink-600`, external font dependency, auto-dismiss-only toasts, DataTable empty state outside table semantics, calendar grid semantics, and pricing editor mobile pressure.

Recommendation: Define prototype-level fixes: local/system font fallback, no undefined tokens, persistent/dismissible notifications, semantic table empty rows, accessible grid labeling, and horizontal scroll or stacked editor layout on narrow screens.

## Redesign Direction

Direction: **BeoSand Dispatch Desk**.

Design the authenticated first viewport around today's operational queues, not a dashboard of equal cards. The manager should immediately see pending court requests, unassigned or capacity-risk trainings, payment/subscription exceptions, and communications needing attention.

Route grouping should keep all current admin routes but prioritize daily work:

- Dispatch: overview, court requests, trainings exceptions, subscriptions exceptions.
- Schedule: groups, trainings, trainers, managers, levels, attendance.
- Courts: court requests, court blocks, court load.
- Clients & Money: clients, subscriptions.
- Communications: broadcasts, analytics, labels, notification templates.
- Setup: connectors and low-frequency configuration.

Core route templates:

- Queue page: filter bar, priority list/table, inspector panel, mocked decision dialog.
- Schedule page: calendar/table switch, conflict/provenance chips, roster/waitlist inspector.
- Money page: subscription table, pricing provenance drawer, payment-state actions via confirmation.
- Court page: request queue plus court-load timeline; measurement grid allowed when it encodes time/court position.
- Setup page: explicit config state, disabled live integrations, mock secret/webhook actions only.

Interaction rule: every clickable control responds with route navigation, modal, drawer, toast, state preview, or is visibly disabled with a reason. High-integrity actions never silently mutate mock state.

## Mini App Context Notes

Mini App is secondary context only. Its seven client routes should inform wording and cross-surface expectations, but the prototype must remain admin-first.

Use Mini App context panels where they reduce ambiguity:

- "Client sees this" side note after schedule, court request, booking, or broadcast decisions.
- Deep-link destination labels for notifications, without implementing Mini App screens.
- Client-safe roster/privacy reminders where admin sees fuller data than clients.

Do not add Mini App route navigation, client booking screens, or Telegram-native button behavior to this prototype.

## Prototype Acceptance Criteria

- `prototypes/design-refresh/selected/index.html` exists and opens directly from disk without a dev server.
- `/login` plus all 17 authenticated admin route templates are reachable.
- First authenticated viewport is queue-first and today-first.
- Navigation is grouped by operator priority while preserving complete route coverage.
- Dense screens include toolbar/filter area, primary table/calendar/timeline/form, explicit empty/loading/error states, and clear action area.
- Money, capacity, availability, waitlists, payment state, court assignment, and pricing provenance are displayed as server-owned facts.
- Destructive or high-integrity actions use mock confirmation/dialog/toast flows only.
- No forbidden live integration strings: `fetch`, `XMLHttpRequest`, `ApiClient`, `DATABASE_URL`, `VITE_API_URL`, real tokens, external scripts, or external images.
- Every clickable control responds or is disabled with an obvious reason.
- Desktop and mobile-width layouts preserve readable tables/timelines through structural resizing, horizontal scroll, or stacked editors.
- No thick side-stripe accents, gradient text, glassmorphism defaults, decorative stripe/grid backgrounds, nested decorative cards, bounce/elastic motion, or color-only status.

## Verification Notes

- Detector scan: passed with `[]` during Assessment B and remains part of this report's provenance.
- Selected artifact check: `prototypes/design-refresh/selected/index.html` exists.
- Route coverage check: `index.html` implements `/login` plus all 17 authenticated admin paths from `apps/admin/src/routes.ts` through path-based prototype navigation.
- Static integration scan: passed; no `fetch`, `XMLHttpRequest`, `ApiClient`, `DATABASE_URL`, `VITE_API_URL`, external scripts, or external image/link URLs were found in `index.html`.
- Browser visual smoke: limited because the Playwright browser binary is missing in this environment.
- Route source: `apps/admin/src/routes.ts` is the route coverage source of truth.
- Mini App source: `apps/miniapp/src/router/routes.ts` is secondary context only.
- Known false positive: court timeline `repeating-linear-gradient` should be allowed only when it functions as a measurement grid for time/court layout, not decorative striping.
- Current production static risks to avoid carrying forward: undefined `--ink-600`, external Google Fonts import, auto-dismiss toasts without user control, DataTable empty state outside table context, TrainingsCalendar grid semantics, and pricing editor fixed-grid mobile pressure.

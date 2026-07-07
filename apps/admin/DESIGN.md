---
name: "BeoSand Admin"
description: "A calm, precise, warm operator workspace for daily beach-volleyball school operations."
colors:
  sand-50: "#faf6ef"
  sand-100: "#f2eadd"
  sand-200: "#e7dbc7"
  sand-300: "#d8c9af"
  ink-900: "#211c15"
  ink-700: "#4b4339"
  ink-500: "#8a8073"
  ink-400: "#b0a695"
  coral: "#e15b43"
  coral-ink: "#b23e2b"
  coral-soft: "#fbe5df"
  teal: "#1c9488"
  teal-ink: "#126b62"
  teal-soft: "#dbf0ed"
  amber: "#c98a12"
  amber-ink: "#93630a"
  amber-soft: "#f7ebcf"
  indigo: "#4b6bbd"
  paper: "#ffffff"
  border: "#e3d9c8"
  border-strong: "#cfc1a8"
  focus: "#2c6fb0"
typography:
  display:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "12.5px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Cascadia Code, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.02em"
rounded:
  sm: "7px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  page-x: "36px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 15px"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 15px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.sm}"
    height: "38px"
    padding: "0 12px"
  surface-card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.md}"
    padding: "16px 18px 17px"
  status-tag:
    backgroundColor: "{colors.sand-200}"
    textColor: "{colors.ink-700}"
    rounded: "{rounded.pill}"
    padding: "2px 9px"
---

# Design System: BeoSand Admin

## Overview

**Creative North Star: "The Warm Control Room"**

A school manager works at a laptop between training blocks, calls, payments, and court changes. The room is bright enough for a light interface, noisy enough that the UI must scan instantly, and operational enough that every figure must feel server-owned rather than locally guessed.

The redesign direction is a calm precise warm operator workspace: refined, utilitarian, data-dense, fast to scan, and unmistakably BeoSand without becoming ornamental. The working surface comes first: tables, calendars, timelines, queues, filters, forms, status, and detail inspection. Cards support repeated figures or framed tools only; they do not become a decorative dashboard grid.

Product register: `product`. Design serves the admin task; it does not become the product itself.

The admin is a thin interaction layer over `apps/api`. Frontend components render validated contract data, collect manager intent, and show API errors verbatim. Money, capacity, availability, waitlists, court assignment, payment state, status, and pricing provenance stay out of UI logic.

**Key Characteristics:**
- Dense but legible operational layouts with one primary workspace per screen.
- Warm sand and ink foundation, white work surfaces, coral used sparingly for primary action and current selection.
- Mono figures for counts, RSD, Telegram IDs, time, filters, and compact status facts.
- Server provenance is visible when it affects trust, especially stored snapshots, payment/pricing breakdowns, and API-decided statuses.
- Short state-driven motion only; no ornamental page choreography.

## Colors

The palette is restrained: warm neutrals carry the workspace, coral marks action and selection, and semantic hues identify state without turning the admin into a sports interface.

### Primary
- **Sunset Coral** (`coral`): Primary action, selected segmented controls, active icons, focused operational emphasis. Use on less than 10% of any screen.
- **Coral Ink** (`coral-ink`): Text on coral-soft surfaces, danger text, and selected navigation labels.
- **Coral Soft** (`coral-soft`): Error or danger background tints, soft selected badges, and controlled emphasis.

### Secondary
- **Operational Teal** (`teal`, `teal-ink`, `teal-soft`): Success, confirmed court requests, available positive state, and completion. Pair with text or glyphs; never rely on color alone.
- **Exception Amber** (`amber`, `amber-ink`, `amber-soft`): Warnings, blocks, unassigned trainings, pending attention, and destructive ambiguity.

### Tertiary
- **Training Indigo** (`indigo`): Court-load training state only. It exists to separate trainings from requests and blocks; do not expand it into a brand accent.

### Neutral
- **Sand Canvas** (`sand-50`, `sand-100`, `sand-200`, `sand-300`): App background, sidebar, table heads, hover rows, and quiet control panels.
- **Paper Surface** (`paper`): Tables, forms, modals, stat cards, editors, and real working containers.
- **Deep Ink** (`ink-900`, `ink-700`, `ink-500`, `ink-400`): Primary text, secondary text, metadata, disabled text, placeholder text, and dividers.
- **Warm Borders** (`border`, `border-strong`): Structural separation. Borders are preferred over heavy shadows.
- **Focus Blue** (`focus`): Keyboard focus only. It stays visually distinct from brand coral so focus is never confused with selection or error.

### Named Rules
**The One Accent Rule.** Coral is for action, selection, and urgent emphasis only. If coral appears in decoration, remove it.

**The Server Truth Rule.** State colors label API-decided facts. They must not imply local recomputation of price, availability, capacity, payment state, or court assignment.

**The No Side-Stripe Cleanup Rule.** During the redesign, remove thick side-tab accent borders and card/list `border-left` accents greater than 1px. Replace them with full borders, filled status tags, compact icons, row selection backgrounds, or text labels.

## Typography

**Display Font:** Iowan Old Style / Palatino / Georgia serif stack.
**Body Font:** system sans stack.
**Label/Mono Font:** JetBrains Mono with system mono fallbacks.

**Character:** The serif gives BeoSand a recognizable editorial note in page and modal titles, while the sans and mono keep operator controls familiar and dense. Product UI uses fixed sizes, not fluid type.

### Hierarchy
- **Display** (600, 28px, 1.1): Page `h1` only. It should introduce the workspace, not behave like a landing-page hero.
- **Title** (600, 20px, 1.2): Modal titles and major section headings.
- **Section** (600, 15-16px, 1.25): Dense panels such as pricing editors, working-hours forms, and note headings.
- **Body** (400, 14px, 1.5): Normal explanatory copy and table body. Prose caps at roughly 70ch; tables may run wider.
- **Label** (600, 12.5px, 1.35): Field labels, legends, compact row labels.
- **Mono Label** (600, 10.5-11.5px, 1.5): Column headers, tags, counts, IDs, times, RSD, and filter control bars.

### Named Rules
**The Data First Type Rule.** Use mono for operational facts that benefit from alignment or quick comparison. Do not use decorative type inside controls, tags, data cells, or filters.

**The No Hero Admin Rule.** Admin screens start with the working surface. No oversized hero type, marketing panels, or decorative metric headers.

## Elevation

The admin uses tonal layering plus restrained structural shadows. Surfaces are mostly flat: a warm border defines the object, a small shadow separates dense work areas from the sand canvas, and the large shadow is reserved for overlays. Avoid pairing a 1px border with a wide decorative shadow unless the component is a real overlay.

### Shadow Vocabulary
- **Surface Low** (`shadow-sm`: `0 1px 2px rgba(33, 28, 21, 0.06)`): Tables, cards, toolbars, pricing editors, and timeline containers at rest.
- **Surface Raised** (`shadow-md`: `0 6px 22px rgba(33, 28, 21, 0.1)`): Login panel or rare raised content.
- **Overlay High** (`shadow-lg`: `0 18px 48px rgba(33, 28, 21, 0.18)`): Modal panels, off-canvas sidebar, and toasts.
- **Focus Ring** (`focus-ring`: `0 0 0 3px rgba(44, 111, 176, 0.35)`): Keyboard focus on inputs, buttons, table controls, and drawer controls.

### Named Rules
**The Flat Until State Rule.** At rest, interfaces are defined by borders, spacing, and tonal surfaces. Lift appears for overlays, hover feedback, and keyboard focus.

**The Motion Cleanup Rule.** Replace bounce or elastic easing with short ease-out/quart-like curves. Modal, sheet, toast, and drawer motion must be 120-220ms, state-driven, and compatible with reduced motion.

## Components

### Buttons
- **Shape:** Compact rectangle with gentle corners (7px radius), 38px default height, 32px small, 44px large.
- **Primary:** Coral fill with white text. Use for the screen's main action, confirm action, or send/save action only.
- **Ghost:** Paper fill, strong warm border, ink text. Use for secondary commands and dense table-row actions.
- **Danger:** Paper fill, coral-ink text, coral-tinted border. Use for destructive actions and make confirmation explicit.
- **Hover / Focus:** Hover changes surface or fill only. Focus uses the blue focus ring, never coral. Disabled controls reduce opacity and keep layout stable.

### Fields
- **Style:** Label above control, paper background, strong warm border, 38px height, 7px radius, sans body text.
- **Focus:** Blue border and blue focus ring. Error uses coral border and an explicit error message with `role="alert"` where appropriate.
- **Selects:** Native select with a compact chevron; do not invent custom dropdowns inside clipped containers.
- **Numeric / RSD:** Mono and tabular where values are compared. Money is display-only from API data via the shared RSD formatter.

### Data Tables
- **Style:** Semantic table inside a bordered paper surface, sticky sand header, mono uppercase headers, 13px body rows, numeric columns right-aligned in mono.
- **Controls:** Column sort and filters operate only on already-loaded validated rows. Server search/filtering remains server-owned where hooks provide it.
- **Empty / Loading / Error:** Use explicit Russian states. Empty state tells the operator what is missing; error state exposes the API message when available.
- **Density:** Tables may scroll horizontally; do not crush columns or hide critical domain facts.

### Navigation
- **Style:** Sticky sand sidebar on desktop; top bar plus off-canvas drawer below 1024px. Group labels are compact mono caps, nav rows are 13.5px sans with icons.
- **Active State:** Use paper fill, coral label/icon, and a subtle row treatment. Redesign implementation should remove the current thick side accent marker.
- **Badges:** Counts sit on the right in mono pills and reflect server reads only.

### Cards / Containers
- **Corner Style:** 10px for cards and working containers, 14px for modal/login panels and mobile sheets.
- **Background:** Paper on sand. Use sand-50 for inset forms or preview bodies.
- **Shadow Strategy:** Surface Low for static containers, Overlay High for modals/toasts/drawers.
- **Internal Padding:** 14-20px for dense panels; never nest decorative cards inside cards.

### Tags / Chips
- **Style:** Mono 11px pill, 2px 9px padding, text plus optional dot/icon. Use filled soft tints for ok/warn/coral/info/muted states.
- **Meaning:** Tags must include text, not just color. Status cannot be color-only.

### Modals / Drawers / Toasts
- **Modal:** Accessible dialog with title, focus trap, Esc/backdrop close, restored focus, footer actions, and a bottom-sheet shape on phone.
- **Drawer:** Mobile sidebar locks body scroll and closes on route change, scrim, Esc, or navigation.
- **Toast:** Fixed live region, dark ink surface, tone icon plus text. Redesign implementation should remove side-stripe tone borders and use icons or filled tone chips instead.

### Court Timeline / Calendar Events
- **Timeline:** Time axis and courts form the primary workspace; events are labeled by state and time, not color alone.
- **Calendar Events:** Compact chips may use group color for scanning, but must preserve visible text and accessible labels.
- **Target State:** Request targeting may use the focus blue ring plus coral accent only when it helps orientation.

## Do's and Don'ts

### Do:
- **Do** start every admin screen with the operational workspace: table, calendar, timeline, queue, form, or report.
- **Do** keep `apps/admin` thin over typed API contracts. Render server-decided money, capacity, availability, waitlists, court assignment, payment state, and status.
- **Do** use Russian UI strings, Serbian where the product already uses it, and whole-dinar RSD display via the shared formatter.
- **Do** make provenance visible when trust depends on it: stored booking prices, pricing breakdowns, monthly count context, server decisions, and editable manager inputs should not blur together.
- **Do** preserve dense scanning: sticky headers, mono figures, right-aligned numeric columns, compact filters, clear status tags, and explicit empty/error/loading states.
- **Do** keep keyboard focus visible and separate from brand accent by using the blue focus ring.
- **Do** make mobile layouts structurally safe: drawer navigation, horizontally scrollable dense grids, full-width toasts, and bottom-sheet modals.

### Don't:
- **Don't** create generic SaaS dashboard kits with interchangeable blue/gray cards and decorative metrics.
- **Don't** create loud sports or fitness interfaces that prioritize energy over operational clarity.
- **Don't** make Telegram-bot-like admin screens that feel like a thin chat wrapper instead of a real console.
- **Don't** use overly ornamental editorial UI that makes dense tables, forms, and exception queues harder to use.
- **Don't** make the frontend appear to recompute prices, capacity, or availability instead of clearly reflecting server-owned state.
- **Don't** use thick side-tab accent borders or `border-left` accents greater than 1px on cards, list items, notes, toasts, or calendar chips in the redesign.
- **Don't** use bounce, elastic, or overshooting cubic-bezier motion. Motion is short, state-driven, and reduced-motion aware.
- **Don't** use gradient text, glassmorphism, decorative grid/stripe backgrounds, oversized cards, nested cards, or marketing hero sections.
- **Don't** hide critical action text behind icons unless the icon is familiar and has an accessible label or tooltip.

## Corrective Runtime Redesign Brief

This pass is a visible runtime correction, not another token-only polish. The prior direction is valid, but the
first viewport at `/login` and the authenticated shell must change enough that an operator can tell the console
has been redesigned before reading any page copy.

### Visual Thesis

**BeoSand Dispatch Desk.** Keep the warm, precise product register, but make the console feel more like a
purpose-built operations desk: an ink-led brand rail, paper work surface, compact control bars, denser tables, and
status-first rows. The visible delta should come from structure and contrast, not decoration.

- Login becomes a split operational sign-in surface: left brand rail with BeoSand identity, API/admin trust facts,
  and support/status microcopy; right Telegram sign-in panel. No hero, no card grid.
- Authenticated pages use a stronger shell: ink or deep-sand sidebar, lighter paper main surface, sticky top context
  bar on desktop/mobile, and active nav as a filled row with icon and count.
- Page bodies move from loose `stack` sections toward workspaces: toolbar/header strip, primary table/calendar/timeline,
  and optional inspector/editor panel. Cards are reserved for metrics, template rows, and real framed tools.
- Mono figures become more prominent in counts, dates, RSD, IDs, times, table headers, and filter bars.
- Coral remains the primary-action/selection accent only. Teal, amber, indigo are state labels and event colors,
  always paired with text/glyphs.

### Component Vocabulary To Apply

Use the existing runtime classes first: `.login`, `.login__card`, `.brand__mark`, `.brand__sub`, `.app`, `.sidebar`,
`.topbar`, `.nav__item`, `.main`, `.page-head`, `.toolbar`, `.filter-toolbar`, `.datatable__surface`, `.datatable`,
`.tabs`, `.tab`, `.card`, `.tag`, `.state`, `.modal`, `.toast`, `.calendar`, `.cal-event`, `.court-timeline`,
`.court-event`, `.pricing-editor`, `.tpl-card`, `.tpl-preview`, `.court-picker`, `.admin-person`, `.admin-avatar`.

Add shared classes only when they remove repeated inline styles or establish a visible layout pattern:
`.login__rail`, `.login__panel`, `.login__facts`, `.shell-topline`, `.workspace`, `.workspace__bar`,
`.workspace__body`, `.workspace__inspector`, `.row-actions`, `.metric-strip`, `.provenance-list`.

### Page Priorities

1. **Login first.** It is the unauthenticated proof point. Make `/login` unmistakably different without requiring
   API data: dispatch-desk split layout, strong BeoSand wordmark, Telegram widget panel, explicit admin-gate copy,
   and robust missing-bot/error/loading states.
2. **App shell second.** Redesign sidebar, mobile drawer, topbar, language/user/logout footer, active nav, badges,
   and focus states. Every authenticated page inherits the visible change from this step.
3. **Shared primitives third.** Tighten `Button`, `Field`, `DataTable`, `Modal`, `Toast`, `StatCard`, tags, tabs,
   toolbars, filter bars, and row actions so the redesign is consistent across dense pages.
4. **Dense operational pages fourth.** Apply workspace framing to `Dashboard`, `Trainings`, `TrainingsCalendar`,
   `CourtLoad`, `CourtRequests`, `Clients`, `Subscriptions`, `Broadcasts`, and `Analytics`.
5. **Management pages fifth.** Carry the same treatment to groups, trainers, managers, levels, labels, notification
   templates, court blocks, attendance, and connectors/settings-like pages so the console does not split into old
   and new visual systems.

### Runtime Acceptance Checks

- `/login` at 1440px and 390px is visibly redesigned before auth and contains no generic hero/card-grid pattern.
- Active navigation, current counts, pending queue badge, focus rings, and mobile drawer states are visually obvious.
- Dense pages show a stable workspace structure: toolbar/filters, primary table/calendar/timeline, explicit state
  messages, and action areas with no layout shift.
- Tables remain readable at narrow widths through horizontal scrolling; columns are not crushed.
- No React page computes domain facts. Money, availability, capacity, payment state, court assignment, and pricing
  provenance remain API-rendered values.
- No side-stripe accents greater than 1px, gradient text, decorative grid/stripe backgrounds, glass default, bounce,
  elastic motion, or nested decorative cards.

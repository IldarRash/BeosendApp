---
name: frontend-design
description: Design production-grade apps/admin interfaces for BeoSand. Use when creating or revising admin components, pages, layouts, visual states, or design-system patterns before frontend implementation.
---

# Frontend design

Design the `apps/admin` console as an operator workspace: dense, calm, legible, and quick to scan.
The UI should help managers monitor schedules, bookings, courts, clients, payments, and exceptions
without adding marketing-style decoration.

## Design protocol

Before proposing or editing UI, decide:

1. Visual thesis - mood, density, hierarchy, and the one accent color or state treatment.
2. Content plan - primary workspace, supporting context, inspection/detail area, and final action.
3. Interaction thesis - the 2-3 state changes that improve orientation or reduce mistakes.

## BeoSand rules

- Start with the working surface itself: tables, calendars, grids, queues, filters, status, or task
  context. Do not add a landing page or marketing hero unless explicitly requested.
- Reuse `apps/admin/src/ui/*` and `apps/admin/src/ui/theme.css`. Add shared tokens when needed;
  avoid one-off component styling.
- UI strings are Russian unless the product area already uses Serbian. Money is RSD, whole dinars,
  and display-only from API data.
- Never put domain logic, price math, capacity math, court assignment logic, or availability logic
  in the design or frontend layer.
- Prefer layout and information hierarchy over card mosaics. Use cards only for repeated entities,
  modals, or genuinely framed tools.
- Keep controls stable: tables, toolbars, icon buttons, counters, grids, and tiles need predictable
  dimensions so labels and hover states do not shift layout.
- Use icons for compact commands when a known icon exists; pair with tooltips for unfamiliar actions.
- Motion should clarify state: hover, selection, filtering, drawers, row expansion, and modal entry.
  Remove ornamental motion.
- Protect mobile and desktop layout safety. Fixed, sticky, floating, animated, or decorative layers
  must not overlap text, controls, tables, or tap targets.

## Litmus checks

- Can an operator understand the screen by scanning headings, labels, values, and selected states?
- Is there one primary workspace and one obvious next action?
- Are cards, borders, shadows, and backgrounds necessary for understanding or interaction?
- Does every interactive state fit, remain tappable, and preserve layout on mobile?

---
name: BeoSand Mini App
description: A Telegram-native, week-first schedule for clients managing their sports-school activity.
colors:
  canvas: "#fff"
  ink: "#152538"
  subtle: "#64748b"
  line: "#dfe6ef"
  cobalt: "#234ed8"
  cobalt-soft: "#eef3ff"
  confirmed: "#116333"
  confirmed-soft: "#e3f7ea"
  pending: "#914400"
  pending-soft: "#fff1d8"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "clamp(30px, 8vw, 38px)"
    fontWeight: 780
    lineHeight: 1
    letterSpacing: "-.035em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.35
  time:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 780
    lineHeight: 1
    letterSpacing: "-.04em"
rounded:
  control: "12px"
  container: "14px"
  day: "18px"
  pill: "999px"
spacing:
  compact: "8px"
  control: "12px"
  content: "18px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.container}"
    height: "54px"
  status-confirmed:
    backgroundColor: "{colors.confirmed-soft}"
    textColor: "{colors.confirmed}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
  status-pending:
    backgroundColor: "{colors.pending-soft}"
    textColor: "{colors.pending}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
---

# Design System: BeoSand Mini App

## Overview

**Creative North Star: "The Calm Week Ledger"**

The Mini App makes a personal schedule legible at a glance: a familiar week strip, date-led agenda rows, and a single current action. It feels like a reliable part of Telegram rather than a marketing site. White and cool-gray surfaces keep attention on dates, times, server-provided status, and the next available action; cobalt marks the active choice.

The week experience is intentionally compact and mobile-first. It retains the established Calendar, booking, court, profile, and records flows where they remain useful, while the new shell organizes the client’s immediate week and one selected day. Status labels always accompany their colors because the server, not the UI, determines the lifecycle and availability.

**Key Characteristics:**

- Native Telegram visual language, including its host chrome and light/dark theme ownership.
- Week-first agenda for personal records; one-day schedule for bookable sessions.
- Strong tabular time, quiet separators, and plain-language state labels.
- Cobalt as the selective active/action accent; green and amber are status colors only.

## Colors

The light palette is white, cool gray, navy, and cobalt; the dark Telegram theme swaps the surface and text values while preserving the same status meaning.

### Primary

- **Schedule Cobalt** (`#234ed8`): selected dates, active navigation, the primary action, and focus indication. Dark theme uses `#3c67d2` for filled controls and `#8eafff` where a blue text/icon accent is needed.
- **Cobalt Wash** (`#eef3ff`): notices and low-emphasis information surfaces. Dark theme uses `#263e70`.

### Neutral

- **Telegram Canvas** (`#fff`): the light content and sticky navigation surface; dark theme uses `#17202d`.
- **Agenda Navy** (`#152538`): headings, times, and primary text; dark theme uses `#f5f8fc`.
- **Quiet Slate** (`#64748b`): secondary details and inactive navigation; dark theme uses `#aebacc`.
- **Cool Divider** (`#dfe6ef`): row separation and quiet outlines; dark theme uses `#344255`.

### Status

- **Confirmed Green** (`#116333` on `#e3f7ea`): confirmed, attended, and completed states. Dark theme uses `#a5ebbd` on `#173d2a`.
- **Pending Amber** (`#914400` on `#fff1d8`): pending and waitlist states. Dark theme uses `#ffd08a` on `#4b3516`.

**The Status Is Evidence Rule.** Use these colors with the server-provided text label only; never infer a booking state from a client-side control or color alone.

## Typography

**Display Font:** system UI stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`.

**Body Font:** the same system UI stack, so text follows the client’s Telegram-adjacent environment.

**Character:** Firm, compact, and legible. Large headings establish the section; dense schedules use tabular numerals so time columns scan vertically without visual drift.

### Hierarchy

- **Display** (780, `clamp(30px, 8vw, 38px)`, 1): page titles such as the week and schedule headings.
- **Time** (780, `26px`, 1, tabular numerals): agenda and schedule start times; reduces at very narrow widths.
- **Section title** (default 700, `27px`): day-session headings.
- **Record title** (default 700, `17–18px`, 1.2): activity and training context.
- **Body** (default weight, `14px`, 1.35): trainer, duration, level, and supporting details.
- **Label** (650–700, `11–13px`): weekday labels, filters, statuses, and bottom-navigation text.

## Layout

The modern shell is a single column, `max-width: 640px`, centered where room permits and full-height on a phone. The scroll body uses `26px 18px 122px` padding to leave room for the sticky four-tab navigation and Telegram safe area. The home surface has a seven-column week strip; the schedule replaces it with a horizontally scrollable date rail so a particular day remains explicit.

Agenda and schedule entries use a fixed time column (`78px` and `74px` respectively) followed by the activity details. This establishes a week-planner rhythm without card mosaics. At `350px` and below, horizontal padding and time columns contract while controls retain usable minimum heights of 44–54px.

## Elevation & Depth

This is a mostly flat interface. Dividers, borders, alignment, and quiet tonal fills define grouping. Shadows appear only to support selected filled controls: the active segmented tab uses `0 5px 12px rgba(35,78,216,.24)` and the primary action uses `0 8px 18px rgba(35,78,216,.26)`.

## Shapes

Controls are softly rounded rather than pill-heavy: 9–14px for inputs, buttons, filter fields, and containers; day buttons can reach 18px; status chips alone are fully rounded. The selected day number is a 42px circle. Outlined controls use the cool divider, while filled cobalt controls reverse to white text.

## Components

### Primary action

- **Shape:** full-width, 54px high, 14px radius.
- **Color:** cobalt fill with white text and a restrained cobalt shadow.
- **Use:** opens an allowed scheduling action. It must not claim a booking is available before the server validates it.

### Week and date controls

- **Week strip:** seven equal columns with a circular cobalt today marker and small dots for dates containing a personal record.
- **Date rail:** horizontally scrollable 68px date tiles. The selected date becomes cobalt with white weekday and number.
- **Segmented control:** two equal 48px controls on a cool-gray track; only the active segment is filled cobalt.

### Agenda and schedule rows

- **Structure:** a bold tabular time column plus a detail column, joined by a divider or subtle inset rule.
- **Content:** title first, then trainer/time/level details; prices align at the row edge when present.
- **Actions:** an available session exposes a green booking action, while a full one exposes an amber waitlist action. Existing or incomplete client record data displays an explanatory status rather than a competing action.

### Status chips

- **Style:** compact, label-bearing 999px chips with 7px by 10px padding.
- **Meaning:** green confirms resolved positive states; amber communicates pending or waitlist. Declined and cancelled states fall back to quiet text on cobalt wash.

### Filters and inputs

- **Style:** two-column outlined filter fields with an 11px muted label and 14px selected value. The date input uses the same divider and a 9px radius.
- **Focus:** `3px` cobalt outline with a `2px` offset.

### Navigation

- **Style:** sticky four-item bottom tab bar with 23px line icons and 11px labels.
- **State:** inactive items are quiet slate; the current route is cobalt and exposes `aria-current="page"`.

## Do's and Don'ts

### Do:

- **Do** lead a schedule view with its date, time, record state, and permitted next action.
- **Do** use the `#234ed8` cobalt selectively for selection, focus, navigation, and the primary action.
- **Do** render the server-provided status label beside its status color and explain partial data with the existing notice pattern.
- **Do** preserve Telegram host chrome, safe-area behavior, and the Telegram-controlled dark theme.
- **Do** reuse the legacy Calendar and existing flows when the user enters their established routes.

### Don't:

- **Don't** turn the schedule into a promotional dashboard, decorative card mosaic, or hero surface.
- **Don't** use green, amber, or cobalt as the only indication of booking, waitlist, or availability state.
- **Don't** replace server-owned availability, price, permission, or lifecycle decisions with client-side assumptions.
- **Don't** introduce a second visual world for legacy routes; scoped blue tokens bridge the modern shell with the existing components.

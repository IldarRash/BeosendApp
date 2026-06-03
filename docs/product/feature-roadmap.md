# Feature roadmap

Decomposition of the BeoSand spec (`init`) into implementable subtasks. Each row has a brief under
`docs/product/features/<slug>.md` with goal, contracts/tables, API, bot flow, acceptance criteria,
tests, and dependencies. Stages follow the spec's own priorities (section 19); the court domain
(Edition 2) and the manager console run alongside.

Spec sections are referenced as **ТЗ §n** (technical spec) and **UX §n** (UX scenario).

## Foundation (F0) — delivered by the monorepo scaffold

pnpm + Turborepo workspace, `packages/config` (env), `packages/types` (contracts + helpers),
`packages/db` (Drizzle schema for all 12 tables + initial migration + seed + Postgres compose),
`apps/api` (Nest skeleton: config, db, `/health`), `apps/bot` (grammY: `/start` → main menu,
typed `ApiClient`). Build/typecheck/lint/test all green. **Status: done.**

## Stage 1 — Training MVP

| # | Slug | Summary | Spec |
| --- | --- | --- | --- |
| T1.1 | `levels-reference` | Levels CRUD + seed | ТЗ §3.2 |
| T1.2 | `trainers-reference` | Trainers CRUD (main/guest) | ТЗ §3.3 |
| T1.3 | `groups-management` | Groups CRUD (capacity, prices, days/time) | ТЗ §3.4 |
| T1.4 | `month-training-generation` | Generate a month of trainings from a group | ТЗ §3.5, §15.1 |
| T1.5 | `available-slots` | Bookable slot list + slot card | ТЗ §5, §8; UX §3 |
| T1.6 | `client-onboarding` | First `/start`: name + level → client | ТЗ §7; UX §1 |
| T1.7 | `main-menu-navigation` | Main menu + back/home routing | ТЗ §6; UX §2 |
| T1.8 | `single-booking` | Book one training, recompute, full | ТЗ §4.1; UX §4–5 |
| T1.9 | `monthly-group-booking` | Book a whole month of a group (batch) | ТЗ §4.2, §15.3; UX §7–9 |
| T1.10 | `my-bookings` | Upcoming / future-group / past | ТЗ §10; UX §10 |
| T1.11 | `booking-cancellation` | Cancel one training or one group date | ТЗ §11; UX §11 |

## Stage 2 — Operations

| # | Slug | Summary | Spec |
| --- | --- | --- | --- |
| T2.1 | `waitlist` | Join when full; promote head on cancel | ТЗ §9; UX §12 |
| T2.2 | `notifications` | Confirm, 24h, 3h, cancel, waitlist-slot | ТЗ §15.4, §16; UX §14 |
| T2.3 | `trainer-today` | Trainer's day + roster + attended/no-show | ТЗ §13; UX §15 |
| T2.4 | `free-slot-broadcasts` | Manager broadcast of free slots, inline book | ТЗ §12; UX §13 |

## Stage 3 — Analytics

| # | Slug | Summary | Spec |
| --- | --- | --- | --- |
| T3.1 | `analytics-reports` | Popular slots, fill rate, trainer load, cancels/no-show, activity, broadcast effectiveness | ТЗ §17 |
| T3.2 | `advanced-filters-segmented-broadcasts` | Filters + segmented broadcasts | ТЗ §19 (stage 3) |

## Manager console (A) — needed from Stage 1

| # | Slug | Summary | Spec |
| --- | --- | --- | --- |
| A1 | `admin-manager-console` | Bot-based manager actions: groups, month generation, trainers, capacity, cancel training, roster, broadcasts, fill overview | ТЗ §14, §15 |

## Court domain — Edition 2 (C)

| # | Slug | Summary | Spec |
| --- | --- | --- | --- |
| C1 | `courts-and-blocks` | 6 courts reference + schema for admin blocks | Ed.2 §general |
| C2 | `court-request-flow` | Client: date→time→duration→RSD preview→submit | Ed.2 client |
| C3 | `court-availability` | 6-per-hour limit; hide occupied hours | Ed.2 logic |
| C4 | `court-moderation` | Admin: see request + free courts → confirm/assign or reject → notify | Ed.2 admin |
| C5 | `court-manual-block` | Admin reserves a court (training/tournament/repair) | Ed.2 admin |
| C6 | `court-load-grid` | Admin per-day grid of court occupancy | Ed.2 admin |

## Cross-cutting open questions (defaults chosen; revisit per feature)

- **Court hours:** spec mentions both 07:00 and 08:00 as the first slot. Default: courts open
  08:00–21:00, last start 20:00 (1 h) / 19:00 (2 h). Constants in `packages/types/src/court-contracts.ts`.
- **Payment:** no online payment in the spec → the bot only displays the RSD price; payment is offline.
- **Roles:** admins/managers via `ADMIN_TELEGRAM_IDS`; trainers via `trainers.telegram_id`.
- **Timezone:** Europe/Belgrade for all dates/times.

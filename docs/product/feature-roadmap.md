# Feature roadmap

Decomposition of the BeoSand spec (`init`) into implementable subtasks. The training MVP, operations,
analytics, the manager console (bot), and the full court domain are **shipped** — they now live in the
code (`apps/api`, `apps/bot`, `packages/*`) and git history rather than in per-feature briefs. The one
active initiative is the **web admin console** (`docs/product/features/admin-console.md`).

Spec sections are referenced as **ТЗ §n** (technical spec) and **UX §n** (UX scenario).

## Shipped

The per-feature briefs for the items below were removed once delivered; the behaviour is recorded in
code + tests. Recent integration commits: `b669375` (training+court integration, waitlist/courts
migrations), `129f0a4` (admin manager console), `3532692` (advanced filters + segmented broadcasts),
`79a07da` (analytics reports), `2c8e2ed` (free-slot broadcasts).

**Foundation (F0).** pnpm + Turborepo workspace, `packages/config` (env), `packages/types`
(contracts + helpers), `packages/db` (Drizzle schema + migrations + seed + Postgres compose),
`apps/api` (Nest skeleton), `apps/bot` (grammY `/start` → main menu, typed `ApiClient`).

**Stage 1 — Training MVP (T1).** levels & trainers reference, groups CRUD, month training generation
(§15.1), bookable slot list + cards (§5), client onboarding (§7), main-menu navigation (§6), single
booking with capacity recompute (§4.1), monthly group booking batch (§4.2, §15.3), my-bookings,
booking cancellation (§11).

**Stage 2 — Operations (T2).** waitlist join + promote-on-cancel (§9), notifications (confirm /
24h / 3h / cancel / waitlist-slot) (§15.4, §16), trainer-today roster + attendance (§13), free-slot
broadcasts with inline booking (§12).

**Stage 3 — Analytics (T3).** analytics reports — popular slots, fill rate, trainer load,
cancellations/no-shows, client activity, broadcast effectiveness (§17); advanced slot filters +
segmented broadcasts (§19).

**Manager console — bot (A1).** Bot-based manager actions: groups, month generation, trainers,
capacity change, cancel training, roster, broadcasts, fill overview (§14, §15).

**Court domain — Edition 2 (C1–C6).** 6 courts + blocks schema (C1); client request flow
date→time→duration→RSD preview→submit (C2); availability math, 6-per-hour limit (C3); admin
moderation confirm/assign or reject + notify (C4); manual court block (C5); per-day court **load grid**
API `GET /courts/load` (C6 — backend shipped; the planned bot text-grid view is superseded by the web
load grid in the admin console).

## Active

| Slug | Summary | Status | Brief |
| --- | --- | --- | --- |
| `admin-console` | Web manager console (`apps/admin`): Telegram-Login-Widget auth seam + router/data layer (M0), schedule & reference (M1), rosters & attendance (M2), courts moderation/blocks/load-grid (M3), broadcasts & analytics dashboard (M4) — a pure interaction layer over the already-shipped admin API | M0–M4 implemented on `feature/admin-console`, full static gate green (476 tests); pending live end-to-end verification | `docs/product/features/admin-console.md` |

## Cross-cutting decisions (settled)

- **Court hours:** open 08:00–21:00, last start 20:00 (1 h) / 19:00 (2 h). Constants in
  `packages/types/src/court-contracts.ts`.
- **Payment:** no online payment; the bot/console only display the RSD price; payment is offline.
- **Roles:** admins/managers via `ADMIN_TELEGRAM_IDS`; trainers via `trainers.telegram_id`. The web
  console adds a verified browser session (Telegram Login Widget) on top of the same admin set.
- **Timezone:** Europe/Belgrade for all dates/times.

## Other docs

- `docs/product/features/local-run.md` — local stack bring-up runbook.
- `docs/product/features/bot-manual-testing-ru.md` — manual QA walkthrough (RU).

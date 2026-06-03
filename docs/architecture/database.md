# Database

Postgres, accessed via Drizzle. Schema lives only in `packages/db/src/schema.ts`; migrations are
generated into `packages/db/drizzle/` and committed with the schema change that produced them.

## Conventions

- UUID primary keys (`uuid().defaultRandom()`).
- Money: integer columns in **RSD** (whole dinars).
- `time` for clock times, `date` for calendar dates, `timestamptz` for instants.
- Enums are Postgres enums mirroring the `packages/types` enums (same values).
- Status columns default to a safe value (`active`, `open`, `pending`, `waiting`).

## Tables (12)

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `levels` | level reference | `name`, `status` |
| `trainers` | trainer reference | `type` (main/guest), `telegram_id?` |
| `clients` | Telegram users | `telegram_id` (unique idx), `telegram_username?`, `level_id?` |
| `groups` | recurring slot | `days_of_week int[]`, `start/end_time`, `capacity`, `price_single_rsd`, `price_month_rsd` |
| `trainings` | dated instance | `group_id?`, `date`, `capacity`, `booked_count`, `status` |
| `bookings` | client ↔ training | `type`, `group_subscription_id?`, `status`, `source` |
| `waitlist` | queue per training | `position`, `status`, `added_at` |
| `notifications` | outbound send log | `type`, `client_id`, `training_id?`, `sent_at` (idempotency/analytics) |
| `broadcasts` | free-slot blasts | `type`, `payload`, `created_by`, `recipients_count` |
| `courts` | the 6 courts | `number`, `status` |
| `court_blocks` | admin reservations | `court_id`, date + time range, `reason` |
| `court_requests` | client time requests | `duration_hours`, `price_rsd`, `status`, `court_id?` (set on confirm) |

## Workflow

```text
edit schema.ts → pnpm --filter @beosand/db db:generate → commit migration
pnpm db:up && pnpm db:migrate && pnpm db:seed   # local
```

`db:seed` is idempotent: inserts levels (Beginner/Intermediate/Advanced), two sample trainers, and
courts 1–6.

## Integrity notes

- `bookings.booked_count` on a training is recomputed in the service inside a transaction on every
  booking/cancel — the row is the authoritative count, never the bot.
- Cancelling a monthly subscription's single date updates one booking; the shared
  `group_subscription_id` keeps the rest intact.
- Court confirmation must verify, in the same transaction, that fewer than `count(active courts)`
  requests are already confirmed for every hour the request covers.

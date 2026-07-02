# Database

Postgres is accessed through Drizzle. The schema lives in `packages/db/src/schema.ts`; migrations live
under `packages/db/drizzle/` and should be committed with the schema change that produced them.

## Conventions

- UUID primary keys with `defaultRandom()` unless a table is intentionally keyed differently.
- Money is stored as integer RSD.
- `date` stores calendar date, `time` stores clock time, and `timestamptz` stores instants.
- Postgres enums mirror stable shared contract enums.
- Status columns default to safe starting values such as `active`, `open`, `pending`, or `waiting`.
- Repositories read/write the DB; services own transactions and invariants.

## Tables

`packages/db/src/schema.ts` currently exports 20 tables:

| Table | Purpose |
| --- | --- |
| `levels` | Level reference data. |
| `trainers` | Trainer reference/actor data, Telegram identity, locale, visibility, calendar feed version. |
| `managers` | Editable admin records used together with `ADMIN_TELEGRAM_IDS`. |
| `clients` | Telegram and walk-in clients, contact fields, locale, consent, bonus credits. |
| `groups` | Recurring group slots with level, trainer, home court, weekdays, time, capacity, prices, visibility. |
| `trainings` | Dated group or individual training instances with capacity, booked count, price, status. |
| `individual_training_requests` | Durable individual-session requests and decision metadata. |
| `bookings` | Client participation, booking type/status/source, subscription link, payment status. |
| `waitlist` | Ordered per-training queue, including monthly-subscription waitlist entries. |
| `broadcasts` | Broadcast audit records. |
| `notifications` | Outbound notification send log. |
| `courts` | Physical court numbers and active/inactive status. |
| `court_blocks` | Manual or generated court reservations by date/time. |
| `court_requests` | Client court-rental requests, price, status, and decision metadata. |
| `court_request_courts` | Composite join table for held/assigned courts on a request. |
| `webhook_endpoints` | Admin-configured outbound webhook endpoints and generated signing secrets. |
| `webhook_deliveries` | Per-attempt webhook delivery log and retry state. |
| `ui_labels` | Editable localized UI label overrides by locale/key. |
| `notification_templates` | Editable localized notification bodies by event key/language. |
| `app_settings` | Operational key/value settings. |

## Integrity notes

- `trainings.booked_count` is recomputed inside booking/cancel flows.
- Waitlist position/status drives promotion and displacement behavior.
- Individual request confirmation creates the final individual training and links it back to the
  request.
- Court availability is derived from active courts, confirmed/pending request holds, court blocks, and
  generated group-training blocks.
- Webhook delivery failures are operational state and must not roll back committed domain writes.

## Workflow

```text
edit schema.ts -> pnpm --filter @beosand/db db:generate -> commit migration
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

`db:seed` is idempotent and should keep reference data aligned with the current schema.

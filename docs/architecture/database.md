# Database

Postgres is accessed through Drizzle. The schema lives in `packages/db/src/schema.ts`; migrations live
under `packages/db/drizzle/` and should be committed with the schema change that produced them.

## Conventions

- UUID primary keys with `defaultRandom()` unless a table is intentionally keyed differently.
- Money is stored as integer RSD.
- `time` stores clock time, `date` stores calendar date, and `timestamptz` stores instants.
- Postgres enums mirror shared contract enums where the value set is stable.
- Status columns default to a safe value such as `active`, `open`, `pending`, or `waiting`.
- Repositories are the only DB access layer; services own transactions and invariants.

## Tables

`packages/db/src/schema.ts` currently exports 20 tables:

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `levels` | Level reference data | `name`, `status` |
| `trainers` | Trainer reference/actor data | `type`, `telegram_id`, `telegram_username`, `language`, `individual_visible`, `calendar_feed_version`, `status` |
| `managers` | Editable manager/admin records | `telegram_id`, `telegram_username`, `language`, `status` |
| `clients` | Telegram and walk-in clients | `telegram_id`, `telegram_username`, `telegram_photo_url`, `level_id`, `source`, `phone`, `email`, `language`, `calendar_feed_version` |
| `groups` | Recurring group slot | `level_id`, `trainer_id`, `court_id`, weekdays, time range, capacity, prices, `hidden`, `status` |
| `trainings` | Dated group or individual session | `group_id`, `trainer_id`, `client_id`, `court_id`, date/time, capacity, `booked_count`, `price_single_rsd`, `status` |
| `individual_training_requests` | Durable individual-training requests | `client_id`, `trainer_id`, date/time, status, `training_id`, decision metadata |
| `bookings` | Client participation in trainings | `client_id`, `training_id`, `type`, `status`, `payment_status`, `group_subscription_id`, `source` |
| `waitlist` | Per-training queue | `client_id`, `training_id`, `position`, `group_subscription_id`, `status`, timestamps |
| `broadcasts` | Broadcast records | `type`, `payload`, `created_by`, `recipients_count` |
| `notifications` | Outbound send log | `type`, `client_id`, `training_id`, `channel`, `sent_at` |
| `courts` | Physical courts | `number`, `status` |
| `court_blocks` | Admin court reservations | `court_id`, date/time range, `reason`, `created_by` |
| `court_requests` | Client court-rental requests | `client_id`, date/time, `duration_hours`, `court_count`, `price_rsd`, status, decision metadata |
| `court_request_courts` | Held/assigned courts for a request | composite `request_id` + `court_id` |
| `webhook_endpoints` | Outbound webhook configuration | `url`, generated `secret`, subscribed events, `created_by`, `status` |
| `webhook_deliveries` | Per-attempt webhook delivery log | `endpoint_id`, `event_type`, signed `payload`, status, attempts, retry metadata |
| `ui_labels` | Editable localized UI labels | `key`, `language`, `value`, `updated_by` |
| `notification_templates` | Editable localized notification templates | `event_key`, `language`, `body`, `updated_by` |
| `app_settings` | Operational key/value settings | `key`, `value`, `updated_by`, `updated_at` |

## Integrity notes

- `trainings.booked_count` is recomputed by services inside transactions after booking/cancel paths.
- Waitlist operations preserve queue position and are the source for promotion/displacement
  notifications.
- Individual requests are persisted first; confirmation creates the final individual training and
  booking and links the request to that training.
- Court availability is derived from active courts, confirmed requests, pending holds, and court
  blocks. Multi-court requests use `court_request_courts`; the older one-request-one-court shape is
  obsolete.
- Connector/webhook delivery failures are operational state and must not roll back committed domain
  writes.

## Workflow

```text
edit schema.ts -> pnpm --filter @beosand/db db:generate -> commit migration
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

`db:seed` is idempotent and should keep reference data aligned with the current schema.

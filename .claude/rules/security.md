# Rule: security

- **Authorization on every write.** Bookings/cancellations act only on the caller's own client
  record (resolved from `telegram_id`). Trainer endpoints require a matching trainer `telegram_id`;
  manager/admin endpoints require membership in `ADMIN_TELEGRAM_IDS`. Enforce in the service, not the
  bot.
- **Validate all input** with Zod at the API boundary. Reject unknown fields; never trust IDs or
  amounts sent from the client side — recompute prices and availability server-side.
- **Court limit is a hard server rule:** never confirm more than the number of active courts for any
  overlapping hour; assignment is admin-only.
- **Secrets** (`TELEGRAM_BOT_TOKEN`, `DATABASE_URL`) come from the environment, validated by
  `packages/config`. Never commit `.env`, log tokens, or echo secrets in errors.
- Keep the runtime DB user least-privileged; the public migration path is for the explicit migrate
  command only.
- Don't leak other users' data: a client never sees rosters, other clients' bookings, or court
  numbers of pending requests.

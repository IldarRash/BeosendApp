---
name: security-review
description: Review a BeoSand change for authorization, input validation, secret handling, and money/availability integrity before it ships. Use on diffs that touch the API, auth, bookings, courts, or config.
---

# Security review

Read the diff against the threat model for a public booking bot.

## Checklist

- **Authorization** - every write resolves and acts on the caller's *own* client (by `telegram_id`).
  Trainer endpoints check trainer `telegram_id`; admin/manager endpoints check `ADMIN_TELEGRAM_IDS`.
  Enforced in the service, not the bot.
- **Input validation** - Zod at the API boundary; unknown fields rejected; IDs and amounts from the
  client are never trusted. Prices and availability are recomputed server-side.
- **Court integrity** - the 6-per-hour confirmation limit is enforced in the service and cannot be
  bypassed; court assignment is admin-only; pending requests never expose a court number to the client.
- **Booking integrity** - no booking onto a `full`/`cancelled` slot; capacity recompute is atomic
  (transaction); cancellation frees exactly one seat and triggers waitlist correctly.
- **Secrets** - no `.env`/token committed or logged; secrets read via `packages/config`; errors don't
  echo secrets.
- **Data exposure** - clients can't read rosters, other clients' bookings, or others' request details.

## Done

Findings listed by severity with file:line and a concrete fix; no critical/high left unaddressed.

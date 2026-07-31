---
name: run-verification
description: Verify BeoSand changes against the local API, bot, database, and admin app while preserving local state.
---

# BeoSand run verification

Use after implementation when the selected global runner needs BeoSand-specific commands and
acceptance evidence.

## Run and verify

1. Start the local stack with `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
2. Start the needed surfaces with `pnpm dev`, or filtered commands such as
   `pnpm --filter @beosand/api dev` and `pnpm --filter @beosand/bot dev`. Use a test
   `TELEGRAM_BOT_TOKEN` for bot verification.
3. Confirm `/health`, the feature's relevant API behavior, and where possible its bot or admin
   journey. Record observed evidence against the feature brief's acceptance criteria.
4. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; use the affected workspace checks
   during iteration when faster.

## Cleanup and blockers

- Stop API, bot, admin, Mini App, or `pnpm dev` processes that you started. Leave the database
  running and never run `pnpm db:down` unless the user explicitly asks.
- Do not commit local artifacts or `.env` files.
- If verification fails, report the exact command, expected and observed result, relevant redacted
  logs, and the next owner. Do not claim a feature works merely because it compiles.

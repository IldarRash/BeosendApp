---
name: railway-diagnostics
description: Diagnose BeoSand Railway incidents with bounded read-only evidence and secret-safe reporting.
---

# BeoSand Railway diagnostics

Use for bot, API, deployment, or production connectivity incidents. Default to read-only evidence;
state-changing Railway commands require explicit user authorization.

## Evidence collection

- Read `docs/deployment/railway.md`, `apps/bot/railway.json`, `apps/bot/Dockerfile`,
  `apps/api/railway.json`, and `packages/config/src/env.ts` first.
- Use explicit selectors. Start with `railway status --json` and `railway service list --json`;
  prefer `production`, `beosand-bot`, and, when relevant, `beosand-api`.
- Use bounded commands only: bot/API deploy or runtime logs (up to 200 lines) and metrics for a
  bounded interval. Never leave a streaming command running.
- Check bot invariants: one replica, no HTTP healthcheck or public domain requirement, start command
  `node apps/bot/dist/index.js`, and Dockerfile `apps/bot/Dockerfile`.
- Inspect the environment contract without exposing values: `TELEGRAM_BOT_TOKEN`,
  `ADMIN_SESSION_SECRET`, `DATABASE_URL`, `API_URL`, `ADMIN_TELEGRAM_IDS`, and `NODE_ENV`.
  Report only present, missing, or malformed status.

## Diagnosis boundaries

- Correlate bot symptoms with `beosand-api` deploy/runtime logs, HTTP errors, metrics, and
  `GET /health` when a public API URL is known.
- Check `loadEnv()` validation, bot-only configuration accidentally requiring the whole contract,
  duplicate long polling (`409 Conflict`), malformed `API_URL`, API failures, migration failures,
  crash loops, and stale Docker output.
- Never run `railway up`, deploy, redeploy, restart, down, scale, variable set/delete, SSH changes,
  or service deletion without explicit authorization. For a needed fix, report its exact command,
  expected effect, and risk.
- Redact tokens, database URLs, session secrets, user identifiers, and private payloads. Do not put
  Railway logs or secret-bearing output in the repository.
- Report commands checked, timestamped redacted evidence, diagnosis, confidence, and the smallest
  corrective action. If Railway is not linked or authenticated, name the blocker and whether
  `railway login` or `railway link` is needed.

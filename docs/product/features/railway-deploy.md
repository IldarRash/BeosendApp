# Feature: Railway deployment (api + bot + admin + Postgres)

## Goal

Ship reproducible deployment artifacts and a runbook to run BeoSand on **Railway** as four
services, mirroring the conventions already proven in the sibling `health_tracer` project:
**one Dockerfile per app, built from the repository root**, with migrations applied on deploy for
the API. This slice produces the artifacts (Dockerfiles, `.dockerignore`, runbook) and verifies them
locally. **Actual Railway provisioning — creating the project, the Postgres plugin, the services,
domains, and setting secret variables — is a human/CLI step** performed against the user's Railway
account and is explicitly out of scope for automation here.

No app source or business logic changes. Telegram stays the interaction layer; the API stays the
domain source of truth. TypeScript stays strict and no secrets are committed (`.env` stays out via
`.dockerignore` and `.gitignore`).

## Services

Four Railway services. The Postgres plugin is a Railway addon (no Dockerfile). Each app service uses
an explicit Dockerfile with the **repo root** as the Docker build context (so pnpm workspace
resolution and `pnpm-lock.yaml` work). BeoSand's `apps/api` and `apps/bot` **compile to `dist/` via
`tsc` and run `node dist/...`** (unlike health_tracer, which runs TS via `@swc-node/register`).
`apps/admin` is a **static Vite SPA** (not Next.js): the build emits `dist/` static assets that are
served with SPA fallback.

| Service        | Railway name      | Dockerfile               | pnpm filter      | Type / runtime                                   | HTTP port?              |
|----------------|-------------------|--------------------------|------------------|--------------------------------------------------|-------------------------|
| PostgreSQL     | (Railway plugin)  | — (Railway addon)        | —                | Managed Postgres 16                              | internal (Railway-provided) |
| API            | `beosand-api`     | `apps/api/Dockerfile`    | `@beosand/api`   | NestJS, compiled → `node dist/main.js`           | yes, binds `PORT` (default 3000); `GET /health` |
| Bot            | `beosand-bot`     | `apps/bot/Dockerfile`    | `@beosand/bot`   | grammY, compiled → `node dist/index.js`          | **no** — long polling, no `EXPOSE`, no HTTP healthcheck |
| Admin          | `beosand-admin`   | `apps/admin/Dockerfile`  | `@beosand/admin` | Static Vite SPA, built `dist/` served with SPA fallback | yes, binds `PORT` |

```text
Telegram ⇄ beosand-bot (long polling) ─┐
                                        ├─→ beosand-api (NestJS) ─→ Railway Postgres
Browser  → beosand-admin (Vite SPA) ───┘
```

The migration tool lives in `@beosand/db` (`pnpm --filter @beosand/db db:migrate` → `tsx src/migrate.ts`,
needs `DATABASE_URL`). It runs as a **release/pre-deploy command on `beosand-api`**, not as its own
long-lived service.

## What each artifact covers

- **`apps/api/Dockerfile`** — multi-stage `node:22-bookworm-slim` + corepack pnpm. `deps` stage copies
  root manifests + every workspace `package.json` and runs `pnpm install --frozen-lockfile --filter @beosand/api...`.
  `build` stage copies the source and runs `pnpm --filter @beosand/api... build` (compiles `@beosand/types`,
  `@beosand/db`, `@beosand/config`, then `apps/api` to `dist/`). Runtime `EXPOSE`s and runs
  `node apps/api/dist/main.js` (via `pnpm --filter @beosand/api start`). Migrations are **not** baked
  into `CMD`; they run as a Railway release command (see migrate strategy).
- **`apps/bot/Dockerfile`** — same base + deps pattern with `--filter @beosand/bot...`. Builds and runs
  `node apps/bot/dist/index.js`. **No `EXPOSE`, no HTTP healthcheck** — the bot is long polling and
  exposes no port. It only needs `TELEGRAM_BOT_TOKEN`, `API_URL`, and the shared env contract.
- **`apps/admin/Dockerfile`** — deps + builder stages bake `VITE_API_URL` and
  `VITE_TELEGRAM_BOT_USERNAME` as build `ARG`→`ENV` **before** `pnpm --filter @beosand/admin build`
  (Vite inlines `VITE_*` at build time). The runtime stage serves the static `dist/` with **SPA
  history fallback** on Railway's `PORT` (e.g. a tiny static server / `serve -s`-equivalent). It must
  **never** import `@beosand/config`.
- **Root `.dockerignore`** — keeps `node_modules`, `dist`, `.turbo`, `.git`, `.env`, logs, `.idea`,
  and coverage out of every build context (the root context is shared by all three Dockerfiles).
- **`docs/deployment/railway.md`** (separate runbook artifact, produced alongside) — step-by-step
  Railway setup, env tables, migrate procedure, verification, logs, rollback, and the human
  follow-ups below.

## Environment mapping

The env contract is `packages/config/src/env.ts` (fail-closed). The browser admin reads only `VITE_*`
from `import.meta.env` and must never load `@beosand/config`.

| Variable                    | api | bot | admin (build arg) | Source on Railway                                   |
|-----------------------------|:---:|:---:|:-----------------:|-----------------------------------------------------|
| `DATABASE_URL`              |  ✅ |  ✅¹|        —          | `${{Postgres.DATABASE_URL}}` (reference the plugin) |
| `TELEGRAM_BOT_TOKEN`        |  ✅ |  ✅ |        —          | Railway secret                                      |
| `ADMIN_SESSION_SECRET`      |  ✅ |  ✅¹|        —          | Railway secret (min 16 chars)                       |
| `API_URL`                   |  ⚪ |  ✅ |        —          | `https://<beosand-api public domain>` (no trailing slash) |
| `PORT`                      |  ✅ |  —  |        ✅         | Railway-injected automatically                      |
| `ADMIN_TELEGRAM_IDS`        |  ✅ |  ✅ |        —          | Comma-separated numeric Telegram IDs                |
| `MANAGER_CONTACT`           |  ✅ |  ✅ |        —          | e.g. `@beosand_manager` (defaulted)                 |
| `WAITLIST_WINDOW_MINUTES`   |  ✅ |  ⚪ |        —          | Optional; defaults to 30                            |
| `NODE_ENV`                  |  ✅ |  ✅ |        —          | `production`                                         |
| `VITE_API_URL`              |  —  |  —  |        ✅         | **Build arg**: `https://<beosand-api public domain>` |
| `VITE_TELEGRAM_BOT_USERNAME`|  —  |  —  |        ✅         | **Build arg**: bot username (no `@`)                |

✅ required · ⚪ optional/defaulted · — not used.
¹ Any process that imports `@beosand/config` validates the **whole** contract, so `ADMIN_SESSION_SECRET`,
`TELEGRAM_BOT_TOKEN` **and `DATABASE_URL`** must be set on the **bot** service too even though the bot
neither mints admin sessions nor queries the DB — `DATABASE_URL` is a required field with no default, so
`loadEnv()` throws at boot if it is missing. (`apps/bot/src/index.ts` calls `loadEnv()`.)

`VITE_*` are **baked at build time**; changing them requires a **rebuild/redeploy** of `beosand-admin`,
not just a restart.

## Migrate strategy

- **Migrate-on-deploy for the API.** Configure a Railway **pre-deploy / release command** on
  `beosand-api`: `pnpm --filter @beosand/db db:migrate` (runs `tsx src/migrate.ts` with the service's
  `DATABASE_URL`). This applies committed Drizzle SQL in `packages/db/drizzle/` before the new API
  release goes live. The `@beosand/db` package and its `tsx`/`drizzle` dev deps are present in the API
  image because the deps stage installs the `@beosand/api...` filter closure (which includes
  `@beosand/db`).
- The bot and admin **never** run migrations.
- Seeds (`pnpm --filter @beosand/db db:seed`) are **manual and idempotent** (`onConflictDoNothing`);
  run once after the first migrate to load reference data (levels, trainers, 6 courts). Not part of
  every deploy.
- Drizzle migrations are **forward-only**; DB rollback is manual (backup before risky schema changes).

## Acceptance criteria

- [ ] Root `.dockerignore` excludes `node_modules`, `dist`, `.turbo`, `.git`, `.env`, logs, `.idea`, coverage.
- [ ] `apps/api/Dockerfile`, `apps/bot/Dockerfile`, `apps/admin/Dockerfile` each build from repo root.
- [ ] API image runs `node dist/main.js`, binds Railway `PORT`, and answers `GET /health` with
      `{"status":"ok","service":"beosand-api"}`.
- [ ] Bot image runs `node dist/index.js`, **exposes no port**, and connects via long polling.
- [ ] Admin image bakes `VITE_API_URL` + `VITE_TELEGRAM_BOT_USERNAME` at build and serves the SPA with
      history fallback on `PORT`.
- [ ] No app source/business logic changed; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` stay green.
- [ ] No secrets committed; `.env` is ignored by Docker and git.
- [ ] Runbook (`docs/deployment/railway.md`) documents the 4 services, env tables, migrate-on-deploy,
      verification, and the human follow-ups.

## Verification (local, no Railway account needed)

```bash
# Build each image from the repo root
docker build -f apps/api/Dockerfile   -t beosand-api .
docker build -f apps/bot/Dockerfile   -t beosand-bot .
docker build -f apps/admin/Dockerfile -t beosand-admin \
  --build-arg VITE_API_URL=http://localhost:3000 \
  --build-arg VITE_TELEGRAM_BOT_USERNAME=beosand_bot .

# API against local Postgres (pnpm db:up)
docker run --rm -p 3000:3000 \
  -e PORT=3000 -e NODE_ENV=production \
  -e DATABASE_URL='postgres://beosand:beosand@host.docker.internal:5432/beosand' \
  -e TELEGRAM_BOT_TOKEN=dummy -e ADMIN_SESSION_SECRET=0123456789abcdef \
  beosand-api
curl -sS http://localhost:3000/health   # {"status":"ok","service":"beosand-api"}

# Admin SPA serves and falls back to index.html on deep links
docker run --rm -p 8080:8080 -e PORT=8080 beosand-admin
curl -sS http://localhost:8080/             # index.html
curl -sS http://localhost:8080/some/route   # index.html (SPA fallback)
```

Full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` (use plain
`pnpm` for the cross-workspace gate).

## Human follow-ups (outside this repo / require the user's account)

- Create the Railway project, add the **Postgres plugin**, and create the three app services from the
  GitHub repo with Dockerfile builder + the paths above; set watch paths (`apps/<svc>/**`, `packages/**`).
- Set all secret variables (`TELEGRAM_BOT_TOKEN`, `ADMIN_SESSION_SECRET`, DB reference) in Railway
  Variables; set the admin `VITE_*` build args **before** its first build.
- Assign public domains to `beosand-api` and `beosand-admin`; wire `API_URL` (bot) and `VITE_API_URL`
  (admin build) to the API domain.
- Configure the API pre-deploy/release command for `db:migrate`; run `db:seed` once manually.
- **CORS:** `apps/api/src/main.ts` currently disables browser CORS when `NODE_ENV=production`
  (`origin: false`), pending the admin-auth feature. The browser admin will be blocked from calling the
  API in production until that origin allowlist ships — flag for the user; do **not** change source as
  part of this deploy slice.
- The bot must run a **single** instance (long polling); do not scale `beosand-bot` beyond one replica
  or Telegram will reject concurrent `getUpdates`.

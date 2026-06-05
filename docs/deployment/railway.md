# Railway Deployment

Deploy BeoSand to [Railway](https://railway.com/) as five services from this monorepo. Each app
service uses an explicit **Dockerfile** with the **repository root** as the Docker build context, so
pnpm workspace resolution and `pnpm-lock.yaml` work. This mirrors the convention proven in the sibling
`health_tracer` project, adapted to BeoSand's differences:

- `apps/api` and `apps/bot` **compile to `dist/` via `tsc`** and run `node dist/...` (not TS-on-the-fly).
- `apps/bot` is a **long-polling worker** — no HTTP port, no `EXPOSE`, no healthcheck.
- `apps/admin` is a **static Vite SPA** (not Next.js) — the build emits static `dist/` served with SPA
  history fallback.
- `apps/miniapp` is a **static Vite Telegram Mini App** served the same way as admin, with only
  `VITE_API_URL` baked into the browser bundle.

Service config is committed as per-service `railway.json` files (`apps/<svc>/railway.json`). When a
service's **Root Directory** is set to that app folder, Railway auto-discovers its `railway.json`.
Every value in those files is also listed below as a dashboard checklist in case you configure by hand.

## Architecture

| Service     | Railway name      | Dockerfile               | Type / runtime                                          | HTTP port?                          |
|-------------|-------------------|--------------------------|--------------------------------------------------------|-------------------------------------|
| PostgreSQL  | (Railway plugin)  | — (managed addon)        | Managed Postgres 16                                    | internal (Railway-provided)         |
| API         | `beosand-api`     | `apps/api/Dockerfile`    | NestJS, compiled → `node apps/api/dist/main.js`        | yes — binds `PORT` (default 3000); `GET /health` |
| Bot         | `beosand-bot`     | `apps/bot/Dockerfile`    | grammY, compiled → `node apps/bot/dist/index.js`       | **no** — long polling, no `EXPOSE`, no healthcheck |
| Admin       | `beosand-admin`   | `apps/admin/Dockerfile`  | Static Vite SPA, `serve -s apps/admin/dist`            | yes — static server binds `PORT`    |
| Mini App    | `beosand-miniapp` | `apps/miniapp/Dockerfile`| Static Vite SPA, `serve -s apps/miniapp/dist`          | yes — static server binds `PORT`    |

```text
Telegram ⇄ beosand-bot (long polling) ─┐
                                        ├─→ beosand-api (NestJS) ─→ Railway Postgres
Browser  → beosand-admin (Vite SPA) ───┘
Telegram Mini App → beosand-miniapp ────┘
```

## Prerequisites

- Railway account and CLI (`npm i -g @railway/cli` — see [Railway docs](https://docs.railway.com/)).
- A Telegram bot from [@BotFather](https://t.me/BotFather): the **bot token** and the **bot username**.
- GitHub repo connected to Railway (recommended — enables auto-deploy on push to `main`).
- A strong `ADMIN_SESSION_SECRET` (min 16 chars; e.g. `openssl rand -hex 32`).
- The numeric Telegram IDs of admins for `ADMIN_TELEGRAM_IDS` (comma-separated).

## Env contract (source of truth)

The fail-closed contract is `packages/config/src/env.ts`. Any process that imports `@beosand/config`
validates the **whole** contract at boot, so missing/invalid vars crash the service immediately.

| Variable                     | api | bot | admin (build arg) | miniapp (build arg) | Source on Railway                                          |
|------------------------------|:---:|:---:|:-----------------:|:-------------------:|------------------------------------------------------------|
| `DATABASE_URL`               |  ✅ |  ✅³|        —          |          —          | `${{Postgres.DATABASE_URL}}` (reference the plugin)        |
| `TELEGRAM_BOT_TOKEN`         |  ✅ |  ✅ |        —          |          —          | Railway secret (from BotFather)                            |
| `ADMIN_SESSION_SECRET`       |  ✅ |  ✅¹|        —          |          —          | Railway secret, min 16 chars                               |
| `API_URL`                    |  ⚪ |  ✅ |        —          |          —          | `https://<beosand-api public domain>` (no trailing slash)  |
| `PORT`                       |  ✅ |  —  |        ✅²        |         ✅²         | Railway-injected automatically                             |
| `ADMIN_TELEGRAM_IDS`         |  ✅ |  ✅ |        —          |          —          | Comma-separated numeric Telegram IDs                       |
| `MANAGER_CONTACT`            |  ⚪ |  ⚪ |        —          |          —          | e.g. `@beosand_manager`                                    |
| `WAITLIST_WINDOW_MINUTES`    |  ⚪ |  ⚪ |        —          |          —          | Optional; defaults to 30                                   |
| `NODE_ENV`                   |  ✅ |  ✅ |        —          |          —          | `production`                                               |
| `VITE_API_URL`               |  —  |  —  |        ✅         |          ✅         | **Build arg**: `https://<beosand-api public domain>`       |
| `VITE_TELEGRAM_BOT_USERNAME` |  —  |  —  |        ✅         |          —          | **Build arg**: bot username, no leading `@`                |

✅ required · ⚪ optional/defaulted · — not used.
¹ The bot imports `@beosand/config` (`apps/bot/src/index.ts` calls `loadEnv()`), which validates the
whole contract — so `ADMIN_SESSION_SECRET` and `TELEGRAM_BOT_TOKEN` must be set on the **bot** service
too, or it crashes at boot.
² `PORT` for admin and miniapp is consumed by the static server (`serve -l ${PORT}`), not by app code.
³ The bot never queries the DB, but `loadEnv()` validates the **whole** contract, and `DATABASE_URL`
is required with no default — so the bot service must still have `DATABASE_URL` set (point it at the
same `${{Postgres.DATABASE_URL}}`) or it crashes at boot.

`VITE_*` are **inlined into the bundle at build time** — changing them requires a **rebuild/redeploy**
of `beosand-admin` / `beosand-miniapp`, not just a restart. Browser apps must **never** import
`@beosand/config`.

## Local Docker build (optional, no Railway account needed)

From the repo root:

```bash
docker build -f apps/api/Dockerfile   -t beosand-api .
docker build -f apps/bot/Dockerfile   -t beosand-bot .
docker build -f apps/admin/Dockerfile -t beosand-admin \
  --build-arg VITE_API_URL=http://localhost:3000 \
  --build-arg VITE_TELEGRAM_BOT_USERNAME=beosand_bot .
docker build -f apps/miniapp/Dockerfile -t beosand-miniapp \
  --build-arg VITE_API_URL=http://localhost:3000 .
```

Run locally (start local Postgres first with `pnpm db:up`):

```bash
# API against local Postgres
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

# Mini App SPA serves and falls back to index.html on deep links
docker run --rm -p 8081:8081 -e PORT=8081 beosand-miniapp
curl -sS http://localhost:8081/             # index.html
curl -sS http://localhost:8081/some/route   # index.html (SPA fallback)
```

## Railway project setup

### 1. Create project and Postgres plugin

1. Create a new Railway project.
2. **+ New → Database → Add PostgreSQL.** This provisions the managed Postgres and exposes
   `${{Postgres.DATABASE_URL}}` as a referenceable variable.
3. No Dockerfile, migrations, or seeds for this service — it is a managed addon.

### 2. Deploy `beosand-api`

Create a service from the GitHub repo.

| Setting               | Value                                                  |
|-----------------------|--------------------------------------------------------|
| Service name          | `beosand-api`                                          |
| Root directory        | `apps/api` (lets Railway auto-discover `railway.json`) |
| Builder               | Dockerfile                                             |
| Dockerfile path       | `apps/api/Dockerfile`                                  |
| Watch paths           | `apps/api/**`, `packages/**`                           |
| Start command         | `node apps/api/dist/main.js`                           |
| **Pre-deploy command**| `pnpm --filter @beosand/db db:migrate`                |
| Healthcheck path      | `/health`                                              |
| Restart policy        | On failure (max 10 retries)                            |

> **Build context is the repo root.** Even with Root Directory `apps/api`, the Dockerfile is written
> to build from the repo root (it copies `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and every workspace
> manifest). Railway uses the repo root as the Docker context for monorepo Dockerfile builds.

> **Migrate-on-deploy.** The committed `railway.json` sets the **pre-deploy command** to
> `pnpm --filter @beosand/db db:migrate` and the **start command** to `node apps/api/dist/main.js`.
> The pre-deploy command runs in the built image (which retains `@beosand/db`, `tsx`, and the
> `packages/db/drizzle/` SQL) **before** the new release goes live, applying pending Drizzle SQL once
> per deploy — not on every container restart. (The Dockerfile's `CMD` chains migrate + start as a
> fallback for plain `docker run`; the Railway start command overrides it so migration is not coupled
> to the long-running process.)

**Environment variables** (`beosand-api`):

| Variable                  | Value                                  |
|---------------------------|----------------------------------------|
| `DATABASE_URL`            | `${{Postgres.DATABASE_URL}}`           |
| `TELEGRAM_BOT_TOKEN`      | BotFather token (secret)               |
| `ADMIN_SESSION_SECRET`    | random ≥16-char secret                 |
| `ADMIN_TELEGRAM_IDS`      | e.g. `111111111,222222222`             |
| `NODE_ENV`                | `production`                           |
| `MANAGER_CONTACT`         | e.g. `@beosand_manager` (optional)     |
| `WAITLIST_WINDOW_MINUTES` | e.g. `30` (optional)                   |
| `PORT`                    | (Railway injects automatically)        |

**Generate a public domain** for `beosand-api` (Settings → Networking → Generate Domain). Record it as
`https://<beosand-api>.up.railway.app` — the bot and admin both point at it.

**Verify:**

```bash
curl -sS https://<beosand-api-domain>/health
# Expected: {"status":"ok","service":"beosand-api"}
```

### 3. Seed reference data (one-time, manual)

After the first successful migrate, load reference data once (levels, trainers, the 6 courts). Seeds
are idempotent (`onConflictDoNothing`). Do **not** add this to every deploy.

```bash
railway run --service beosand-api pnpm --filter @beosand/db db:seed
```

(Or run locally with the production `DATABASE_URL` exported into the environment.)

### 4. Deploy `beosand-bot`

Create a second service from the same repo.

| Setting          | Value                          |
|------------------|--------------------------------|
| Service name     | `beosand-bot`                  |
| Root directory   | `apps/bot`                     |
| Builder          | Dockerfile                     |
| Dockerfile path  | `apps/bot/Dockerfile`          |
| Watch paths      | `apps/bot/**`, `packages/**`   |
| Start command    | `node apps/bot/dist/index.js`  |
| Healthcheck      | **none** (long-polling worker) |
| Replicas         | **1** (see warning below)      |
| Restart policy   | On failure (max 10 retries)    |

> **Single replica only.** The bot uses Telegram long polling (`getUpdates`). Running more than one
> replica makes Telegram reject concurrent polling. Do **not** scale `beosand-bot` past one instance.
> The committed `railway.json` pins `numReplicas: 1`.

> **No public domain / no healthcheck.** The bot exposes no HTTP port. Do not generate a domain and do
> not set a healthcheck path; Railway would mark a port-less service unhealthy.

**Environment variables** (`beosand-bot`):

| Variable               | Value                                            |
|------------------------|--------------------------------------------------|
| `TELEGRAM_BOT_TOKEN`   | same BotFather token as the API (secret)         |
| `ADMIN_SESSION_SECRET` | same ≥16-char secret (required by `loadEnv()`)   |
| `DATABASE_URL`         | `${{Postgres.DATABASE_URL}}` (validated by `loadEnv()`, never queried) |
| `API_URL`              | `https://<beosand-api-domain>` (no trailing slash) |
| `ADMIN_TELEGRAM_IDS`   | same list as the API                             |
| `NODE_ENV`             | `production`                                      |
| `MANAGER_CONTACT`      | optional                                          |

The bot never queries the database, but `loadEnv()` validates the whole fail-closed contract at boot
and `DATABASE_URL` is required with no default — so it must still be set on the bot service.

### 5. Deploy `beosand-admin`

Create a third service from the same repo.

| Setting          | Value                                       |
|------------------|---------------------------------------------|
| Service name     | `beosand-admin`                             |
| Root directory   | `apps/admin`                                |
| Builder          | Dockerfile                                  |
| Dockerfile path  | `apps/admin/Dockerfile`                     |
| Watch paths      | `apps/admin/**`, `packages/**`              |
| Start command    | `serve -s apps/admin/dist -l ${PORT:-3000}` |
| Restart policy   | On failure (max 10 retries)                 |

**Build args** (Variables → set as **build-time**; Railway exposes service variables to Docker builds,
and the Dockerfile reads them via `ARG`→`ENV` before `vite build`):

| Build arg                    | Value                                        |
|------------------------------|----------------------------------------------|
| `VITE_API_URL`               | `https://<beosand-api-domain>` (no trailing slash) |
| `VITE_TELEGRAM_BOT_USERNAME` | bot username from BotFather, **no** leading `@`     |

> `VITE_*` are inlined at build time. Set them **before** the first build. After changing either value,
> trigger a **rebuild/redeploy** of `beosand-admin` — a restart will not pick up new values.

**Runtime env:** none required (the admin needs no secrets at runtime; `VITE_*` are already baked).

**Generate a public domain** for `beosand-admin` and open it in a browser.

### 6. Deploy `beosand-miniapp`

Create another service from the same repo.

| Setting          | Value                                          |
|------------------|------------------------------------------------|
| Service name     | `beosand-miniapp`                              |
| Root directory   | `apps/miniapp`                                 |
| Builder          | Dockerfile                                     |
| Dockerfile path  | `apps/miniapp/Dockerfile`                      |
| Watch paths      | `apps/miniapp/**`, `packages/**`               |
| Start command    | `serve -s apps/miniapp/dist -l ${PORT:-3000}`  |
| Restart policy   | On failure (max 10 retries)                    |

**Build args** (Variables → set as **build-time** before the first build):

| Build arg      | Value                                               |
|----------------|-----------------------------------------------------|
| `VITE_API_URL` | `https://<beosand-api-domain>` (no trailing slash)  |

> `VITE_API_URL` is inlined at build time. After changing it, trigger a
> **rebuild/redeploy** of `beosand-miniapp` — a restart will not pick up the new API URL.

**Runtime env:** none required (the Mini App needs no secrets at runtime; `VITE_API_URL` is baked).

**Generate a public domain** for `beosand-miniapp` and open it in a browser. Use this HTTPS URL when
configuring the Telegram Mini App entrypoint in BotFather.

### 7. BotFather domain for Telegram Login (admin console)

The admin login page uses the **Telegram Login Widget** (`VITE_TELEGRAM_BOT_USERNAME`). Telegram only
renders the widget on a domain you have authorized for the bot:

1. Open [@BotFather](https://t.me/BotFather) → `/setdomain`.
2. Select your bot, then send the admin public domain (e.g. `beosand-admin.up.railway.app`).

Without this, the Telegram login button on the admin will not appear / will reject the callback.

### 8. BotFather Mini App URL

Telegram Mini Apps must be served over HTTPS. After `beosand-miniapp` has a public Railway domain,
configure the bot's Mini App URL in [@BotFather](https://t.me/BotFather) (for example, via
`/newapp` or `/myapps`, depending on whether the Mini App already exists) with the
`https://<beosand-miniapp-domain>` URL.

## Auto-deploy & CI

- **CI** (`.github/workflows/ci.yml`) runs on every PR and on push to `main`: install (frozen
  lockfile), then `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- **Auto-deploy** is configured in the Railway dashboard: connect each service to the GitHub repo and
  enable deploy on push to `main`. Watch paths scope rebuilds so only the affected service redeploys
  (`apps/<svc>/**` + shared `packages/**`). CI and Railway deploys are independent; keep `main` green.

## Known caveat: production CORS blocks browser apps

`apps/api/src/main.ts` sets `origin: false` when `NODE_ENV=production`, so the API rejects
cross-origin browser requests in production. The browser admin (`beosand-admin`) and Telegram Mini App
(`beosand-miniapp`) will therefore be **unable to call the API** until the admin-auth/CORS feature
ships an origin allowlist. This is a known, documented follow-up — **do not change the API source as
part of deployment**. Options until then:

- Run the browser apps only against a non-production API, or
- Ship the admin-auth/CORS-allowlist feature, then set the admin and Mini App domains as allowed origins.

The bot is unaffected (server-to-server calls, no browser CORS).

## Rollback

1. Open the affected service in Railway → **Deployments**.
2. Select a previous successful deployment → **Redeploy** (or use Railway rollback).
3. Roll back `beosand-api`, `beosand-bot`, `beosand-admin`, and `beosand-miniapp` **independently**.
4. **Database rollbacks are not automatic.** Drizzle migrations are forward-only. Take a Postgres
   backup before risky schema changes and plan manual down migrations.

## Troubleshooting

| Symptom                                         | Likely cause / fix                                                             |
|-------------------------------------------------|--------------------------------------------------------------------------------|
| API crashes on start                            | Missing/invalid env (`DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ADMIN_SESSION_SECRET` <16 chars) — `loadEnv()` is fail-closed |
| `GET /health` 502 / no response                 | API not listening on `PORT`, or healthcheck path wrong (must be `/health`)      |
| Pre-deploy fails on `db:migrate`                | Wrong `DATABASE_URL`, Postgres not reachable, or migration order conflict       |
| Bot boots then exits                            | `loadEnv()` rejected env — set `TELEGRAM_BOT_TOKEN` **and** `ADMIN_SESSION_SECRET` on the bot too |
| Bot: `409 Conflict` / duplicate `getUpdates`    | More than one bot replica polling — scale `beosand-bot` to exactly 1            |
| Bot can't reach API                             | `API_URL` wrong or has a trailing slash; must be the API public domain          |
| Admin / Mini App shows wrong API URL            | Stale build; `VITE_API_URL` is baked at build — **rebuild** the browser service |
| Admin / Mini App deep-link 404 on refresh       | SPA fallback missing — start command must be `serve -s ...` (`-s` = SPA mode)    |
| Telegram login button missing on admin          | Run BotFather `/setdomain` with the admin public domain                         |
| Mini App URL rejected by Telegram               | Use the HTTPS `beosand-miniapp` public domain when configuring BotFather         |
| Browser app loads but API calls fail (CORS)     | Expected in production until admin-auth/CORS ships (`origin:false`) — see caveat |

## Per-service dashboard checklist

Mirror of the committed `railway.json` files, for hand configuration.

**Postgres plugin**
- [ ] Add PostgreSQL database (managed addon); note `${{Postgres.DATABASE_URL}}`.

**beosand-api** (`apps/api/railway.json`)
- [ ] Root directory `apps/api`; Builder Dockerfile; Dockerfile path `apps/api/Dockerfile`.
- [ ] Watch paths `apps/api/**`, `packages/**`.
- [ ] Start command `node apps/api/dist/main.js`.
- [ ] Pre-deploy command `pnpm --filter @beosand/db db:migrate`.
- [ ] Healthcheck path `/health`; restart On failure.
- [ ] Env: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `TELEGRAM_BOT_TOKEN`, `ADMIN_SESSION_SECRET`, `ADMIN_TELEGRAM_IDS`, `NODE_ENV=production` (+ optional `MANAGER_CONTACT`, `WAITLIST_WINDOW_MINUTES`).
- [ ] Generate public domain.
- [ ] Seed once: `railway run --service beosand-api pnpm --filter @beosand/db db:seed`.

**beosand-bot** (`apps/bot/railway.json`)
- [ ] Root directory `apps/bot`; Builder Dockerfile; Dockerfile path `apps/bot/Dockerfile`.
- [ ] Watch paths `apps/bot/**`, `packages/**`.
- [ ] Start command `node apps/bot/dist/index.js`.
- [ ] **No healthcheck, no public domain.** Replicas = 1; restart On failure.
- [ ] Env: `TELEGRAM_BOT_TOKEN`, `ADMIN_SESSION_SECRET`, `DATABASE_URL=${{Postgres.DATABASE_URL}}` (validated by `loadEnv()`, never queried), `API_URL=https://<beosand-api domain>`, `ADMIN_TELEGRAM_IDS`, `NODE_ENV=production` (+ optional `MANAGER_CONTACT`).

**beosand-admin** (`apps/admin/railway.json`)
- [ ] Root directory `apps/admin`; Builder Dockerfile; Dockerfile path `apps/admin/Dockerfile`.
- [ ] Watch paths `apps/admin/**`, `packages/**`.
- [ ] Start command `serve -s apps/admin/dist -l ${PORT:-3000}`; restart On failure.
- [ ] Build args `VITE_API_URL=https://<beosand-api domain>`, `VITE_TELEGRAM_BOT_USERNAME=<bot username, no @>`.
- [ ] Generate public domain; rebuild after any `VITE_*` change.
- [ ] BotFather `/setdomain` → admin public domain (Telegram Login).

**beosand-miniapp** (`apps/miniapp/railway.json`)
- [ ] Root directory `apps/miniapp`; Builder Dockerfile; Dockerfile path `apps/miniapp/Dockerfile`.
- [ ] Watch paths `apps/miniapp/**`, `packages/**`.
- [ ] Start command `serve -s apps/miniapp/dist -l ${PORT:-3000}`; restart On failure.
- [ ] Build arg `VITE_API_URL=https://<beosand-api domain>`.
- [ ] Generate public domain; rebuild after any `VITE_API_URL` change.
- [ ] BotFather Mini App URL → miniapp public domain.

## What stays outside this repo

- Railway project/service creation, domain assignment, and secret variable values.
- BotFather token, `/setdomain`, and Mini App URL configuration.
- The admin-auth/CORS-allowlist feature that unblocks browser apps in production.
- Optional staging environment (`staging` vs `production` Railway environments).

See also: root `package.json` scripts (`db:migrate`, `db:seed`), `packages/config/src/env.ts` (env
contract), and the per-service Dockerfiles under `apps/*/Dockerfile`.

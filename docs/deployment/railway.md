# Railway deployment

BeoSand deploys to Railway as managed Postgres plus four app services from this monorepo. Each app
service uses its committed Dockerfile and `apps/<service>/railway.json`.

## Architecture

| Service | Runtime | Railway config |
| --- | --- | --- |
| Postgres | Railway managed PostgreSQL | plugin/addon |
| `beosand-api` | NestJS API, compiled to `node apps/api/dist/main.js` | `apps/api/railway.json` |
| `beosand-bot` | grammY long-polling worker, compiled to `node apps/bot/dist/index.js` | `apps/bot/railway.json` |
| `beosand-admin` | Static Vite SPA served from `apps/admin/dist` | `apps/admin/railway.json` |
| `beosand-miniapp` | Static Vite Telegram Mini App served from `apps/miniapp/dist` | `apps/miniapp/railway.json` |

```text
Telegram <-> beosand-bot -> beosand-api -> Railway Postgres
Browser  -> beosand-admin --------^
Telegram -> beosand-miniapp ------^
```

The bot has no HTTP port, no public domain, and must run as exactly one replica because Telegram long
polling rejects concurrent `getUpdates` consumers.

## Environment contract

The server-side contract is `packages/config/src/env.ts`. It fails closed at startup when a required
or malformed value is missing. The bot imports the same contract, so it also needs values that it only
validates, such as `DATABASE_URL` and `ADMIN_SESSION_SECRET`.

Required for API and bot:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `TELEGRAM_BOT_TOKEN` | BotFather token |
| `ADMIN_SESSION_SECRET` | Random secret, at least 16 chars |
| `ADMIN_TELEGRAM_IDS` | Comma-separated numeric Telegram admin IDs, or blank if DB managers cover access |

Common API/bot options:

| Variable | Use |
| --- | --- |
| `API_URL` | Public API URL for the bot, no trailing slash |
| `MANAGER_CONTACT` | Bot contact text/handle; defaults to `@beosand_manager` |
| `ADMIN_URL` | Admin public URL for operational deep links |
| `MINIAPP_URL` | HTTPS Mini App URL used by bot menu/web app buttons |
| `ADMIN_ALLOWED_ORIGINS` | Comma-separated admin browser origins allowed by API CORS |
| `MINIAPP_ALLOWED_ORIGINS` | Comma-separated Mini App origins allowed by API CORS |

Optional connector env is also defined in `packages/config/src/env.ts`: calendar feed secret/public
base URL, Google service-account data, email provider credentials, Twilio credentials, webhook retry
limit, and Google Sheets ID. A half-configured email provider fails startup.

Browser build-time values:

| Service | Build vars |
| --- | --- |
| Admin | `VITE_API_URL`, `VITE_TELEGRAM_BOT_USERNAME` |
| Mini App | `VITE_API_URL` |

`VITE_*` values are baked into the static bundle. Rebuild/redeploy the browser service after changing
them. Never put secrets in browser env.

## Deploy flow

1. Create a Railway project and add a PostgreSQL plugin.
2. Create `beosand-api` from the repo. Use Dockerfile builder and config file
   `/apps/api/railway.json`. Set server env, then generate a public API domain.
3. Create `beosand-bot` with `/apps/bot/railway.json`. Set one replica, no healthcheck, no public
   domain. Set `API_URL` to the public API domain.
4. Create `beosand-admin` with `/apps/admin/railway.json`. Set build vars before the first build and
   generate a public domain.
5. Create `beosand-miniapp` with `/apps/miniapp/railway.json`. Set `VITE_API_URL`, generate a public
   HTTPS domain, and use it for Telegram Mini App setup.
6. Set API CORS origins: admin domain in `ADMIN_ALLOWED_ORIGINS`, Mini App domain in
   `MINIAPP_ALLOWED_ORIGINS`.

The committed `railway.json` files define Dockerfile paths, watch patterns, start commands, restart
policy, and the API healthcheck. The API config also runs
`pnpm --filter @beosand/db db:migrate` as a pre-deploy command before the new release goes live.

## Migrations and seed

API deploys run Drizzle migrations through the Railway pre-deploy command. To migrate manually from a
local PowerShell session, use the Postgres service's public URL:

```powershell
$vars = railway variable list --service Postgres --environment production --kv
$public = ($vars | Where-Object { $_ -match '^DATABASE_PUBLIC_URL=' } | Select-Object -First 1)
$env:DATABASE_URL = $public.Substring('DATABASE_PUBLIC_URL='.Length)
pnpm --filter @beosand/db db:migrate
Remove-Item Env:\DATABASE_URL
```

After the first successful migrate, seed reference data once. The seed is idempotent, but it should
not run on every deploy:

```powershell
$vars = railway variable list --service Postgres --environment production --kv
$public = ($vars | Where-Object { $_ -match '^DATABASE_PUBLIC_URL=' } | Select-Object -First 1)
$env:DATABASE_URL = $public.Substring('DATABASE_PUBLIC_URL='.Length)
pnpm --filter @beosand/db db:seed
Remove-Item Env:\DATABASE_URL
```

Do not use the private `postgres.railway.internal` URL from a local shell; it only resolves inside
Railway.

## BotFather setup

- Create the bot and copy `TELEGRAM_BOT_TOKEN`.
- For admin login, run `/setdomain` and authorize the admin public domain for the bot username used
  in `VITE_TELEGRAM_BOT_USERNAME`.
- Configure the Mini App URL in BotFather with the HTTPS `beosand-miniapp` Railway domain.
- If the bot menu/web-app buttons should open the Mini App, set `MINIAPP_URL` on the bot/API services
  as needed by the running flow.

## Rollback

1. In Railway, open the affected service and redeploy a previous successful deployment.
2. Roll back API, bot, admin, and Mini App independently.
3. Database migrations are forward-only. Take a Postgres backup before risky schema changes and plan
   manual recovery for destructive migrations.

## Troubleshooting

| Symptom | Likely fix |
| --- | --- |
| API crashes immediately | Check `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `ADMIN_SESSION_SECRET`, and malformed optional URLs. |
| `/health` fails | API is not listening on `PORT` or healthcheck path is not `/health`. |
| Pre-deploy migration fails | Check Postgres reachability and migration order. |
| Bot exits at startup | The shared env contract rejected a missing value; include `DATABASE_URL` and `ADMIN_SESSION_SECRET`. |
| Bot reports duplicate polling | Scale `beosand-bot` back to one replica. |
| Bot cannot reach API | Fix `API_URL`; use the public API domain with no trailing slash. |
| Admin/Mini App calls blocked by CORS | Add their origins to `ADMIN_ALLOWED_ORIGINS` / `MINIAPP_ALLOWED_ORIGINS` and redeploy API. |
| Browser app uses an old API URL | Rebuild the static service; `VITE_API_URL` is baked at build time. |
| Admin Telegram login fails | Run BotFather `/setdomain` for the admin public domain. |
| Mini App rejected by Telegram | Use the HTTPS Mini App public domain in BotFather. |

Secrets, Railway project creation, service domains, and BotFather configuration stay outside the repo.

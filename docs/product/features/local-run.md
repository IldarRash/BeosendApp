# Feature: local run (bring the whole stack up)

Runbook for booting the full BeoSand stack locally — Postgres + `apps/api` + `apps/bot` + `apps/admin`
— and verifying it actually serves real data. Captures the gotchas found on the first live run
(2026-06-04).

## Goal

`pnpm`/Docker on the machine → a running API (`:3000`), Telegram bot (long polling), admin SPA
(`:5173`), and a migrated + seeded Postgres, with end-to-end reads working (not just "it compiles").

## Prerequisites

- Docker (for Postgres), Node 24, pnpm 11.8.0.
- A real `TELEGRAM_BOT_TOKEN` from @BotFather (the bot can't long-poll without it; the API/admin can
  boot with a placeholder).
- Free port `5432` (stop any other local Postgres first).

## Environment

No app loads a `.env` file automatically — `@beosand/config` `loadEnv()` reads `process.env`. So either
export the vars or `source` the file into each process.

Create `.env` at the repo root (gitignored — never commit it):

```
DATABASE_URL=postgres://beosand:beosand@localhost:5432/beosand
TELEGRAM_BOT_TOKEN=<real token from @BotFather>
API_URL=http://localhost:3000
PORT=3000
ADMIN_TELEGRAM_IDS=<your numeric Telegram id(s), comma-separated>
```

Create `apps/admin/.env` (Vite auto-loads it; only `VITE_*` reaches the browser):

```
VITE_API_URL=http://localhost:3000
```

> `ADMIN_TELEGRAM_IDS` empty ⇒ every admin/manager action (manager menu, court moderation,
> `GET /courts`, analytics) returns 403. Put your own numeric id here to exercise the admin flows.

## Bring-up steps

```bash
# 1. Postgres
docker compose up -d postgres
# wait until healthy: docker exec beosand-postgres pg_isready -U beosand -d beosand

# 2. Migrate + seed (env inline so it doesn't depend on dotenv)
cd packages/db
DATABASE_URL=postgres://beosand:beosand@localhost:5432/beosand \
TELEGRAM_BOT_TOKEN=x ../../node_modules/.bin/tsx src/migrate.ts
DATABASE_URL=postgres://beosand:beosand@localhost:5432/beosand \
TELEGRAM_BOT_TOKEN=x ../../node_modules/.bin/tsx src/seed.ts
# => migrations 0000,0001,0002 applied; seeds 3 levels, 2 trainers, 6 courts

# 3. API — `pnpm dev` now runs it via `nest start --watch` (DI-correct); env via source
cd ../../apps/api
set -a; source ../../.env; set +a
../../node_modules/.bin/nest start --watch   # API on :3000
# Fallback (no nest CLI): ../../node_modules/.bin/tsc -p tsconfig.json && node dist/main.js

# 4. Bot — tsx is fine here (no decorator DI)
cd ../bot
set -a; source ../../.env; set +a
../../node_modules/.bin/tsx watch src/index.ts

# 5. Admin — vite bin is package-local under pnpm
cd ../admin
./node_modules/.bin/vite --host        # admin on :5173
```

## Gotchas found on first live run

1. **NestJS DI breaks under `tsx` — fixed by switching the dev script to the Nest CLI.** The old
   `apps/api` `dev` script was `tsx watch src/main.ts`, but tsx uses esbuild, which does **not** emit
   `emitDecoratorMetadata`. Without it Nest injects `undefined` for every constructor param: controllers
   map fine and the app "starts", but the first request throws 500 (`Cannot read properties of undefined
   (reading 'listActive')`) and the schedulers error (`sendDueReminders` / `sweepExpired`).
   **Resolved:** added `@nestjs/cli` (devDep) + `apps/api/nest-cli.json` and changed the dev script to
   `nest start --watch`, which compiles via tsc and inherits `emitDecoratorMetadata` from
   `tsconfig.base.json`. `pnpm dev` now boots the API DI-correctly. Fallback if the Nest CLI is
   unavailable: `tsc -p tsconfig.json` then `node dist/main.js` (the tsc build was always correct). The
   bot and admin dev scripts are unaffected.
2. **`vite` not on root PATH.** Under pnpm the binary is `apps/admin/node_modules/.bin/vite`, not the
   repo-root `node_modules/.bin`.
3. **`corepack pnpm` / `pnpm <script>` version friction.** Global pnpm 11.2.2 differs from the pinned
   11.8.0 (`corepack pnpm` resolves to 11.8.0); if the plain `pnpm` gate misbehaves, run `docker compose`
   / `tsx` / `node` directly as above, or use the local turbo with `--env-mode=loose`.

## Verification (what "up" means)

```bash
curl -s localhost:3000/health                                   # {"status":"ok","service":"beosand-api"}
curl -s localhost:3000/levels                                   # 3 seeded levels from the DB
curl -s "localhost:3000/court-requests/availability?date=2026-06-10"  # 13 hours x 6 free courts
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/courts  # 400 (no x-telegram-id)
curl -s -o /dev/null -w "%{http_code}\n" -H "x-telegram-id: 123" localhost:3000/courts  # 403 (non-admin)
curl -s -o /dev/null -w "%{http_code}\n" localhost:5173         # 200 (admin SPA)
# bot log: "BeoSand bot started (long polling)" + "API reachable: beosand-api"
```

All of the above were observed green on 2026-06-04.

## Stop

```bash
docker compose down        # stop Postgres (keep data in the volume)
docker compose down -v     # stop + drop data
# stop the API/bot/admin processes you started
```

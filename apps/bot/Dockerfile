# syntax=docker/dockerfile:1
#
# Railway service: beosand-bot
# Build from repo ROOT:
#   docker build -f apps/bot/Dockerfile .
#
# The bot is a grammY long-polling worker — it opens NO HTTP port, so there is
# no EXPOSE and no HTTP healthcheck. It compiles to JS (tsc -> dist) and runs
# `node apps/bot/dist/index.js`.
#
# The bot imports @beosand/config (loadEnv at boot), which validates the WHOLE
# fail-closed env contract: it needs TELEGRAM_BOT_TOKEN, ADMIN_SESSION_SECRET
# (min 16 chars) AND DATABASE_URL set or it crashes on start. The bot never
# queries the DB, but DATABASE_URL is a required field with no default, so the
# bot service must still have it set (point it at the same Postgres URL).

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

# --- deps: install only the @beosand/bot dependency closure ---
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/config/package.json ./packages/config/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --filter @beosand/bot...

# --- build: compile the bot and its workspace deps (config, types) to dist ---
FROM deps AS build

COPY . .

RUN pnpm --filter @beosand/bot... build

# --- runner: production install + compiled output only ---
FROM base AS runner

ENV NODE_ENV=production

# Manifests + lockfile for a production (no devDeps) install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json ./apps/bot/
COPY packages/config/package.json ./packages/config/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --prod --filter @beosand/bot...

# Compiled JS for the bot and its workspace deps (config, types) — these are
# resolved via the workspace symlinks created by the install above.
COPY --from=build /app/apps/bot/dist ./apps/bot/dist
COPY --from=build /app/packages/config/dist ./packages/config/dist
COPY --from=build /app/packages/i18n/dist ./packages/i18n/dist
COPY --from=build /app/packages/types/dist ./packages/types/dist

# No EXPOSE / no HEALTHCHECK: long-polling worker, no inbound HTTP.
CMD ["node", "apps/bot/dist/index.js"]

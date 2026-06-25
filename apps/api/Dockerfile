# syntax=docker/dockerfile:1
#
# Railway service: beosand-api
# Build from repo root:
#   docker build -f apps/api/Dockerfile .
#
# BeoSand's API is COMPILED: each workspace builds with tsc to its own dist/,
# and the API runs the emitted JS ("node apps/api/dist/main.js"). The workspace
# deps it imports (@beosand/config, @beosand/types, @beosand/db) all resolve via
# their package "exports" -> dist/, so they must be built too. The pnpm filter
# "@beosand/api..." (with the trailing "...") selects the API plus its dependency
# closure, so a single install + build covers config, types and db.
#
# Migrations run on deploy, not in CMD: this image keeps @beosand/db (with its
# tsx/drizzle dev deps) and the packages/db/drizzle SQL folder, so the Railway
# pre-deploy/release command "pnpm --filter @beosand/db db:migrate" works.

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

# ---- deps: install the @beosand/api dependency closure from the lockfile ----
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/bot/package.json ./apps/bot/
COPY apps/admin/package.json ./apps/admin/
COPY packages/config/package.json ./packages/config/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/

RUN pnpm install --frozen-lockfile --filter @beosand/api...

# ---- build: compile the API and its workspace deps (tsc -> dist) ----
FROM deps AS build

COPY . .

# Builds @beosand/api plus its dependency closure (config, types, db) in
# topological order; each emits to its own dist/.
RUN pnpm --filter @beosand/api... build

# ---- runner: production image ----
FROM build AS runner

ENV NODE_ENV=production

# Railway injects PORT; the API binds env.PORT (default 3000). GET /health
# returns {"status":"ok","service":"beosand-api"}.
EXPOSE 3000

# Apply pending migrations, then start the compiled API. db:migrate is
# "tsx src/migrate.ts" and reads DATABASE_URL from the environment.
CMD ["sh", "-c", "pnpm --filter @beosand/db db:migrate && node apps/api/dist/main.js"]

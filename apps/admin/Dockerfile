# syntax=docker/dockerfile:1
#
# Railway service: beosand-admin
# Build from repo ROOT:
#   docker build -f apps/admin/Dockerfile \
#     --build-arg VITE_API_URL=https://beosand-api.up.railway.app \
#     --build-arg VITE_TELEGRAM_BOT_USERNAME=YourBotBot .
#
# apps/admin is a static React + Vite SPA. The VITE_* values are BUILD-TIME args:
# Vite inlines them into the bundle, so changing either one requires a REDEPLOY
# (rebuild), not just an env-var edit. The runner serves the prebuilt static
# dist with SPA history fallback (`serve -s`) on Railway's injected $PORT.

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/bot/package.json ./apps/bot/
COPY apps/admin/package.json ./apps/admin/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --filter @beosand/admin...

FROM deps AS builder

COPY . .

# VITE_* are baked into the static bundle at build time (redeploy to change).
ARG VITE_API_URL
ARG VITE_TELEGRAM_BOT_USERNAME
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_TELEGRAM_BOT_USERNAME=$VITE_TELEGRAM_BOT_USERNAME

RUN pnpm --filter @beosand/admin... build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# `serve -s` serves a single-page app with history fallback (any unknown route
# returns index.html so client-side routing works). Installed with npm (bundled
# with the node image) to avoid pnpm's global-bin-dir setup in this fresh stage.
RUN npm install -g serve@14

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs admin

COPY --from=builder --chown=admin:nodejs /app/apps/admin/dist ./apps/admin/dist

USER admin

# Railway injects PORT at runtime; default to 3000 for local docker runs.
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "serve -s apps/admin/dist -l ${PORT:-3000}"]

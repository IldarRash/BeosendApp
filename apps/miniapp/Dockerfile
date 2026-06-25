# syntax=docker/dockerfile:1
#
# Railway service: beosand-miniapp
# Build from repo ROOT:
#   docker build -f apps/miniapp/Dockerfile \
#     --build-arg VITE_API_URL=https://beosand-api.up.railway.app .
#
# apps/miniapp is a static React + Vite Telegram Mini App. VITE_* values are
# BUILD-TIME args: Vite inlines them into the bundle, so changing VITE_API_URL
# requires a redeploy/rebuild, not just an env-var edit. The runner serves the
# prebuilt static dist with SPA history fallback (`serve -s`) on Railway's $PORT.

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

WORKDIR /app

FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/miniapp/package.json ./apps/miniapp/
COPY packages/i18n/package.json ./packages/i18n/
COPY packages/types/package.json ./packages/types/

RUN pnpm install --frozen-lockfile --filter @beosand/miniapp...

FROM deps AS builder

COPY . .

# VITE_* are baked into the static bundle at build time (redeploy to change).
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @beosand/miniapp... build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# `serve -s` serves a single-page app with history fallback (any unknown route
# returns index.html so client-side routing works).
RUN npm install -g serve@14

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs miniapp

COPY --from=builder --chown=miniapp:nodejs /app/apps/miniapp/dist ./apps/miniapp/dist

USER miniapp

# Railway injects PORT at runtime; default to 3000 for local docker runs.
ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-c", "serve -s apps/miniapp/dist -l tcp://0.0.0.0:${PORT:-3000}"]

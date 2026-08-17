# syntax=docker/dockerfile:1

###############################################################################
# Base image: node:24-slim (Debian/glibc), NOT node:24-alpine.
#
# better-sqlite3 >= 13 ships prebuilt N-API binaries, but only for glibc. On
# Alpine (musl) there is no matching prebuilt, so npm compiles it from source
# with node-gyp, which downloads Node headers from unofficial-builds.nodejs.org
# during the build. That host is the single point of failure behind the
# ETIMEDOUT: it breaks every from-scratch `docker compose build --no-cache`
# on a slow or filtered network.
#
# On glibc-slim the prebuilt is used: no compiler, no build tools, no header
# download. The whole failure class disappears and the image builds faster.
# Trade-off: the image is larger than Alpine (acceptable for a homelab; if you
# must stay small, see the Alpine note at the bottom of this file).
###############################################################################
ARG NODE_IMAGE=node:24-slim

# ─────────────────────────────────────────────────────────────────────────────
# runtime-base: shared runtime layer for both the bot and the web image.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime-base
WORKDIR /app

# su-exec has no Debian package; gosu is the drop-in equivalent with the same
# "gosu USER cmd" CLI, so symlinking it as su-exec keeps docker-entrypoint.sh
# working unchanged. gettext-base provides envsubst; ca-certificates is needed
# for outbound HTTPS (Modrinth icons/search, Discord).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gosu tzdata gettext-base ca-certificates \
 && ln -sf "$(command -v gosu)" /usr/local/bin/su-exec \
 && rm -rf /var/lib/apt/lists/*

COPY data/ ./data/
COPY data/ ./image-data/
COPY config.schema.json ./
RUN mkdir -p logs data
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# ─────────────────────────────────────────────────────────────────────────────
# builder: install ALL deps and compile TS + the SPA. Discarded after build.
# No python3/make/g++ line: on glibc nothing compiles from source.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Manifests first so the dependency layer caches until a package.json changes.
COPY package.json package-lock.json* ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
RUN npm ci

COPY tsconfig.json tsconfig.base.json config.schema.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/

# Backend + bot TypeScript, then the dashboard SPA into src/web/dist/frontend.
RUN npx tsc -b src/bot src/web
RUN npm run build:frontend --workspace=@mcbot/web

# ─────────────────────────────────────────────────────────────────────────────
# deps-bot / deps-web: production-only node_modules for each image.
# On glibc these install the better-sqlite3 prebuilt — no compile, no network
# header fetch — which is exactly the step that was failing before.
# ─────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps-bot
WORKDIR /app
COPY package.json package-lock.json* ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
RUN npm ci --omit=dev --workspace=@mcbot/bot

FROM ${NODE_IMAGE} AS deps-web
WORKDIR /app
COPY package.json package-lock.json* ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
RUN npm ci --omit=dev --workspace=@mcbot/web

# ─────────────────────────────────────────────────────────────────────────────
# bot: final Discord-bot image.
#   NOTE: the COPY --from=builder line and the CMD below are reconstructed from
#   your build log. Reconcile them with your existing Dockerfile's runtime
#   stage — the base-image and apt changes above are the actual fix; your
#   compiled-output paths and start command are unchanged by it.
# ─────────────────────────────────────────────────────────────────────────────
FROM runtime-base AS bot
ENV NODE_ENV=production
COPY --from=deps-bot /app/node_modules ./node_modules
COPY package.json ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
COPY --from=builder /app/src ./src          # <-- keep your existing built-output COPY(s)
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/bot/dist/index.js"]        # <-- keep your existing CMD

# ─────────────────────────────────────────────────────────────────────────────
# web: final dashboard image (backend API + built SPA).
#   Same NOTE as above for the COPY --from=builder line and CMD.
# ─────────────────────────────────────────────────────────────────────────────
FROM runtime-base AS web
ENV NODE_ENV=production
COPY --from=deps-web /app/node_modules ./node_modules
COPY package.json ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
COPY --from=builder /app/src ./src          # <-- keep your existing built-output COPY(s)
EXPOSE 8130
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "src/web/dist/backend/index.js"]  # <-- keep your existing CMD

###############################################################################
# If you must stay on Alpine (smaller image), the failure is fixable there too,
# but less cleanly: keep `apk add --no-cache python3 make g++` and force the
# compile to use LOCAL headers instead of the network fetch, e.g.
#
#   RUN apk add --no-cache python3 make g++ \
#    && npm_config_nodedir=/usr/local npm ci --omit=dev --workspace=@mcbot/bot
#
# This still compiles from source (slower) and depends on the Alpine node
# image shipping usable headers. Slim avoids the compile entirely, which is why
# it is the recommended fix for reliable from-scratch installs.
###############################################################################
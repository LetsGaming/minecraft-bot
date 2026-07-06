# ── Build stage ──────────────────────────────────────────────────────────────
# Node 24 = active LTS. better-sqlite3 has no musl prebuilds, so every stage
# that runs `npm ci` carries the compile toolchain; the runtime stages copy
# the finished node_modules and stay slim.
FROM node:24-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

# Workspace manifests first: dependency layers cache until a manifest changes.
COPY package.json package-lock.json* ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
RUN npm ci

# Sources + build configuration.
COPY tsconfig.json tsconfig.base.json config.schema.json ./
COPY scripts/ ./scripts/
COPY src/ ./src/

# Backend TypeScript (schema → core → bot + web, via project references),
# then the dashboard SPA into src/web/dist/frontend.
RUN npx tsc -b src/bot src/web
RUN npm run build:frontend --workspace=@mcbot/web

# ── Production dependencies ──────────────────────────────────────────────────
# Compiled on Alpine (better-sqlite3 native build), copied into the slim
# runtime stages. One stage per artifact: the bot's tree never contains
# fastify/vite, the dashboard's never contains discord.js.
FROM node:24-alpine AS deps-bot

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
RUN npm ci --omit=dev --workspace=@mcbot/bot

FROM node:24-alpine AS deps-web

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json* ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/
RUN npm ci --omit=dev --workspace=@mcbot/web

# ── Shared runtime base ───────────────────────────────────────────────────────
FROM node:24-alpine AS runtime-base

LABEL org.opencontainers.image.title="minecraft-bot" \
      org.opencontainers.image.description="Discord bot for managing Minecraft servers" \
      org.opencontainers.image.url="https://github.com/letsgaming/minecraft-bot"

WORKDIR /app

# su-exec:  clean privilege drop (root → node) in the entrypoint
# tzdata:   TZ env var works correctly on Alpine
# gettext:  provides envsubst for config.template.json variable substitution
RUN apk add --no-cache su-exec tzdata gettext

# Static data shipped with the image (dailyRewards.json etc.).
# A separate copy is kept in /app/image-data so the entrypoint can seed
# /app/data on first run when the volume is empty.
COPY data/ ./data/
COPY data/ ./image-data/
COPY config.schema.json ./

# Ensure runtime directories exist in the image layer.
# Ownership is fixed at container start (bind mounts arrive as root).
RUN mkdir -p logs data

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]

# ── Web dashboard runtime (build with: --target web) ────────────────────────
# The dashboard is the bot's optional extension: its own image, its own
# lifecycle, zero bot code — it shares only config.json and the data/
# volume (SQLite store + JSON files). discord.js never enters this image.
FROM runtime-base AS web

COPY --from=deps-web /app/node_modules ./node_modules
COPY package.json ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/

COPY --from=builder /app/src/schema/dist ./src/schema/dist
COPY --from=builder /app/src/core/dist ./src/core/dist
COPY --from=builder /app/src/web/dist ./src/web/dist

# Containers must bind beyond loopback; compose sets WEBUI_HOST=0.0.0.0.
EXPOSE 8130

# The dashboard has a real endpoint to probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WEBUI_PORT||8130)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "src/web/dist/backend/index.js"]

# ── Bot runtime (default target — the main product builds by default) ───────
FROM runtime-base AS bot

COPY --from=deps-bot /app/node_modules ./node_modules
COPY package.json ./
COPY src/schema/package.json ./src/schema/
COPY src/core/package.json ./src/core/
COPY src/bot/package.json ./src/bot/
COPY src/web/package.json ./src/web/

COPY --from=builder /app/src/schema/dist ./src/schema/dist
COPY --from=builder /app/src/core/dist ./src/core/dist
COPY --from=builder /app/src/bot/dist ./src/bot/dist

# Health check: verify PID 1 (our node process after the exec chain) is alive.
# start_period gives the bot time to log in to Discord before the first check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD grep -q node /proc/1/cmdline || exit 1

CMD ["node", "--enable-source-maps", "src/bot/dist/index.js"]

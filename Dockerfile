# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20.19-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20.19-alpine AS runtime

LABEL org.opencontainers.image.title="minecraft-bot" \
      org.opencontainers.image.description="Discord bot for managing Minecraft servers" \
      org.opencontainers.image.url="https://github.com/your-org/minecraft-bot"

WORKDIR /app

# su-exec:  clean privilege drop (root → node) in the entrypoint
# tzdata:   TZ env var works correctly on Alpine
# gettext:  provides envsubst for config.template.json variable substitution
RUN apk add --no-cache su-exec tzdata gettext

# Install production deps only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Compiled JS
COPY --from=builder /app/dist ./dist

# Static data shipped with the image (dailyRewards.json etc.).
# A separate copy is kept in /app/image-data so the entrypoint can seed
# /app/data on first run when the volume is empty.
COPY data/ ./data/
COPY data/ ./image-data/

# Ensure runtime directories exist in the image layer.
# Ownership is fixed at container start (bind mounts arrive as root).
RUN mkdir -p logs data

COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Health check: verify PID 1 (our node process after the exec chain) is alive.
# start_period gives the bot time to log in to Discord before the first check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD grep -q node /proc/1/cmdline || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/index.js"]

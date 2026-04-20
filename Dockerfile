# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install all deps (including devDependencies for tsc)
# Use npm ci if a lockfile exists, otherwise fall back to npm install
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Compile TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

# su-exec: clean privilege drop from root to node user in the entrypoint
# tzdata: required so the TZ env var set in docker-compose actually works on Alpine
RUN apk add --no-cache su-exec tzdata

# Install production deps only
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy static assets
COPY data/ ./data/

# Runtime directories — actual files are mounted via volumes at runtime
RUN mkdir -p logs data

# Entrypoint: fixes volume permissions, checks for config.json, then drops to node user
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
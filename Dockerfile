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

# Install production deps only
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy static assets
COPY data/ ./data/

# Runtime directories — actual files are mounted via volumes at runtime.
# chown ensures the node user can write into them even when the host
# directory was created by root (which Docker does by default).
RUN mkdir -p logs data && chown -R node:node logs data

# Entrypoint: checks for config.json before handing off to CMD
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Run as non-root
USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
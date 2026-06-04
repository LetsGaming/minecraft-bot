#!/bin/sh
set -e

# ── Config resolution ─────────────────────────────────────────────────────────
#
# Priority:
#   1. /app/config.json already exists (mounted or previously generated) → use it
#   2. /app/config.template.json exists → substitute env vars with envsubst,
#      write the result to /app/config.json, then continue
#   3. Neither exists → print a clear error and exit

if [ -f /app/config.json ]; then
  : # config.json already present — nothing to do
elif [ -f /app/config.template.json ]; then
  echo "INFO: Generating config.json from config.template.json ..."
  envsubst < /app/config.template.json > /app/config.json
  echo "INFO: config.json generated."
else
  echo ""
  echo "ERROR: No config found."
  echo ""
  echo "The bot needs config.json (or config.template.json + env vars) to start."
  echo ""
  echo "Option A — static config.json:"
  echo "  1. cp config_structure.json config.json && fill in your values"
  echo "  2. In docker-compose.yml, mount it:"
  echo "       volumes:"
  echo "         - ./config.json:/app/config.json:ro"
  echo ""
  echo "Option B — template + .env (recommended for first-time setup):"
  echo "  1. cp .env.example .env && fill in your values"
  echo "  2. In docker-compose.yml, mount the template:"
  echo "       volumes:"
  echo "         - ./config.template.json:/app/config.template.json:ro"
  echo ""
  echo "See docs/docker.md for full instructions."
  echo ""
  exit 1
fi

# ── Data seeding ──────────────────────────────────────────────────────────────
#
# Named volumes start empty on first creation. Copy any static data files that
# ship with the image (e.g. dailyRewards.json) into the volume if not present.
for src in /app/image-data/*; do
  [ -f "$src" ] || continue
  dest="/app/data/$(basename "$src")"
  if [ ! -f "$dest" ]; then
    cp "$src" "$dest"
    echo "INFO: Seeded $(basename "$dest") from image defaults."
  fi
done

# ── Ownership fix ─────────────────────────────────────────────────────────────
#
# Bind-mounted directories and freshly created named volumes may be owned by
# root. Fix that here (running as root) so the node user can write at runtime.
chown -R node:node /app/logs /app/data

# ── Drop privileges and start ─────────────────────────────────────────────────
exec su-exec node "$@"

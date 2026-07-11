#!/bin/sh
set -e

# ── Config resolution ─────────────────────────────────────────────────────────
#
# The ACTIVE config lives in the writable, node-owned data/ volume so the
# dashboard can rewrite it (atomic temp+rename on one filesystem) and the bot's
# fs watcher sees the change — bot and web share the volume, so this is also
# what makes a dashboard edit reach the bot. We SEED it once; it then persists
# across restarts and is the file the dashboard manages.
#
# Priority (first run):
#   1. $CONFIG_PATH already exists (persisted, or written by the dashboard) → use it
#   2. a static config.json is mounted at /app/config.json → copy it in
#   3. /app/config.template.json is present → envsubst env vars → $CONFIG_PATH
#   4. none of the above → print a clear error and exit
#
# MCBOT_CONFIG_PATH is exported so the Node process resolves the very same
# path (see src/core/config.ts).

CONFIG_PATH="${MCBOT_CONFIG_PATH:-/app/data/config.json}"
export MCBOT_CONFIG_PATH="$CONFIG_PATH"
mkdir -p "$(dirname "$CONFIG_PATH")"

if [ -f "$CONFIG_PATH" ]; then
  : # already seeded / dashboard-managed — leave it untouched
elif [ -f /app/config.json ]; then
  echo "INFO: Seeding $CONFIG_PATH from the mounted config.json ..."
  cp /app/config.json "$CONFIG_PATH"
  echo "INFO: config seeded."
elif [ -f /app/config.template.json ]; then
  echo "INFO: Generating $CONFIG_PATH from config.template.json ..."
  envsubst < /app/config.template.json > "$CONFIG_PATH"
  echo "INFO: config generated."
else
  echo ""
  echo "ERROR: No config found."
  echo ""
  echo "The bot needs a config (or config.template.json + env vars) to start."
  echo "The active config is written to the data/ volume; provide a seed:"
  echo ""
  echo "Option A — template + .env (recommended for first-time setup):"
  echo "  1. cp .env.example .env && fill in your values"
  echo "  2. In docker-compose.yml, mount the template:"
  echo "       volumes:"
  echo "         - ./config.template.json:/app/config.template.json:ro"
  echo ""
  echo "Option B — static config.json:"
  echo "  1. cp config_structure.json config.json && fill in your values"
  echo "  2. In docker-compose.yml, mount it as a seed (copied into data/ once):"
  echo "       volumes:"
  echo "         - ./config.json:/app/config.json:ro"
  echo ""
  echo "The dashboard then edits the copy in data/; re-seed by clearing"
  echo "$CONFIG_PATH. See docs/docker.md for full instructions."
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

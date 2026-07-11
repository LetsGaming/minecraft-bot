#!/bin/sh
set -e

# The container starts as root only to (a) fix volume ownership and (b) drop to
# the unprivileged `node` user. It deliberately runs WITHOUT CAP_DAC_OVERRIDE
# (compose drops all caps and re-adds only CHOWN/SETGID/SETUID), so root cannot
# write into a node-owned volume. We therefore chown the writable volumes FIRST,
# then perform every write below AS NODE (su-exec) — this is what makes seeding
# the config into the shared, node-owned data/ volume work on both fresh and
# already-initialised volumes.

CONFIG_PATH="${MCBOT_CONFIG_PATH:-/app/data/config.json}"
export MCBOT_CONFIG_PATH="$CONFIG_PATH"
mkdir -p "$(dirname "$CONFIG_PATH")"

# ── Ownership fix (BEFORE any writes) ─────────────────────────────────────────
# Fresh named volumes inherit the image's root ownership; existing ones may
# already be node-owned. Either way, make them node-owned now (root, via
# CAP_CHOWN) so the node user can write below and at runtime.
chown -R node:node /app/logs /app/data

# ── Config resolution ─────────────────────────────────────────────────────────
#
# The ACTIVE config lives in the writable data/ volume so the dashboard can
# rewrite it and the bot's fs watcher sees the change (bot + web share the
# volume). We SEED it once; it then persists and is the file the dashboard
# manages. Priority on first run:
#   1. $CONFIG_PATH already exists (persisted / dashboard-written) → use it
#   2. a static config.json is mounted at /app/config.json → copy it in
#   3. /app/config.template.json is present → envsubst env vars → $CONFIG_PATH
#   4. none of the above → print a clear error and exit
if [ -f "$CONFIG_PATH" ]; then
  : # already seeded / dashboard-managed — leave it untouched
elif [ -f /app/config.json ]; then
  echo "INFO: Seeding $CONFIG_PATH from the mounted config.json ..."
  su-exec node cp /app/config.json "$CONFIG_PATH"
  echo "INFO: config seeded."
elif [ -f /app/config.template.json ]; then
  echo "INFO: Generating $CONFIG_PATH from config.template.json ..."
  # Run as node so the redirect writes into the node-owned volume. envsubst and
  # $MCBOT_CONFIG_PATH are inherited from the (exported) environment.
  su-exec node sh -c 'envsubst < /app/config.template.json > "$MCBOT_CONFIG_PATH"'
  echo "INFO: config generated."
else
  echo ""
  echo "ERROR: No config seed found."
  echo ""
  echo "The active config is written to the data/ volume; it needs a seed."
  echo "With the shipped docker-compose.yml this is fully .env-driven:"
  echo ""
  echo "  1. cp .env.example .env   # then fill in DISCORD_* / MC_API_* etc."
  echo "  2. docker compose up -d   # the template is seeded + env-substituted"
  echo ""
  echo "Prefer a hand-written config? Set MCBOT_CONFIG_FILE in .env to a"
  echo "filled-in file (from config_structure.json); it's copied in as-is."
  echo ""
  echo "The dashboard then edits the copy in data/; re-seed by clearing"
  echo "$CONFIG_PATH. See docs/admin/docker.md for full instructions."
  echo ""
  exit 1
fi

# ── Data seeding (as node) ────────────────────────────────────────────────────
#
# Named volumes start empty on first creation. Copy any static data files that
# ship with the image (e.g. dailyRewards.json) into the volume if not present.
for src in /app/image-data/*; do
  [ -f "$src" ] || continue
  dest="/app/data/$(basename "$src")"
  if [ ! -f "$dest" ]; then
    su-exec node cp "$src" "$dest"
    echo "INFO: Seeded $(basename "$dest") from image defaults."
  fi
done

# ── Start as node ─────────────────────────────────────────────────────────────
exec su-exec node "$@"

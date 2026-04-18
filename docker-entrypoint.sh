#!/bin/sh
set -e

if [ ! -f /app/config.json ]; then
  echo ""
  echo "ERROR: config.json not found."
  echo ""
  echo "The bot requires a config.json file mounted at /app/config.json."
  echo "To create one, run the setup script on your host machine first:"
  echo ""
  echo "  node scripts/setup.mjs"
  echo ""
  echo "Then start the container again with the volume mount in place:"
  echo ""
  echo "  docker compose up -d"
  echo ""
  exit 1
fi

# Fix ownership of bind-mounted directories so the node user can write to them.
# This runs as root (before the user switch below) because the host creates
# these directories as root by default.
chown -R node:node /app/logs /app/data

# Drop to the node user for the actual process
exec su-exec node "$@"
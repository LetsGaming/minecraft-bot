# Docker Deployment

This guide covers running the bot with Docker. Docker is the recommended deployment method when the bot and the Minecraft server run on **separate machines**, or when you want a self-contained, restart-safe process without installing PM2.

> **Same-machine use:** Docker works on the same host too — just run the [API wrapper](remote-setup.md) directly on the host and point the bot at `http://host.docker.internal:3000`. The container can't reach local `screen` sessions or the filesystem, so the API wrapper is the bridge.

---

## Prerequisites

- Docker Engine 24+ and Docker Compose v2.24+
- The [API wrapper](remote-setup.md) deployed and reachable from the bot container
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

---

## Quick start — template config (recommended)

This path lets you configure everything via environment variables. No manual JSON editing required.

```bash
# 1. Clone the repo
git clone <your-repo-url> minecraft-bot && cd minecraft-bot

# 2. Create your .env file
cp .env.example .env
```

Open `.env` and fill in the values:

| Variable | Where to find it |
|---|---|
| `TZ` | Your timezone, e.g. `Europe/Berlin` |
| `DISCORD_TOKEN` | Developer Portal → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | Developer Portal → your app → General Information → Application ID |
| `DISCORD_ADMIN_USER_ID` | Right-click your name in Discord → Copy User ID (requires Developer Mode) |
| `DISCORD_GUILD_ID` | Right-click your server in Discord → Copy Server ID |
| `MC_API_URL` | URL of the API wrapper, e.g. `http://192.168.1.10:3000` |
| `MC_API_KEY` | The `apiKey` set in your API wrapper config (omit if not configured) |

```bash
# 3. Build and start
docker compose up -d

# 4. Watch the startup logs
docker compose logs -f
```

The entrypoint reads `config.template.json`, substitutes your `.env` variables, and writes `config.json` at startup. If the generated config is wrong, edit `.env` and restart — the file is regenerated each time.

---

## Quick start — static `config.json`

Preferred for multi-server or multi-guild setups where the template isn't expressive enough.

```bash
# 1. Create config.json from the full template
cp config_structure.json config.json
# Fill in config.json — see docs/configuration.md for the full reference

# 2. In docker-compose.yml, switch the volume mount:
#    Comment out:   - ./config.template.json:/app/config.template.json:ro
#    Uncomment:     - ./config.json:/app/config.json:ro

# 3. Start
docker compose up -d
```

---

## Useful commands

```bash
# Start in the background
docker compose up -d

# Rebuild after a code change, then restart
docker compose up -d --build

# Tail live logs (stdout)
docker compose logs -f

# Open a shell inside the running container
docker compose exec bot sh

# Inspect the bot's data files
docker compose exec bot ls /app/data/

# Stop the bot
docker compose down

# Stop and remove volumes (⚠ deletes all persistent data)
docker compose down -v
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `TZ` | *(unset)* | Container timezone for log timestamps |
| `NODE_ENV` | `production` | Node environment (set in `docker-compose.yml`) |
| `DEBUG` | *(unset)* | Set to any value to enable verbose debug logging |

Variables used by the template path (`config.template.json`) are documented in `.env.example`.

---

## Data and backups

Runtime data (account links, leaderboard state, whitelist audit, etc.) lives in the `bot_data` named volume. Logs live in `bot_logs`.

```bash
# Copy all data out of the container
docker compose cp bot:/app/data/ ./data-backup/

# Copy a single file
docker compose cp bot:/app/data/linkedAccounts.json .

# Find the volume on disk (for direct backup)
docker volume inspect minecraft-bot_bot_data
```

Static data that ships with the image (like `dailyRewards.json`) is seeded into the volume automatically on first start.

---

## Upgrading

```bash
git pull
docker compose up -d --build
```

The build stage recompiles TypeScript from scratch. Your data and config are in volumes/mounts and are untouched.

---

## Development overrides

Create a `docker-compose.override.yml` alongside `docker-compose.yml` (it is git-ignored by default). Docker Compose merges it automatically.

Example — mount source and enable debug without touching the main compose file:

```yaml
# docker-compose.override.yml
services:
  bot:
    environment:
      DEBUG: "true"
      NODE_ENV: development
```

---

## Same-machine setup (Docker bot + local Minecraft server)

If your Minecraft server and the bot both live on the same host:

1. Deploy the [API wrapper](remote-setup.md) directly on the host (not in Docker).
2. In `.env`, set:
   ```
   MC_API_URL=http://host.docker.internal:3000
   ```
   `host.docker.internal` resolves to the Docker host from inside any container.
3. Start the bot with `docker compose up -d`.

The API wrapper handles all local operations (screen sessions, log tailing, script execution) while the bot runs safely in a container.

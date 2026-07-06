# Running with Docker

Docker is the recommended way to run the bot. It is self-contained, restart-safe, and needs no Node.js or PM2 on the host.

One thing to understand up front: the container cannot reach `screen` sessions or the Minecraft server's filesystem, even on the same machine. Server access from Docker always goes through the [API wrapper](remote-setup.md), which runs directly on the Minecraft host.

## Prebuilt images (GHCR)

Every release publishes an image to GitHub Container Registry:

```bash
docker pull ghcr.io/letsgaming/minecraft-bot:latest   # or a version tag like v3.6.0
```

Building locally (below) remains fully supported and is what the compose files default to.

## Prerequisites

- Docker Engine 24+ and Docker Compose v2.24+
- The [API wrapper](remote-setup.md) deployed and reachable from the container
- Your Discord credentials (see [setup.md](setup.md))

## Quick start: template config (recommended)

This path configures everything through environment variables. No JSON editing.

```bash
git clone <your-repo-url> minecraft-bot && cd minecraft-bot
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to find it |
|---|---|
| `TZ` | Your timezone, e.g. `Europe/Berlin`. Controls log timestamps and the daily purge schedule. |
| `DISCORD_TOKEN` | Developer Portal → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | Developer Portal → General Information → Application ID |
| `DISCORD_ADMIN_USER_ID` | Right-click your name in Discord → Copy User ID |
| `DISCORD_GUILD_ID` | Right-click your Discord server → Copy Server ID |
| `DISCORD_*_CHANNEL_ID` | Channel IDs for notifications, chat bridge, leaderboard |
| `MC_API_URL` | URL of the API wrapper, e.g. `http://192.168.1.10:3000` |
| `MC_API_KEY` | The `apiKey` from your API wrapper config |

Then:

```bash
docker compose up -d
docker compose logs -f
```

On startup the entrypoint reads `config.template.json`, substitutes the `.env` values, and writes `config.json`. Wrong value? Edit `.env` and `docker compose restart`; the file is regenerated each time.

## Quick start: static config.json

The template covers one server and one guild. For multi-server or multi-guild setups, use a full static config:

```bash
cp config_structure.json config.json
# Fill it in; see admin/configuration.md for the full reference
```

In `docker-compose.yml`, switch the volume mount:

```yaml
volumes:
  # Comment out the template line:
  # - ./config.template.json:/app/config.template.json:ro
  # Uncomment the static line:
  - ./config.json:/app/config.json:ro
```

Then `docker compose up -d`.

## Same machine as the Minecraft server

1. Run the API wrapper directly on the host (not in Docker).
2. In `.env`, set `MC_API_URL=http://host.docker.internal:3000`. That hostname resolves to the Docker host from inside any container.
3. Start the bot normally.

## Useful commands

```bash
docker compose up -d              # start in the background
docker compose up -d --build      # rebuild after a code change
docker compose logs -f            # tail live logs
docker compose exec bot sh        # shell inside the container
docker compose exec bot ls /app/data/   # inspect data files
docker compose down               # stop
docker compose down -v            # stop AND delete all persistent data
```

## Data, logs, and backups

Runtime state (account links, claim history, snapshots, audit trail) lives in the `bot_data` named volume; logs in `bot_logs`. They survive rebuilds and `docker compose down`.

```bash
docker compose cp bot:/app/data/ ./data-backup/        # back up everything
docker compose cp bot:/app/data/linkedAccounts.json .  # single file
docker volume inspect minecraft-bot_bot_data           # find the volume on disk
```

`dailyRewards.json` ships with the image and is seeded into the volume on first start. After that, edit the copy in the volume; the image default never overwrites an existing file.

## Upgrading

```bash
git pull
docker compose up -d --build
```

Config and data live in mounts and volumes and are untouched by rebuilds.

## Container hardening (already configured)

The shipped `docker-compose.yml` drops all capabilities except CHOWN/SETGID/SETUID, sets `no-new-privileges`, drops from root to the `node` user after fixing volume ownership, caps json log size, and includes a healthcheck. You normally do not need to change any of this.

## Development overrides

Create a git-ignored `docker-compose.override.yml`; Compose merges it automatically:

```yaml
services:
  bot:
    environment:
      DEBUG: "true"
      NODE_ENV: development
```


## The web dashboard (optional)

The dashboard ships as a separate image target from the same Dockerfile and is opt-in via a compose profile:

```bash
docker compose --profile web up -d        # bot + dashboard
docker compose --profile web up -d web    # dashboard only
```

Requires `"webui": { "enabled": true }` in the config plus `WEBUI_CLIENT_SECRET` / `WEBUI_SESSION_SECRET` in `.env`. Compose already sets `WEBUI_HOST=0.0.0.0` inside the container and publishes the port on the **host's loopback only** (`127.0.0.1:8130`) — put a TLS-terminating reverse proxy in front before exposing it further. Optionally set `WEBUI_METRICS_TOKEN` to require `Authorization: Bearer <token>` on `/metrics`.

There is deliberately no `depends_on`: the dashboard and the bot have independent lifecycles — either runs and works without the other. They share the config file and the `bot_data` volume (JSON stores + the SQLite database in WAL mode), which also means both containers must run on the same host.

# Running with Docker

Docker is the recommended way to run the bot. It is self-contained, restart-safe, and needs no Node.js or PM2 on the host.

One thing to understand up front: the container cannot reach `screen` sessions or the Minecraft server's filesystem, even on the same machine. Server access from Docker always goes through the [API wrapper](remote-setup.md), which runs directly on the Minecraft host.

## Prebuilt images (GHCR)

Every release publishes an image to GitHub Container Registry:

```bash
docker pull ghcr.io/letsgaming/minecraft-bot:latest   # or a version tag like v5.1.0
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
| ~~`TZ`~~ | Removed. The bot stores everything in UTC and takes wall-clock zones from `config.json` instead: `guilds.<id>.timezone` for the channel purge and `/activity`, `schedules.<server>.timezone` for restarts, and a global `timezone` as the default for both. |
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

On the first start the entrypoint reads `config.template.json`, substitutes the `.env` values, and writes the result to `/app/data/config.json` in the `bot_data` volume. That copy is then the active config: it is not regenerated on later starts, and the dashboard edits it. Wrong value? Correct it in the dashboard or in the copy in the volume, or clear the copy (`docker compose exec bot rm /app/data/config.json`), fix `.env` and restart to seed it again.

## Quick start: static config.json

The template covers one server and one guild. For multi-server or multi-guild setups, use a full static config:

```bash
cp config.template.json config.json
# Fill it in; see admin/configuration.md for the full reference
```

Then point `.env` at it — no compose edits:

```bash
# in .env
MCBOT_CONFIG_FILE=./config.json
```

`docker compose up -d` seeds that file (copied as-is) into the data/ volume on first start. To re-seed after changing it, clear the copy in the volume: `docker compose exec bot rm /app/data/config.json` and restart.

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
docker compose cp bot:/app/data/bot.db .               # the SQLite database only
docker volume inspect minecraft-bot_bot_data           # find the volume on disk
```

`dailyRewards.defaults.json` ships with the image and is copied into the volume on every start, so it follows image updates. The bot creates the editable `dailyRewards.json` from it the first time it is needed; after that, edit the copy in the volume or use the dashboard's Daily rewards page. Updates never overwrite it (see [daily-rewards.md](daily-rewards.md)).

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

The shipped `config.template.json` has no `webui` block, so a config seeded from it leaves the dashboard disabled and the `web` container exits with `Dashboard is disabled`. Add `"webui": { "enabled": true }` to your static `config.json` before the first start, or to the seeded copy in the volume, then restart. The dashboard also requires `WEBUI_CLIENT_SECRET` / `WEBUI_SESSION_SECRET` in `.env`. Compose already sets `WEBUI_HOST=0.0.0.0` inside the container and publishes the port on the **host's loopback only** (`127.0.0.1:8130`) — put a TLS-terminating reverse proxy in front before exposing it further. Optionally set `WEBUI_METRICS_TOKEN` to require `Authorization: Bearer <token>` on `/metrics`.

#### Reverse proxy and client addresses

The dashboard does not trust `X-Forwarded-For` by default, so a client cannot claim another address to slip past the login and write rate limits. That is correct when you reach it directly (the compose default, port published on the host loopback). Behind a reverse proxy, tell it which proxy to believe in `config.json`:

```json
"webui": { "enabled": true, "trustProxy": ["uniquelocal"] }
```

Use `["loopback"]` when the proxy runs on the host and connects over 127.0.0.1, `["uniquelocal"]` (private ranges) for a proxy container on the same Docker network, or the proxy's exact address. Without it every visitor looks like the proxy: signed-in users still get their own rate-limit budget, but the pre-login limit is shared, and the dashboard logs one warning naming this setting. Also set `WEBUI_PUBLIC_URL` to the public URL.

To sign every dashboard session out, raise `webui.sessionEpoch` in `config.json`.

`MCBOT_DEV_NO_AUTH=1` (set only by `scripts/dev-up.mjs`) disables dashboard login entirely, so the dashboard refuses to start with it on a non-loopback `WEBUI_HOST` or under `NODE_ENV=production`. Never set it on a real deployment.

There is deliberately no `depends_on`: the dashboard and the bot have independent lifecycles — either runs and works without the other. They share the config file and the `bot_data` volume (JSON stores + the SQLite database in WAL mode), which also means both containers must run on the same host.

### Troubleshooting: `minecraft-bot-web` stuck `Restarting (1)`

The dashboard opens the shared SQLite store at startup, so a store it cannot open makes it exit 1 and Docker restarts it in a loop. Check the reason:

```bash
docker compose logs --tail=20 web
```

Common causes:

- **`Failed to load config.json: … token: required string … clientId: required string`** — the container seeded `config.json` from `config.template.json` (filling in its `${VAR}` placeholders from the environment), but `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` were empty in `.env`, so the template expanded to blank required fields. Fix one of two ways: **(A)** fill in `DISCORD_TOKEN` / `DISCORD_CLIENT_ID` / `DISCORD_ADMIN_USER_ID` in `.env`; or **(B)** use a hand-written config by setting `MCBOT_CONFIG_FILE=./config.json` in `.env`. Either way the seed already landed in the data/ volume, so clear it and restart to re-seed: `docker compose exec bot rm /app/data/config.json && docker compose up -d`. The bot and web containers share that one config, so this fixes both at once.
- **`Failed to open the SQLite store: better-sqlite3 failed to load …`** — the native binding did not build for this image. The compose file sets `MCBOT_SQLITE_DRIVER=node` on the web service precisely to avoid this (the dashboard runs on Node 24 and uses the built-in `node:sqlite` driver — same store format, no native build). If you removed that line, put it back and rebuild: `docker compose up -d --build web`.
- **`Dashboard is disabled …`**: `config.json` is missing `"webui": { "enabled": true }`. Add the block to the config the containers use (the copy in the `bot_data` volume, or your static file followed by a re-seed as described above) and restart `web`.

The dashboard **boots without** `WEBUI_SESSION_SECRET` / `WEBUI_CLIENT_SECRET` (health checks pass), but OAuth login fails until both are set in `.env` — that is a login error, not a crash loop.

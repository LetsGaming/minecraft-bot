# Docker Deployment

Docker is supported for the **remote server mode only** — where the Minecraft server runs on a different machine and the API wrapper is deployed there.

If your bot and Minecraft server are on the **same machine**, use PM2 instead. Local mode relies on direct filesystem access, `screen` sessions, and `sudo` — none of which work cleanly inside a container. See the main [README](../README.md) for PM2 setup.

## Prerequisites

- The API wrapper deployed and running on your Minecraft server host
- `apiUrl` (and optionally `apiKey`) set in your `config.json`

```json
"servers": {
  "survival": {
    "apiUrl": "http://192.168.1.10:3000",
    "apiKey": "your-api-key"
  }
}
```

## Quick start

```bash
# 1. Copy and fill in your config
cp config_structure.json config.json

# 2. Build and start
docker compose up -d

# 3. Tail live logs
docker compose logs -f
```

## Useful commands

```bash
# Start in background
docker compose up -d

# Rebuild after code changes
docker compose up -d --build

# Tail live logs
docker compose logs -f

# Stop
docker compose down
```

## Environment variables

| Variable   | Default      | Description                              |
|------------|--------------|------------------------------------------|
| `NODE_ENV` | `production` | Runtime environment                      |
| `DEBUG`    | *(unset)*    | Set to any value to enable debug logging |

Set these under `environment` in `docker-compose.yml`.

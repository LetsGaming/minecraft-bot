# Remote setup (API wrapper)

Use this when the bot and the Minecraft server run on different machines, or when the bot runs in Docker (a container cannot reach the host's filesystem or screen sessions directly).

## Architecture

One API wrapper process runs on the Minecraft host and serves all Minecraft instances on that machine. The bot talks to it over HTTP.

```
Bot machine                 Minecraft machine
┌─────────────────┐         ┌──────────────────────────────┐
│  Discord Bot    │──HTTP──▶│  API Wrapper (:3000)         │
│                 │         │  ├─ survival  (MC instance)  │
│                 │         │  └─ creative  (MC instance)  │
└─────────────────┘         └──────────────────────────────┘
```

Multiple Minecraft machines are supported: each gets its own wrapper, and the bot connects to each independently. You can also mix local and remote instances freely in one bot.

What goes through the wrapper: file reads (stats, whitelist, server.properties, mod list, backups), log streaming (SSE), and script execution (start/stop/restart/backup/status). RCON traffic goes directly from the bot to the Minecraft server and bypasses the wrapper, as long as the RCON port is reachable from the bot machine.

## Step 1: Deploy the wrapper on the Minecraft host

### Option A: via minecraft-server-setup (recommended)

If your server was set up with [minecraft-server-setup](https://github.com/letsgaming/minecraft-server-setup), enable the wrapper in `variables.json` before running setup:

```json
"API_SERVER": {
  "ENABLED": true,
  "PORT": 3000,
  "API_KEY": "replace-with-a-long-random-secret"
}
```

Run setup normally, or explicitly:

```bash
sudo -u <user> bash main.sh --api-server
```

This deploys the wrapper, generates `api-server-config.json`, and creates a systemd service. Adding another Minecraft instance later: run setup for it with `--api-server` again; the script updates the config and restarts the service.

### Option B: standalone install

```bash
git clone https://github.com/LetsGaming/minecraft-server-api.git
cd minecraft-server-api
npm install --omit=dev
cp api-server-config.example.json api-server-config.json
```

Each key under `instances` must match the corresponding `servers` key in the bot's `config.json`:

```json
{
  "port": 3000,
  "apiKey": "replace-with-a-long-random-secret",
  "instances": {
    "survival": {
      "serverPath": "/home/minecraft/minecraft-server/survival",
      "scriptsDir": "/home/minecraft/minecraft-server/scripts/survival",
      "linuxUser": "minecraft",
      "useRcon": true,
      "rconPort": 25575,
      "rconPassword": "your-rcon-password",
      "backupsPath": "/home/minecraft/backups/survival"
    }
  }
}
```

| Field | Required | Description |
|---|---|---|
| `serverPath` | Yes | Absolute path to the server directory |
| `scriptsDir` | No | Directory with the management scripts |
| `linuxUser` | No | Owner of the MC process (default `minecraft`) |
| `useRcon` | No | Use RCON for status checks and commands (default `false`) |
| `rconHost` / `rconPort` / `rconPassword` | No | RCON connection (password required when `useRcon` is true) |
| `backupsPath` | No | Backups root directory |

Run it with PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save && pm2 startup
```

The script routes use `sudo -n` to run management scripts as the Minecraft user; configure sudoers as described in [sudoers.md](sudoers.md).

Firewall: only allow the bot machine to reach the wrapper port.

```bash
ufw allow from <BOT_IP> to any port 3000 proto tcp
```

## Step 2: Point the bot at the wrapper

In the bot's `config.json`, add `apiUrl` and `apiKey` to each remote server. The key name must match the wrapper's `instances` key:

```json
"servers": {
  "survival": { "apiUrl": "http://192.168.1.10:3000", "apiKey": "the-same-secret" },
  "creative": { "apiUrl": "http://192.168.1.10:3000", "apiKey": "the-same-secret" }
}
```

Both instances point at the same `apiUrl`; the wrapper routes by the instance ID in the URL path. Local instances simply omit `apiUrl`.

## Wrapper version notes

Two bot features need wrapper routes added in wrapper v2.1:

- **Capability detection** (`GET /instances/:id/capabilities`): lets the bot know which setup-suite artifacts the remote instance provides. Older wrappers without the route are fine — the bot then assumes everything is available and errors surface at invocation time, exactly as before.
- **`/server prune-stats`** (`DELETE /instances/:id/stats/:uuid`): explicit, admin-gated deletion of orphaned stats files. On older wrappers the deletion silently degrades — prune-stats reports 0 deleted files instead of failing.

Update the wrapper to get both; no bot-side configuration changes are needed.

## Step 3: Verify

```bash
# /health needs no API key
curl http://192.168.1.10:3000/health
# → {"ok":true}

curl -H "x-api-key: your-secret" http://192.168.1.10:3000/instances/survival/running
# → {"running":true}
```

Then start the bot and run `/status` in Discord.

## Notes

- All wrapper HTTP calls from the bot have timeouts (8 s for reads, 30 s for script POSTs), so a hung wrapper cannot stall the bot.
- Log events stream over SSE (`GET /instances/:id/logs/stream`). The bot reconnects automatically with exponential backoff (5 s up to 60 s).
- Use a long random `apiKey`. The wrapper can run scripts and read files; treat the key like a password.

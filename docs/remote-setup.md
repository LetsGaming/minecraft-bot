# Remote Instance Setup

This guide explains how to run the Discord bot on a separate machine from your Minecraft server(s).

## Architecture

One API wrapper process runs on the MC server VM and serves **all** MC instances on that machine. The bot connects to it over a single HTTP connection.

```
Bot VM                      MC Server VM
┌─────────────────┐         ┌──────────────────────────────┐
│  Discord Bot    │──HTTP──▶│  API Wrapper (:3000)         │
│                 │         │  ├─ survival  (MC instance)  │
│                 │         │  └─ creative  (MC instance)  │
└─────────────────┘         └──────────────────────────────┘
```

Multiple VMs are supported — each VM gets its own wrapper process, and the bot connects to each independently.

For same-VM setups nothing changes: omit `apiUrl` from the server config and the bot accesses the filesystem and scripts directly.

---

## Step 1 — Deploy the API wrapper on the MC server VM

There are two ways to get the wrapper running. Choose the one that fits your setup.

### Option A — Via minecraft-server-setup (recommended)

If you set up your server with [minecraft-server-setup](https://github.com/letsgaming/minecraft-server-setup), enable the API wrapper in `variables.json` before running setup:

```json
"API_SERVER": {
  "ENABLED": true,
  "PORT": 3000,
  "API_KEY": "replace-with-a-long-random-secret"
}
```

Run setup normally, or pass the flag explicitly:

```bash
sudo -u <user> bash main.sh --api-server
```

The setup script deploys the wrapper, generates `api-server-config.json`, and creates a systemd service. You can skip to [Step 2](#step-2--configure-the-bot).

**Adding a second MC instance later:** run setup for the new instance with `--api-server` (or `API_SERVER.ENABLED=true`). The script updates the existing config and restarts the service — no manual editing needed.

---

### Option B — Standalone install

```bash
# On the MC server VM
git clone https://github.com/letsgaming/mc-api-server.git
cd mc-api-server
npm install --omit=dev
```

#### Configure

```bash
cp api-server-config.example.json api-server-config.json
nano api-server-config.json
```

Each key under `instances` is an instance ID that must match the corresponding `servers` key in the bot's `config.json`:

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
      "rconHost": "localhost",
      "rconPort": 25575,
      "rconPassword": "your-rcon-password",
      "backupsPath": "/home/minecraft/backups/survival"
    },
    "creative": {
      "serverPath": "/home/minecraft/minecraft-server/creative",
      "scriptsDir": "/home/minecraft/minecraft-server/scripts/creative",
      "linuxUser": "minecraft",
      "rconPort": 25576,
      "rconPassword": "your-rcon-password"
    }
  }
}
```

| Field          | Required | Description                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------------- |
| `serverPath`   | **Yes**  | Absolute path to the MC server directory (contains `server.jar`, `logs/`, etc.) |
| `scriptsDir`   | No       | Directory with management scripts (`start.sh`, `shutdown.sh`, etc.)             |
| `linuxUser`    | No       | Linux user that owns the MC process (default: `minecraft`)                      |
| `useRcon`      | No       | Enable RCON for commands and player queries (default: `false`)                  |
| `rconPort`     | No       | RCON port (default: `25575`)                                                    |
| `rconPassword` | No       | RCON password (required when `useRcon` is `true`)                               |
| `backupsPath`  | No       | Path to the backups root directory                                              |

#### Run

**Directly (testing only):**

```bash
node index.js
```

**With PM2 (recommended for production):**

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup   # run the printed command as root to enable autostart on boot
```

#### Sudoers

Script routes (`start`, `stop`, `restart`, `backup`) run management scripts as the Minecraft user via `sudo -n`. Configure `/etc/sudoers` to allow this — see [docs/sudoers-setup.md](./sudoers-setup.md).

#### Firewall

Allow inbound TCP on the wrapper port from the bot VM's IP only:

```bash
ufw allow from <BOT_VM_IP> to any port 3000 proto tcp
```

---

## Step 2 — Configure the bot

Add `apiUrl` (and `apiKey`) to each remote server entry in `config.json`. The key name must match the `instances` key in `api-server-config.json`:

```json
{
  "servers": {
    "survival": {
      "apiUrl": "http://192.168.1.10:3000",
      "apiKey": "replace-with-a-long-random-secret"
    },
    "creative": {
      "apiUrl": "http://192.168.1.10:3000",
      "apiKey": "replace-with-a-long-random-secret"
    }
  }
}
```

Both instances point to the same `apiUrl` — the wrapper routes each request to the correct instance based on the `:id` segment in the URL path.

When `apiUrl` is set, the bot routes all file reads, log streaming, and script execution through the wrapper. RCON commands go directly from the bot to the MC server — the wrapper is not involved in that path.

For local instances, omit `apiUrl` — behaviour is unchanged. You can mix local and remote instances freely.

---

## Step 3 — Verify

```bash
# From the bot VM — /health requires no API key
curl http://192.168.1.10:3000/health
# → {"ok":true}

# Test an authenticated route
curl -H "x-api-key: your-secret" http://192.168.1.10:3000/instances/survival/running
# → {"running":true}
```

---

## Notes

- **RCON vs screen**: RCON connects directly from the bot to the MC server — the wrapper is not in that path. The wrapper uses RCON (or screen as a fallback) for its own status checks and command forwarding.
- **Log streaming**: The bot connects to `GET /instances/:id/logs/stream` (SSE) for real-time log events.
- **Same VM with Docker**: If the bot runs in Docker on the same host as the MC server, point `apiUrl` at `http://host.docker.internal:3000`. See [docs/docker.md](./docker.md).

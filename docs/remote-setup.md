# Remote Instance Setup

This guide explains how to run the Discord bot on a separate machine from your Minecraft server(s).

## Architecture

```
Bot VM                      MC Server VM
┌─────────────────┐         ┌──────────────────────────────┐
│  Discord Bot    │──HTTP──▶│  API Wrapper (:3000)         │
│                 │         │  ├─ survival  (MC instance)  │
│                 │         │  └─ creative  (MC instance)  │
└─────────────────┘         └──────────────────────────────┘
```

Each MC server VM runs one **API wrapper** process. That wrapper has full local access to all MC instances on that VM. The bot connects to it over HTTP. Multiple VMs are supported — each gets its own wrapper.

For same-VM setups nothing changes: just omit `apiUrl` from the server config and the bot behaves exactly as before.

---

## Step 1 — Set up the API wrapper on the MC server VM

### Copy the api-server directory

```bash
# On the MC server VM
cp -r /path/to/minecraft-bot/api-server /opt/mc-api-server
cd /opt/mc-api-server
npm install
npm run build
```

### Create the config

```bash
cp api-server-config.example.json api-server-config.json
nano api-server-config.json
```

Fill in your instances. Each key is an instance ID that must match what the bot config uses:

```json
{
  "port": 3000,
  "apiKey": "replace-with-a-long-random-secret",
  "instances": {
    "survival": {
      "serverDir": "/home/minecraft/minecraft-server/survival",
      "scriptDir": "/home/minecraft/minecraft-server/scripts/survival",
      "linuxUser": "minecraft",
      "screenSession": "survival",
      "useRcon": true,
      "rconHost": "localhost",
      "rconPort": 25575,
      "rconPassword": "your-rcon-password"
    }
  }
}
```

### Run the wrapper

**Directly:**
```bash
npm start
```

**With PM2 (recommended):**
```bash
npm install -g pm2
pm2 start dist/index.js --name mc-api-server
pm2 save
pm2 startup
```

### Firewall

Only allow inbound TCP on port 3000 from the bot VM's IP:

```bash
ufw allow from <BOT_VM_IP> to any port 3000 proto tcp
```

---

## Step 2 — Configure the bot

Add `apiUrl` (and optionally `apiKey`) to any server entry in `config.json`:

```json
{
  "servers": {
    "survival": {
      "apiUrl": "http://192.168.1.10:3000",
      "apiKey": "replace-with-a-long-random-secret"
    }
  }
}
```

That's it. When `apiUrl` is present the bot forwards all filesystem and shell operations to the wrapper. RCON commands go directly from the bot to the MC server (the wrapper is not in that path).

For local instances simply omit `apiUrl` — behaviour is unchanged.

---

## Step 3 — Verify

```bash
# From the bot VM
curl -H "x-api-key: your-secret" http://192.168.1.10:3000/health
# → {"ok":true,"instances":["survival"]}
```

---

## Notes

- **RCON vs screen**: RCON still connects directly from the bot (or from the wrapper for status checks). The wrapper handles log streaming, file reads, and script execution.
- **Log streaming**: The bot connects to `GET /instances/:id/logs/stream` (SSE) for real-time log events. Reconnects automatically with exponential backoff.
- **Multiple VMs**: Add one `apiUrl` per server in `config.json`, each pointing to the wrapper on that VM.
- **Same VM**: Any server entry without `apiUrl` runs locally. You can mix local and remote instances freely.

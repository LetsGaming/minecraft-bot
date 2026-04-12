# Configuration

All configuration lives in a single `config.json` file in the project root. Copy `config_structure.json` as a starting point — it serves as the canonical template with all available fields and is always up to date with the codebase.

## Finding IDs

Several fields require Discord IDs. To get them:

1. Open Discord Settings → Advanced → enable **Developer Mode**.
2. Right-click any user, channel, or server name → **Copy ID**.

## Bot Credentials

```json
{
  "token": "your-discord-bot-token",
  "clientId": "your-discord-app-id"
}
```

| Field | What to put here |
|---|---|
| `token` | The bot token from the [Discord Developer Portal](https://discord.com/developers/applications) → your app → Bot → Token. |
| `clientId` | The Application ID from the same portal → General Information → Application ID. |

## Admin Users

```json
{
  "adminUsers": ["123456789012345678", "987654321098765432"]
}
```

A list of Discord user IDs. These users can use server control commands (`/server start/stop/restart`) and whitelist commands (`/verify`, `/unwhitelist`). Everyone else will see a "no permission" error.

To add yourself: right-click your own name in Discord → Copy User ID → paste it here.

## Servers

Each Minecraft server instance gets its own entry. The key (e.g. `"survival"`) is the ID you'll reference everywhere else.

```json
{
  "servers": {
    "survival": {
      "serverDir": "/home/minecraft/servers/survival",
      "scriptDir": "/home/minecraft/scripts/survival",
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

| Field | Required | Description |
|---|---|---|
| `serverDir` | Yes | Absolute path to the Minecraft server directory (where `server.jar`, `whitelist.json`, and `logs/` live). |
| `scriptDir` | No | Path to the directory containing `start.sh`, `shutdown.sh`, and `smart_restart.sh`. Defaults to `serverDir` if not set. |
| `linuxUser` | No | The Linux user that runs the Minecraft server. Defaults to `"minecraft"`. Used for `screen` and `sudo` commands. |
| `screenSession` | No | Name of the `screen` session the server runs in. Defaults to `"server"`. Only needed if RCON is disabled. |
| `useRcon` | No | Set to `true` to communicate with the server via RCON (recommended). Falls back to `screen` if RCON fails. |
| `rconHost` | No | RCON hostname. Defaults to `"localhost"`. |
| `rconPort` | No | RCON port number. Defaults to `25575`. Must match `rcon.port` in your `server.properties`. |
| `rconPassword` | No | RCON password. Must match `rcon.password` in your `server.properties`. Required if `useRcon` is `true`. |

### Enabling RCON on your Minecraft server

In your `server.properties`, set:

```
enable-rcon=true
rcon.port=25575
rcon.password=your-rcon-password
```

Restart the Minecraft server after changing these. RCON is strongly recommended — without it, many features (TPS monitoring, player coordinates, live player list) won't work or will be less reliable.

### Multiple servers

Add more entries under `servers`:

```json
{
  "servers": {
    "survival": { "serverDir": "/home/minecraft/servers/survival", "..." : "..." },
    "creative": { "serverDir": "/home/minecraft/servers/creative", "..." : "..." }
  }
}
```

Commands that accept a `server` option will autocomplete with these IDs. If no server is specified, the guild's default server is used.

## Guilds

Each Discord server (guild) can be configured independently. The key is the guild's Discord ID.

```json
{
  "guilds": {
    "111222333444555666": {
      "defaultServer": "survival",
      "chatBridge": { ... },
      "notifications": { ... },
      "leaderboard": { ... },
      "tpsAlerts": { ... },
      "statusEmbed": { ... },
      "downtimeAlerts": { ... }
    }
  }
}
```

| Field | Description |
|---|---|
| `defaultServer` | Which server ID to use when a user doesn't specify one in a command. |

Every subsection below is optional. Only add the ones you want.

### Chat Bridge

Bridges messages between a Discord channel and the Minecraft server chat.

```json
"chatBridge": {
  "channelId": "CHANNEL_ID",
  "server": "survival"
}
```

| Field | Description |
|---|---|
| `channelId` | The Discord channel where Minecraft chat messages appear and Discord messages get forwarded to the game. |
| `server` | Which server to bridge. |

### Notifications

Posts server events (player joins, deaths, advancements, etc.) to a Discord channel.

```json
"notifications": {
  "channelId": "CHANNEL_ID",
  "events": ["join", "leave", "death", "advancement", "start", "stop"]
}
```

| Field | Description |
|---|---|
| `channelId` | The channel to post events in. |
| `events` | Which events to post. Remove any you don't want. |

### Leaderboard Scheduler

Auto-posts a playtime leaderboard at a regular interval. Shows only stats gained during that period (not all-time).

```json
"leaderboard": {
  "channelId": "CHANNEL_ID",
  "interval": "weekly",
  "server": "survival"
}
```

| Field | Description |
|---|---|
| `channelId` | Where the leaderboard gets posted. |
| `interval` | `"daily"`, `"weekly"`, or `"monthly"`. |
| `server` | Which server's stats to use. |

The bot takes hourly stat snapshots in the background. When a leaderboard is due, it compares current stats against the snapshot from the start of the period. Old snapshots are cleaned up automatically.

### TPS Alerts

Warns when server TPS (ticks per second) drops below a threshold.

```json
"tpsAlerts": {
  "channelId": "CHANNEL_ID",
  "server": "survival"
}
```

| Field | Description |
|---|---|
| `channelId` | Channel to post TPS warnings in. |
| `server` | Which server to monitor. Omit to monitor all. |

### Status Embed

A persistent, auto-updating message showing server status, player count, online players, and TPS.

```json
"statusEmbed": {
  "channelId": "CHANNEL_ID"
}
```

| Field | Description |
|---|---|
| `channelId` | The channel where the status message lives. The bot sends it once, then edits it every 60 seconds. |

No other configuration needed. If the message gets deleted, the bot automatically sends a new one. Recommended: use a dedicated channel for this so the embed doesn't get buried.

### Downtime Alerts

Notifies when a server goes down unexpectedly and when it recovers.

```json
"downtimeAlerts": {
  "channelId": "CHANNEL_ID",
  "server": "survival"
}
```

| Field | Description |
|---|---|
| `channelId` | Channel to post downtime/recovery alerts in. |
| `server` | Which server to monitor. Omit to monitor all. |

The monitor checks every 60 seconds and only alerts after 3 consecutive failures (3 minutes of downtime). This prevents false alarms from brief hiccups. When an admin uses `/server stop` or `/server restart`, alerts are automatically suppressed for 5 minutes.

## Global Settings

```json
{
  "tpsWarningThreshold": 15,
  "tpsPollIntervalMs": 60000,
  "leaderboardInterval": "weekly"
}
```

| Field | Default | Description |
|---|---|---|
| `tpsWarningThreshold` | `15` | TPS value below which a warning is sent. Normal is 20. |
| `tpsPollIntervalMs` | `60000` | How often to check TPS, in milliseconds. |
| `leaderboardInterval` | `"weekly"` | Fallback interval if a guild doesn't specify one. |

## Command Toggles

Disable specific commands by name:

```json
{
  "commands": {
    "map": { "enabled": false, "url": "http://example.com/map" },
    "seed": { "enabled": true }
  }
}
```

Setting `"enabled": false` prevents the command from being registered. The `map` command also requires a `url` field pointing to your Dynmap or Bluemap instance.

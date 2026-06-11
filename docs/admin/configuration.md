# Configuration

All configuration lives in a single `config.json` in the project root. `config_structure.json` is the canonical template with every available field. Copy it as a starting point:

```bash
cp config_structure.json config.json
```

Or generate it interactively:

```bash
npm run setup
```

The bot validates `config.json` at startup. Wrong types or missing required fields produce a clear error message naming the exact field, instead of a cryptic crash later.

## Top-level structure

```json
{
  "token": "...",
  "clientId": "...",
  "adminUsers": ["..."],
  "servers": { ... },
  "guilds": { ... },
  "commands": { ... },
  "tpsWarningThreshold": 15,
  "tpsPollIntervalMs": 60000,
  "leaderboardInterval": "weekly"
}
```

## Bot credentials

| Field | Required | What to put here |
|---|---|---|
| `token` | Yes | Bot token from the [Developer Portal](https://discord.com/developers/applications) → your app → Bot → Token. |
| `clientId` | Yes | Application ID from General Information. |

## Admin users

```json
"adminUsers": ["123456789012345678"]
```

A list of Discord user IDs allowed to use admin commands: `/server` (start, stop, restart, backup, status), `/whitelist`, `/verify`, `/unwhitelist`, and `/config`. Everyone else gets a permission error.

To find an ID: enable Developer Mode (Discord Settings → Advanced), right-click a user → Copy User ID.

## Servers

Each Minecraft instance gets one entry. The key (here `"survival"`) is the server ID used everywhere else: in guild configs, in the `server` option of slash commands, and in autocomplete.

Note: `scriptDir`, the `/backup` overview, and `/mods` assume a server installed with [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup). On a plain server, disable the dependent commands or provide compatible scripts; see [setup.md](setup.md#plain-server-or-setup-suite-server) for the feature matrix.

```json
"servers": {
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
```

| Field | Required | Default | Description |
|---|---|---|---|
| `serverDir` | Yes (local) | | Absolute path to the server directory (contains `server.jar`, `whitelist.json`, `logs/`). |
| `scriptDir` | No | derived | Directory with the management scripts (`start.sh`, `shutdown.sh`, `smart_restart.sh`, `backup/backup.sh`, `misc/status.sh`). If unset, the bot looks for `{serverDir}/../scripts/{screenSession}` and uses it when it exists. |
| `linuxUser` | No | `minecraft` | The Linux user that owns the server process. Used for `sudo -u` and screen commands. |
| `screenSession` | No | `server` | Name of the `screen` session. Only relevant when RCON is unavailable. |
| `useRcon` | No | `false` | Talk to the server via RCON (recommended). Falls back to screen if an RCON call fails. |
| `rconHost` | No | `localhost` | RCON hostname. |
| `rconPort` | No | `25575` | Must match `rcon.port` in `server.properties`. |
| `rconPassword` | No | | Must match `rcon.password`. Required when `useRcon` is `true`. |
| `apiUrl` | No | | Base URL of the API wrapper for remote setups, e.g. `http://192.168.1.10:3000`. When set, all filesystem and script operations are routed through the wrapper. See [remote-setup.md](remote-setup.md). |
| `apiKey` | No | | Shared secret for the API wrapper, sent as the `x-api-key` header. |

### variables.txt overrides

If `scriptDir` points to a directory from the [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup) project, the bot reads `{scriptDir}/common/variables.txt` and the values there take precedence over `config.json`:

| variables.txt key | Overrides |
|---|---|
| `SERVER_PATH` | `serverDir` |
| `USER` | `linuxUser` |
| `INSTANCE_NAME` | `screenSession` |
| `USE_RCON` | `useRcon` |
| `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD` | the matching `rcon*` fields |

This keeps the bot and the server scripts in sync from a single source of truth. If a value in Discord looks different from what you set in `config.json`, check `variables.txt` first.

### Multiple servers

Add more entries under `servers`. Commands that take a `server` option autocomplete with the IDs. When no server is given, the guild's `defaultServer` is used.

## Guilds

Each Discord server is configured independently. The key is the guild ID. Every feature block is optional; only add what you want.

```json
"guilds": {
  "111222333444555666": {
    "defaultServer": "survival",
    "chatBridge":     { "channelId": "...", "server": "survival" },
    "notifications":  { "channelId": "...", "events": ["join", "leave", "death", "advancement", "start", "stop"] },
    "leaderboard":    { "channelId": "...", "interval": "weekly", "server": "survival" },
    "tpsAlerts":      { "channelId": "...", "server": "survival" },
    "downtimeAlerts": { "channelId": "...", "server": "survival" },
    "statusEmbed":    { "enabled": true },
    "channelPurge":   { "channelId": "..." }
  }
}
```

| Block | Fields | What it does |
|---|---|---|
| `defaultServer` | server ID | Used when a command is run without an explicit `server` option. |
| `chatBridge` | `channelId`, `server` | Two-way chat between this channel and the Minecraft chat. |
| `notifications` | `channelId`, `events` | Posts join/leave/death/advancement/start/stop events. Remove event names you do not want. Note: in multi-server setups, events from all servers are posted (there is currently no per-server filter for notifications). |
| `leaderboard` | `channelId`, `interval`, `server` | Auto-posts a period leaderboard (playtime and blocks mined). `interval` is `daily`, `weekly`, or `monthly`. |
| `tpsAlerts` | `channelId`, `server` | Warns when TPS drops below `tpsWarningThreshold`. Omit `server` to alert for all servers. |
| `downtimeAlerts` | `channelId`, `server` | Alerts on unexpected downtime and recovery. Omit `server` to monitor all. |
| `statusEmbed` | `enabled` | Self-provisioning live status display, see below. |
| `channelPurge` | `channelId` | Deletes all messages in the channel daily at local midnight, except pinned messages and the status embed. |

Details on how each feature behaves are in [automated-features.md](automated-features.md).

### Status embed: important

The status embed is fully self-provisioning. The bot creates its own private category ("📊 Server Status") with a `#server-status` text channel and a player-counter voice channel. You do not configure a channel ID for it.

It defaults to enabled for every configured guild. To turn it off for a guild, set it explicitly:

```json
"statusEmbed": { "enabled": false }
```

The bot needs the Manage Channels permission for this feature.

## Global settings

| Field | Default | Description |
|---|---|---|
| `tpsWarningThreshold` | `15` | TPS below this value triggers a warning. Normal is 20. |
| `tpsPollIntervalMs` | `60000` | TPS polling interval in milliseconds. Minimum 1000. |
| `leaderboardInterval` | `"weekly"` | Fallback interval for guilds without their own `leaderboard.interval`. |

## Command toggles

Disable a command (slash or in-game) by its name. Disabled commands are not registered at all.

```json
"commands": {
  "map":  { "enabled": false, "url": "https://map.example.com" },
  "seed": { "enabled": true }
}
```

The `map` command additionally needs the `url` field pointing to your Dynmap/Bluemap instance. Command toggles apply to in-game commands too: `"link": { "enabled": false }` disables `!link`.

## Environment variable overrides

Environment variables take precedence over `config.json`. This is how Docker and Kubernetes secret injection works without touching config files:

| Variable | Overrides |
|---|---|
| `DISCORD_TOKEN` | `token` |
| `DISCORD_CLIENT_ID` | `clientId` |
| `RCON_PASSWORD` | `rconPassword` for all servers |
| `RCON_PASSWORD_<SERVER_ID>` | `rconPassword` for one server. The ID is uppercased and non-alphanumerics become `_`, so server `my-smp` reads `RCON_PASSWORD_MY_SMP`. |

## Hot reload

The bot watches `config.json` for changes and reloads it automatically (debounced, a malformed save keeps the old config active). Admins can also run `/config reload` in Discord, and `/config show` displays the running configuration with secrets redacted.

One limitation: server connections (RCON clients, log watchers) are created at startup. Changing channel IDs, admins, or thresholds applies live; adding or removing a server entry requires a bot restart to take effect.

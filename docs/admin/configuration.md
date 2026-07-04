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

A list of Discord **user IDs and/or role IDs** allowed to use admin commands: `/server` (start, stop, restart, backup, status, prune-stats), `/whitelist`, `/verify`, `/unwhitelist`, `/whois`, and `/config`. A user qualifies by their own ID or by carrying any listed role. Everyone else gets a permission error.

This top-level list is **operator-level**: it is valid in every guild and against every server. If the bot serves multiple communities, prefer keeping this list to yourself and granting community moderators a **guild-scoped** `adminUsers` list inside their guild block instead (see [Guilds](#guilds)) — those admins can only act within their own guild, and only against the servers that guild is allowed to target.

To find an ID: enable Developer Mode (Discord Settings → Advanced), right-click a user or role → Copy ID.

## Language

```json
"language": "de"
```

Locale for user-visible bot strings (`"en"` default, `"de"` available). Currently covers the newer commands (`/whois`, `/daily-reminder`); older commands are migrated key-by-key — see the localization section in [../dev/architecture.md](../dev/architecture.md).

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
    "adminUsers":     ["444555666777888999"],
    "allowedServers": ["survival"],
    "chatBridge":     [
      { "channelId": "...", "server": "survival" },
      { "channelId": "...", "server": "creative" }
    ],
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
| `adminUsers` | user/role IDs | Admins **scoped to this guild** — same semantics as the global list, but only valid for commands issued here, and only against servers this guild may target. The global `adminUsers` list remains operator-level. |
| `allowedServers` | server IDs | Which servers commands from this guild may target, including via the explicit `server:` option. **Only enforced when more than one guild is configured.** When omitted, the allowed set is derived from the servers referenced in this guild's config (`defaultServer` plus any feature `server` fields). The guild's `defaultServer` is always allowed. |
| `chatBridge` | one or more `{ channelId, server }` | Two-way chat between a Discord channel and **exactly one** server. Use an array for one channel per server. See [Chat bridges](#chat-bridges-one-channel--one-server). |
| `notifications` | `channelId`, `events`, `server` | Posts join/leave/death/advancement/start/stop events. Remove event names you do not want. `server` scopes the source (see [Server scoping](#server-scoping-one-several-or-all)); the source server is shown in the embed footer when more than one server is configured. |
| `leaderboard` | `channelId`, `interval`, `server` | Auto-posts a period leaderboard (playtime and blocks mined). `interval` is `daily`, `weekly`, or `monthly`. With a `server` list, one leaderboard is posted per server (prefixed with the server name). |
| `tpsAlerts` | `channelId`, `server` | Warns when TPS drops below `tpsWarningThreshold`. `server` scopes which servers alert. |
| `downtimeAlerts` | `channelId`, `server` | Alerts on unexpected downtime and recovery. `server` scopes which servers are monitored. |
| `statusEmbed` | `enabled` | Self-provisioning live status display, see below. |
| `channelPurge` | `channelId` | Deletes all messages in the channel daily at local midnight, except pinned messages and the status embed. |

Details on how each feature behaves are in [automated-features.md](automated-features.md).

### Server scoping: one, several, or all

Every push feature above (`notifications`, `leaderboard`, `tpsAlerts`, `downtimeAlerts`) takes the same `server` field with three forms:

```json
"server": "survival"                 // exactly this server
"server": ["survival", "creative"]   // these servers
// omitted                           // every server this guild can see
```

"Every server this guild can see" means **all configured servers** in a single-guild setup, and the guild's allowed set (see multi-guild isolation below) otherwise — so omitting `server` is always safe and never leaks another community's events into your channels.

Typical setups:

- **One guild, one server** — omit `server` everywhere. Done.
- **One guild, several servers** — omit `server` to see everything in one channel (embeds name the source server), pin `"server": "survival"` for a dedicated channel, or use a list for anything in between.

### Chat bridges: one channel ↔ one server

A chat bridge binds a Discord channel to **exactly one** server, in both directions. What players say on that server appears in that channel; what members type in that channel goes to that server — and only there. Conversations from different servers can never mix, so nobody replies to a "survival" player and lands in "creative" chat.

```json
// one server → one bridge
"chatBridge": { "channelId": "111...", "server": "survival" }

// several servers → one channel per server (recommended)
"chatBridge": [
  { "channelId": "111...", "server": "survival" },
  { "channelId": "222...", "server": "creative" }
]
```

`server` may only be omitted when it is unambiguous: the guild has a `defaultServer`, or only one server is configured. Anything else — and any channel bound to two different servers — is rejected at startup and by `/config reload` with a message naming the exact bridge to fix.

> **Upgrading from older versions:** an unpinned bridge used to *receive* chat from every server while *sending* replies to only one — the exact mixing this redesign removes. If your multi-server config relied on that, validation now tells you which bridge to pin; add `"server"` (or split into one channel per server) and reload.

### Multi-guild isolation

When the bot serves **more than one guild**, tenant isolation kicks in automatically: commands from a guild can only target that guild's allowed servers (explicit `allowedServers`, or derived from the guild's config). A guild-B admin cannot `/server stop server:guild-a-survival` — the command fails with a clear error naming `allowedServers` as the fix. Unconfigured guilds and DMs cannot target servers at all in multi-guild mode; only global (operator-level) admins bypass these checks. The server-ID autocomplete and the `/uptime` overview are filtered the same way, so guilds do not see each other's server IDs.

With a single configured guild nothing changes — every server stays reachable, exactly as before.

### Status embed: important

The status embed is fully self-provisioning. The bot creates its own private category ("📊 Server Status") with a `#server-status` text channel and a player-counter voice channel. You do not configure a channel ID for it.

It is opt-in: set it explicitly to activate it for a guild:

```json
"statusEmbed": { "enabled": true }
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

Any slash command can additionally be gated behind the admin check with `adminOnly`:

```json
"commands": {
  "say": { "adminOnly": true }
}
```

This uses the same check as the built-in admin commands (global `adminUsers`, or the issuing guild's `adminUsers`). It is most useful for `/say`, which writes to the game chat and is open to everyone by default. The setting is read live, so `/config reload` applies it without a restart. Note that `/say` and the chat bridge are also rate-limited per user (the bridge allows short bursts of 8 messages per 10 seconds), so a flood cannot saturate the game console either way.

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

What applies live:

- Channel IDs, admins, thresholds, and other settings read on each use.
- **Adding a server entry**: the instance is created and its log watcher, notifications, TPS monitor, snapshots, and downtime checks start immediately.
- **Removing a server entry**: its log watcher and TPS monitor are stopped, the RCON connection is closed, and the instance is dropped from routing.
- **Suite capabilities** (management scripts, backup layout, mod manifest) are re-detected for every server on each reload — installing the setup suite for an existing server takes effect immediately, except that a `/backup` or `/mods` command skipped at startup (because no server had the capability) is only registered after a restart.

One limitation remains: **changing the settings of an existing server entry** (e.g. its RCON host, port, or password) is not applied live, because the running instance keeps the connection it was built with. The reload reports such servers as restart-required. Workaround without a full restart: temporarily remove the entry, reload, re-add it with the new settings, and reload again.

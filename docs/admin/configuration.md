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

Locale for user-visible bot strings (`"en"` default, `"de"` available). Individual guilds can override it with `guilds.<id>.language` — embeds and command replies then localize per guild, while in-game strings and DMs stay on the global language (one Minecraft server can serve several guilds, so there is no single correct guild to borrow a locale from).

## Servers

Each Minecraft instance gets one entry. The key (here `"survival"`) is the server ID used everywhere else: in guild configs, in the `server` option of slash commands, and in autocomplete.

Note: the `/backup` overview and `/mods` assume a server installed with [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup). On a plain server, disable the dependent commands or point the wrapper at compatible scripts; see [setup.md](setup.md#plain-server-or-setup-suite-server) for the feature matrix.

```json
"servers": {
  "survival": {
    "apiUrl": "http://192.168.1.10:3030",
    "apiKey": "sk_live_..."
  }
}
```

| Field | Required | Default | Description |
|---|---|---|---|
| `apiUrl` | Yes | | Base URL of the [API wrapper](remote-setup.md) on the Minecraft host, e.g. `http://192.168.1.10:3030`. Everything the bot does to a server goes through it. |
| `apiKey` | Yes | | Shared secret for that wrapper, sent as the `x-api-key` header. Can come from the environment instead — see below. |
| `allowInsecureHttp` | No | `false` | Suppress the warning for a plaintext `apiUrl`. Only meaningful on a private network; for a public host the bot refuses to start regardless. |
| `commands` | No | | Per-server command overrides. Same shape as the top-level `commands` block. |

Since 5.0.0 that is the whole server block. Everything else that used to live here — `serverDir`, `scriptDir`, `linuxUser`, `screenSession`, `useRcon`, `rconHost`, `rconPort`, `rconPassword` — described the Minecraft host, and now lives in the wrapper's config on that host. The bot refuses to start if any of them are still present and names them. See [migrating-to-5.md](migrating-to-5.md).

### API keys from the environment

`apiKey` does not have to be in `config.json`:

| Variable | Applies to |
|---|---|
| `API_KEY_<SERVER_ID>` | that server (e.g. `API_KEY_SURVIVAL` for `"survival"`) |
| `API_KEY` | every server without a more specific key |

The override is applied before validation, so a deployment that supplies keys only through the environment is not rejected for the value it is about to provide. It replaces `RCON_PASSWORD_<ID>`, which configured the bot's own RCON connection and no longer exists.

### variables.txt

The wrapper reads `{scriptsDir}/common/variables.txt` from a [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup) installation and takes `SERVER_PATH`, `USER`, `INSTANCE_NAME`, `USE_RCON`, and the `RCON_*` values from it, so the server scripts and the wrapper stay in sync from one source of truth. That file governs the wrapper's config, not the bot's — the bot has no fields left for it to override.

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
| `language` | `"en"` / `"de"` | Per-guild language for embeds and replies; overrides the global `language`. |
| `chatBridge` | one or more `{ channelId, server, useWebhook }` | Two-way chat between a Discord channel and **exactly one** server. Use an array for one channel per server. With `"useWebhook": true` MC→Discord lines appear as the player (name + head) via a channel webhook (bot needs Manage Webhooks; falls back to the embed form on any webhook problem). See [Chat bridges](#chat-bridges-one-channel--one-server). |
| `notifications` | `channelId`, `events`, `server` | Posts join/leave/death/advancement/start/stop events. Remove event names you do not want. `server` scopes the source (see [Server scoping](#server-scoping-one-several-or-all)); the source server is shown in the embed footer when more than one server is configured. |
| `leaderboard` | `channelId`, `interval`, `server`, `categories` | Auto-posts period leaderboards. `interval` is `daily`, `weekly`, or `monthly`. With a `server` list, one set is posted per server. `categories` picks the boards (any `/leaderboard` stat key plus `"streak"` / `"longest_streak"`, max 10); default `["playtime", "mined"]`. |
| `tpsAlerts` | `channelId`, `server`, `mentionRole` | Warns when TPS drops below `tpsWarningThreshold`. `server` scopes which servers alert; `mentionRole` pings a role with each alert. |
| `downtimeAlerts` | `channelId`, `server`, `mentionRole` | Alerts on unexpected downtime and recovery (host-disk and backup-age alerts use this channel too). `mentionRole` pings a role with each alert. |
| `statusEmbed` | `enabled` | Self-provisioning live status display, see below. |
| `channelPurge` | `channelId` | Deletes all messages in the channel daily at local midnight, except pinned messages and the status embed. |
| `commands` | per-command settings | Per-guild overrides for slash commands (enabled / adminOnly), merged field-by-field over the global `commands` block — see [Command settings](#command-settings-per-command-three-scopes). |
| `console` | `channelId` | Target channel for the `/console live` relay: an admin can stream a server's raw log into this (admin-only!) channel, batched and flood-protected. |
| `whitelistApplications` | `channelId`, `adminChannelId`, `mentionRole` | Button-based whitelist applications: the bot posts a persistent **Apply** button into `channelId`; applications (Minecraft name + optional note, server select in multi-server guilds) queue in `adminChannelId` with Approve/Deny buttons that survive restarts. Approval takes the same path as `/whitelist` and DMs the applicant. `mentionRole` pings a role on new applications. Both channel IDs are required for the feature to arm. |

Details on how each feature behaves are in [automated-features.md](automated-features.md).

### Linked role and reports

Two optional per-guild fields round out the account-link and moderation story:

```json
"guilds": {
  "123456789012345678": {
    "linkedRole": "234567890123456789",
    "reports": {
      "channelId": "345678901234567890",
      "mentionRole": "456789012345678901",
      "server": "smp"
    }
  }
}
```

`linkedRole` is assigned automatically when a member links their Minecraft account (`/link` → `!link CODE`) and removed again on `/unlink`. The bot needs **Manage Roles** and must sit **above** the role in the role list; failures are written to the admin audit log and never break the link itself.

`reports` routes the in-game `!report <message>` command: the report lands as an embed (player head, message, server, timestamp) in `channelId`, optionally pinging `mentionRole`. `server` scopes which instances may report into this guild — same semantics as every other scoped feature. Without a configured report channel, players get told reports aren't set up rather than reporting into the void.

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
| `presence` | off | Bot presence with live player count, e.g. "Playing 7 online @ smp". `{ "enabled": true }` aggregates across all servers; pin one with `"server": "smp"`. `format` supports `{online}`, `{max}`, `{server}`. While the pinned server is down (or, unpinned, while EVERY instance is down) the presence switches to the `downFormat` template (default `"⛔ {server} offline"`) with idle status. Updates on the status cadence (60 s); flipping presence on/off applies on config reload. |
| `deathCoords` | off | `{ "dmLinked": true }` DMs a linked player their death coordinates plus a Chunkbase link whenever they die. The in-game `!deathpos` command works regardless of this flag. |
| `hostAlerts` | `{ "diskWarnPercent": 90 }` | Disk-full early warning: when a monitored path reaches the threshold, each guild's `downtimeAlerts` channel gets one alert (with hysteresis and an all-clear). Remote instances are covered through the wrapper's `/info` (wrapper ≥ 1.2.0). `0` disables. Add `"backupMaxAgeHours": 26` to also alert when the NEWEST backup of a server is older than that (clears automatically when a fresh backup appears); off by default. |
| `waypoints` | `{ "maxPerServer": 100 }` | Per-server cap on community waypoints. |
| `limits` | defaults | Rate-limit overrides: `slashCapacity`/`slashWindowMs` (default 5 per 30 s) and `bridgeCapacity`/`bridgeWindowMs` (default 8 per 10 s). Applied at startup. |
| `updateNotifier` | `{ "enabled": true }` | Daily GitHub release check; logs when a newer release exists. `"dmAdmins": true` additionally DMs the operator-level admins once per new version. `"enabled": false` opts out. |
| `schedules` | off | Scheduled restarts per server: `"schedules": { "smp": { "restart": { "time": "04:00", "days": ["MO","TH"], "warnMinutes": [15, 5, 1] } } }`. Countdown warnings go in-game (`/say`) and to notification channels (event `scheduledRestart`); the restart uses the suite's restart script with downtime alerts suppressed, and is admin-audited. `days` omitted = daily. Applies live on config reload. |
| `milestones` | off | Milestone announcements per leaderboard stat key, thresholds in the stat's native unit (playtime is ticks: 100 h = `7200000`): `"milestones": { "playtime": [7200000], "diamonds": [100, 1000] }`. Announced in-game and via the `milestone` notification event. First activation seeds silently so veterans' whole histories are not blasted at once. |
| `webui` | off | Web dashboard (separate process, `npm run start:web`): `{ "enabled": true, "port": 8130, "host": "127.0.0.1", "publicUrl": "https://panel.example.com" }`. Secrets come from the environment (`WEBUI_CLIENT_SECRET`, `WEBUI_SESSION_SECRET`). See [../dev/web/readme.md](../dev/web/readme.md). |

## Command settings (per command, three scopes)

Every command — slash and in-game — takes per-command settings, resolvable at three scopes:

| Scope | Block | Governs |
|---|---|---|
| Global | top-level `commands` | fallback for everything |
| Per guild | `guilds.<id>.commands` | **slash** commands issued in that guild |
| Per server | `servers.<id>.commands` | **in-game** `!commands` on that server |

Resolution is **field-by-field**: a scoped entry only changes the fields it sets and inherits the rest from the global block (which in turn falls back to the defaults `enabled: true`, `adminOnly: false`). Any field added to command settings in the future automatically gets the same scoped fallback.

```json
"commands": {
  "map":  { "enabled": false, "url": "https://map.example.com" },
  "say":  { "adminOnly": true }
},
"guilds": {
  "111222333444555666": {
    "commands": {
      "say":  { "adminOnly": false },
      "poll": { "enabled": false }
    }
  }
},
"servers": {
  "creative": {
    "commands": {
      "slime": { "enabled": false }
    }
  }
}
```

In this example `/say` is admin-only everywhere except guild `1112…`, `/poll` is hidden in that one guild, and `!slime` doesn't respond on the creative server.

**Fields:**

- `enabled` — `false` hides the command in the scope. Slash commands reply with an ephemeral "disabled here"; in-game commands behave as nonexistent (silent). Enforcement happens at dispatch time, so `/config reload` and dashboard edits apply immediately. One exception: a command disabled in **every** scope is not registered at all, so re-enabling it from that state needs one bot restart.
- `adminOnly` — gates the command behind the admin check. For slash commands that is the global `adminUsers` or the issuing guild's `adminUsers`; for in-game commands the player's **linked Discord account** must pass the global admin check (game chat has no guild context, so guild-scoped admin lists don't apply there). `adminOnly` can only **add** a restriction: built-in admin commands (`/server`, `/config`, `/kick`, …) keep their own admin gate no matter what is configured here.
- `url` — used by `/map` only, pointing at your Dynmap/Bluemap instance.

The web dashboard has a **Commands** tab that edits exactly these blocks with a scope selector and shows the effective value per scope. Note that `/say` and the chat bridge are also rate-limited per user (the bridge allows short bursts), so a flood cannot saturate the game console either way.

## Environment variable overrides

Environment variables take precedence over `config.json`. This is how Docker and Kubernetes secret injection works without touching config files:

| Variable | Overrides |
|---|---|
| `DISCORD_TOKEN` | `token` |
| `DISCORD_CLIENT_ID` | `clientId` |
| `RCON_PASSWORD` | `rconPassword` for all servers |
| `RCON_PASSWORD_<SERVER_ID>` | `rconPassword` for one server. The ID is uppercased and non-alphanumerics become `_`, so server `my-smp` reads `RCON_PASSWORD_MY_SMP`. |
| `WEBUI_CLIENT_SECRET` | Discord OAuth2 client secret for the dashboard login (no config.json equivalent — env only). |
| `WEBUI_SESSION_SECRET` | Dashboard cookie-signing key (env only; any long random string). |

## Hot reload

The bot watches `config.json` for changes and reloads it automatically (debounced, a malformed save keeps the old config active). Admins can also run `/config reload` in Discord, and `/config show` displays the running configuration with secrets redacted.

What applies live:

- Channel IDs, admins, thresholds, and other settings read on each use.
- **Adding a server entry**: the instance is created and its log watcher, notifications, TPS monitor, snapshots, and downtime checks start immediately.
- **Removing a server entry**: its log watcher and TPS monitor are stopped, the RCON connection is closed, and the instance is dropped from routing.
- **Suite capabilities** (management scripts, backup layout, mod manifest) are re-detected for every server on each reload — installing the setup suite for an existing server takes effect immediately, except that a `/backup` or `/mods` command skipped at startup (because no server had the capability) is only registered after a restart.
- **Presence / status embed** timers are armed or disarmed on reload, so flipping `presence.enabled` or a guild's `statusEmbed.enabled` no longer needs a restart.
- **Restart schedules** are rebuilt from the fresh config on every reload.
- The reload reply (and the file-watcher log) summarizes guild- and feature-level changes (`~ guild 1112…: chatBridge added`), so edits are visible even when no server was added or removed.

One limitation remains: **changing the settings of an existing server entry** (e.g. its RCON host, port, or password) is not applied live, because the running instance keeps the connection it was built with. The reload reports such servers as restart-required. Workaround without a full restart: temporarily remove the entry, reload, re-add it with the new settings, and reload again.

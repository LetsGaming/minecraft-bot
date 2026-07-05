# Permissions, whitelist, and audit trail

## The admin model

The bot has exactly two permission levels: regular users and admins. The `adminUsers` list in `config.json` accepts Discord **user IDs and role IDs** (both are snowflakes, so they mix freely):

```json
"adminUsers": ["123456789012345678", "555555555555555555"]
```

A user counts as admin if their own ID is listed **or** they carry any listed role — so you can manage admin access entirely through a Discord role without touching the config for each person. Role checks only apply inside guilds (DM'd commands match by user ID only). There are no per-command grants; if finer control matters to you, restrict who can see the commands via Discord's own server settings (Server Settings → Integrations → your bot → command permissions). One exception: any slash command can be gated behind the admin check with the `adminOnly` command toggle (see [configuration.md](configuration.md#command-toggles)) — handy for `/say`.

### Two admin scopes

There are two places admins can be defined, with different reach:

| Scope | Where | Reach |
|---|---|---|
| **Operator** | top-level `adminUsers` | Every guild, every server, including DMs. |
| **Guild-scoped** | `guilds.<id>.adminUsers` | Admin commands only in that guild, and only against servers that guild may target (`allowedServers`, or the servers referenced in the guild's config). |

In a single-guild deployment the two behave identically. Once the bot serves several communities, guild-scoped admins are the safe way to hand moderation to each community: a guild-B moderator cannot stop, restart, or back up guild A's server — not even with the explicit `server:` option. See [Multi-guild isolation](configuration.md#multi-guild-isolation) for the targeting rules.

### Admin-only commands

| Command | What it does |
|---|---|
| `/server start` / `stop` / `restart` | Runs the matching management script (`start.sh`, `shutdown.sh`, `smart_restart.sh`). Stop and restart automatically suppress downtime alerts for 5 minutes. |
| `/server backup` | Runs `backup/backup.sh`; the `archive` option creates an archive backup instead of an hourly one. |
| `/server status` | Runs `misc/status.sh` and shows its output. |
| `/whitelist` | Validates a username against the Mojang API, then whitelists it. |
| `/verify` | Identical to `/whitelist` (kept as an alias). |
| `/unwhitelist` | Removes a player from the whitelist. |
| `/config show` / `/config reload` | Inspect the running config (secrets redacted) or hot-reload it from disk. |
| `/server prune-stats` | Lists (dry run) or deletes stats files of players no longer on the whitelist. |
| `/whois` | Shows the whitelist audit entry (who added/removed a player, when, where) and the linked Discord account for a Minecraft username. |

A non-admin running any of these gets a clean "You do not have permission to use this command" error. The `/clear` command is gated differently: Discord itself only shows it to members with the Manage Messages permission.

In addition, every user is rate-limited to 5 slash commands per 30 seconds to protect the RCON connection from spam, and the Discord→Minecraft chat bridge has its own per-user limit (bursts of up to 8 messages per 10 seconds; messages beyond that get a ⏳ reaction instead of reaching the game).

## The new admin commands (3.6.0)

| Command | What it does |
|---|---|
| `/kick`, `/ban`, `/pardon` | Thin moderation shortcuts over the console commands; the reason (if any) reaches the player/ban list and the audit log. |
| `/console tail` | The last N log lines, ephemeral. |
| `/console live enable\|disable` | Toggle the batched live log relay into the guild's `console.channelId` — an exposure decision, so it is audited. |
| `/daily-admin move\|reset\|show` | Repair tooling for per-server daily-claim records (e.g. streaks stranded on the wrong server by the v2 migration). Mutations are audited. |
| `/poll create servers:` | Span polls across several instances — every listed ID passes the same tenant-isolation check as the `server:` option. |

Whitelist-application decisions (the Approve/Deny buttons) enforce exactly the same admin check as slash commands, regardless of who can see the queue channel.

### Dashboard access

The web dashboard logs in via Discord OAuth2 and admits only **user-ID entries** of the global `adminUsers` and each guild's `adminUsers`. Role entries cannot be resolved there (that would require guild member lookups) — roles remain a Discord-side permission. Removing a user ID from the lists locks them out of the dashboard immediately (sessions are re-checked per request).

## Whitelist management

Add a player:

```
/whitelist username:PlayerName
```

This first checks with Mojang that the name actually exists (catches typos before they reach the server), then runs `whitelist add` on the server and writes an audit entry.

Remove a player:

```
/unwhitelist username:PlayerName
```

View the whitelist (available to everyone):

```
/whitelisted
```

Note: the bot caches the whitelist in memory. If a freshly added player does not show up in `/whitelisted` or in player-name autocomplete right away, that is the cache; a bot restart refreshes it.

## Audit trail

Two audit stores exist under `data/`:

**Admin actions** — every admin-gated mutation is recorded in `data/adminAudit.json`: `/server start|stop|restart|backup|prune-stats` (including whether a prune was a dry run or confirmed) and `/config reload`. Each entry stores the timestamp, action, target server, the acting user's tag and ID, and the guild it was issued from. The log keeps the most recent 500 entries. Recording is best-effort: a failed audit write is logged but never blocks the action itself.

**Whitelist changes** — every whitelist add and remove is recorded in `data/whitelistAudit.json`, keyed by lowercased username:

| Field | Description |
|---|---|
| `username` | The Minecraft username |
| `uuid` | The Mojang UUID (captured on add) |
| `addedBy` / `addedById` | Discord tag and ID of the admin who added them |
| `addedAt` | Local timestamp of the add |
| `server` | Which server they were added to |
| `removedBy` / `removedById` / `removedAt` / `removedFromServer` | Filled when the player is removed |

The file is created automatically. There is no Discord command to query it yet; open `data/whitelistAudit.json` directly when you need to trace who whitelisted whom.

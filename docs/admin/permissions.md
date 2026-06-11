# Permissions, whitelist, and audit trail

## The admin model

The bot has exactly two permission levels: regular users and admins. Admins are Discord user IDs listed in `config.json`:

```json
"adminUsers": ["123456789012345678", "987654321098765432"]
```

There are no roles, no per-command grants. If finer control matters to you, restrict who can see the commands via Discord's own server settings (Server Settings → Integrations → your bot → command permissions).

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

A non-admin running any of these gets a clean "You do not have permission to use this command" error. The `/clear` command is gated differently: Discord itself only shows it to members with the Manage Messages permission.

In addition, every user is rate-limited to 5 commands per 30 seconds to protect the RCON connection from spam.

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

Every whitelist add and remove is recorded in `data/whitelistAudit.json`, keyed by lowercased username:

| Field | Description |
|---|---|
| `username` | The Minecraft username |
| `uuid` | The Mojang UUID (captured on add) |
| `addedBy` / `addedById` | Discord tag and ID of the admin who added them |
| `addedAt` | Local timestamp of the add |
| `server` | Which server they were added to |
| `removedBy` / `removedById` / `removedAt` / `removedFromServer` | Filled when the player is removed |

The file is created automatically. There is no Discord command to query it yet; open `data/whitelistAudit.json` directly when you need to trace who whitelisted whom.

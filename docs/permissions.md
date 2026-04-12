# Permissions & Whitelist Management

## Admin System

The bot uses a simple permission model: certain commands are restricted to **server admins**, defined as a list of Discord user IDs in the config.

### Setting up admins

In `config.json`, add Discord user IDs to the `adminUsers` array:

```json
{
  "adminUsers": ["123456789012345678", "987654321098765432"]
}
```

To find your Discord user ID: enable Developer Mode in Discord settings (Settings → Advanced), then right-click your name and select **Copy User ID**.

### What admins can do

| Command | What it does |
|---|---|
| `/server start` | Start a server |
| `/server stop` | Stop a server |
| `/server restart` | Restart a server |
| `/verify` | Add a player to the whitelist |
| `/unwhitelist` | Remove a player from the whitelist |

All other commands (stats, info, linking, etc.) are available to everyone.

### What happens for non-admins

If a non-admin tries to use a restricted command, they get a clean error message: *"You do not have permission to use this command."* The command is still visible in Discord's command list — it just won't execute.

## Whitelist Management

### Adding a player

```
/verify username:PlayerName
```

This does two things:
1. Checks with Mojang that the username actually exists (prevents typos).
2. Runs `whitelist add PlayerName` on the server.

The action is logged in the audit trail with your Discord name, ID, timestamp, and the player's Mojang UUID.

### Removing a player

```
/unwhitelist username:PlayerName
```

Runs `whitelist remove PlayerName` on the server and logs the removal in the audit trail.

### Viewing the whitelist

```
/whitelisted
```

This command is available to everyone. It shows all whitelisted players from the server's `whitelist.json`, paginated if there are many.

## Audit Trail

Every whitelist add and remove is recorded in `data/whitelistAudit.json`. Each entry contains:

| Field | Description |
|---|---|
| `username` | The Minecraft username |
| `uuid` | The player's Mojang UUID |
| `addedBy` | Discord tag of who added them |
| `addedById` | Discord user ID of who added them |
| `addedAt` | Timestamp of when they were added |
| `server` | Which server they were added to |
| `removedBy` | Discord tag of who removed them (if applicable) |
| `removedAt` | Timestamp of removal (if applicable) |

This file is created automatically on first use. It provides accountability — you can always trace back who whitelisted a player and when.

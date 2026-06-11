# Command reference

Every Discord slash command, grouped by what it does. In-game `!commands` are covered in [in-game-commands.md](in-game-commands.md).

Options in `(parentheses)` are optional. Most commands accept an optional `server` option when the bot manages multiple servers; it autocompletes with the available names and defaults to your guild's default server.

## Server info

| Command | Options | Description |
|---|---|---|
| `/status` | (`server`) | Online/offline, player count, who is online, and bot latency. |
| `/uptime` | (`server`) | Uptime history with 24h/7d/30d percentage bars. Without a server, shows all servers. |
| `/seed` | (`server`) | The world seed. |
| `/tps` | (`server`) | Current TPS. Paper-style servers show 1/5/15-minute averages, vanilla shows TPS plus MSPT and tick timing percentiles. |
| `/backup` | (`server`) | Backup overview: count, age, and size of the latest backup per backup tier. |
| `/whitelisted` | | All whitelisted players, paginated. |
| `/mods` | (`server`) | All installed server mods as clickable Modrinth links, grouped by whether you need to install them on your client. |
| `/map` | | Link to the live web map (Dynmap/Bluemap), if the admin configured one. |

## Stats

| Command | Options | Description |
|---|---|---|
| `/playtime` | `player` | Total playtime of a player. |
| `/stats player` | `player`, (`stat`) | All-time stats, grouped by category, paginated. The `stat` option filters, e.g. `stat:killed` for mob kills. |
| `/stats daily` | `player`, (`stat`) | Only the stats gained in roughly the last 24 hours. |
| `/compare` | `player1`, `player2`, (`stat`) | Side-by-side comparison of every stat both players share. |
| `/leaderboard` | (`stat`) | Top 10 by a chosen stat (playtime, mob kills, deaths, blocks mined, distance walked). Defaults to playtime. |
| `/top` | (`stat`) | Same as `/leaderboard`. |

Player name options autocomplete with whitelisted players. More detail in [stats-and-leaderboards.md](stats-and-leaderboards.md).

## Account linking

| Command | Description |
|---|---|
| `/link` | Gives you an 8-character code. Type `!link CODE` in Minecraft chat within 5 minutes to complete the link. |
| `/linkstatus` | Shows which Minecraft account your Discord is linked to. |
| `/unlink` | Removes the link. |

See [linking.md](linking.md) for the walkthrough and what linking unlocks.

## Daily rewards

| Command | Description |
|---|---|
| `/daily` | Claim your daily item reward. Needs a linked account and you must be online in Minecraft. |
| `/streak` | Your current streak, longest streak, and the next bonus milestone. |

See [daily-rewards.md](daily-rewards.md).

## Tools

| Command | Options | Description |
|---|---|---|
| `/chunkbase` | (`dimension`), (`server`) | Chunkbase seed map link, pre-filled with the server seed. If you are linked and online, centered on your position. |
| `/netherportal` | | The Nether coordinates matching your current Overworld position. Needs link + being online. |
| `/playerhead` | `mcname` | Shows a player's head with a button that gives it to you in-game (link + online required to click). |

## Communication

| Command | Options | Description |
|---|---|---|
| `/say` | `message`, (`server`) | Sends your message to the Minecraft chat as `[YourName] message`. |

## Moderation

| Command | Options | Description |
|---|---|---|
| `/clear` | `amount` | Bulk-deletes the last 1 to 100 messages in the current channel. Only visible to members with the Manage Messages permission. Messages older than 14 days cannot be bulk-deleted (Discord restriction). |

## Admin commands

`/server` (start/stop/restart/backup/status/prune-stats), `/whitelist`, `/verify`, `/unwhitelist`, and `/config` are restricted to configured admins. They are documented in [../admin/permissions.md](../admin/permissions.md).

## Misc

| Command | Description |
|---|---|
| `/help` | All commands with their options, paginated, only visible to you. |

## Rate limit

Each user can run 5 commands per rolling 30 seconds. Going over it gets you a short "please wait" message instead of an answer.

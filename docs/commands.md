# Commands

## Discord Slash Commands

### General

| Command | Description |
|---|---|
| `/help` | Lists all available commands with their options. |
| `/map` | Shows a link to the live server map (Dynmap/Bluemap). Requires `commands.map.url` in config. |

### Server Info

| Command | Options | Description |
|---|---|---|
| `/status` | `server` | Shows whether the server is online, player count, who's online, and bot latency. |
| `/seed` | `server` | Shows the world seed. |
| `/tps` | `server` | Shows current TPS (1min, 5min, 15min). Requires RCON. |
| `/backup` | `server` | Shows backup status — number of backups, latest backup age, and total size. |
| `/whitelisted` | — | Lists all whitelisted players with pagination. |

### Server Control (Admin Only)

These commands require your Discord user ID to be listed in `adminUsers` in the config.

| Command | Options | Description |
|---|---|---|
| `/server start` | `server` | Starts the server by running `start.sh`. |
| `/server stop` | `server` | Stops the server by running `shutdown.sh`. Automatically suppresses downtime alerts. |
| `/server restart` | `server` | Restarts the server by running `smart_restart.sh`. Automatically suppresses downtime alerts. |

### Whitelist Management (Admin Only)

| Command | Options | Description |
|---|---|---|
| `/verify` | `username`, `server` | Validates a Minecraft username against the Mojang API and adds it to the whitelist. Logs who added the player. |
| `/unwhitelist` | `username`, `server` | Removes a player from the whitelist. Logs who removed the player. |

### Account Linking

Players link their Discord account to their Minecraft account. This is required for some commands and for daily rewards.

| Command | Description |
|---|---|
| `/link` | Generates a 6-character code. The player then types `!link CODE` in Minecraft chat within 5 minutes. |
| `/linkstatus` | Shows which Minecraft account is linked to your Discord account. |
| `/unlink` | Removes the link between your Discord and Minecraft account. |

### Player Stats

| Command | Options | Description |
|---|---|---|
| `/playtime` | `player` | Shows total playtime for a specific player. |
| `/stats` | `player`, `stat` | Shows all stats for a player, optionally filtered by category. Paginated. |
| `/compare` | `player1`, `player2`, `stat` | Side-by-side stat comparison between two players. |
| `/leaderboard` | `stat` | Top 10 players ranked by a stat. Defaults to playtime. Available stats shown via autocomplete. |
| `/top` | `stat` | Alias for `/leaderboard` — identical functionality. |

### Utility

| Command | Options | Description |
|---|---|---|
| `/chunkbase` | `dimension`, `server` | Generates a Chunkbase seed map link. If your account is linked and you're online, includes your coordinates. |
| `/netherportal` | — | Calculates the Nether coordinates for your current Overworld position. Requires a linked account and being online. |
| `/playerhead` | `mcname` | Shows a player's skin head and offers a button to give yourself the player head item in-game. Requires linking and being online. |

### Daily Rewards

| Command | Description |
|---|---|
| `/daily` | Claim your daily reward. Requires a linked account and being online in Minecraft. |
| `/streak` | Shows your current streak, longest streak, and next bonus milestone. |

### Communication

| Command | Options | Description |
|---|---|---|
| `/say` | `message`, `server` | Sends a message to the Minecraft server chat as the bot. |

### The `server` Option

Most commands accept an optional `server` option that autocompletes with your configured server IDs. If you only have one server, you can always leave it blank — the guild's default server is used automatically.

---

## In-Game Commands

These are typed in the Minecraft chat by players. They're detected by the bot reading the server log.

| Command | Description |
|---|---|
| `!commands` | Lists all available in-game commands. Aliases: `!help`, `!cmds` |
| `!link <code>` | Completes the account linking process using a code from `/link`. |
| `!chunkbase` | Sends you a Chunkbase seed map link via private message. |
| `!netherportal` | Sends you the Nether coordinates for your current position. |
| `!playerhead <name>` | Gives you the specified player's head as an item. |

In-game commands have per-player cooldowns to prevent spam.

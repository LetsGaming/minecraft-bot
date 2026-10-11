# Command reference

Every Discord slash command, grouped by what it does. In-game `!commands` are covered in [in-game-commands.md](in-game-commands.md).

Options in `(parentheses)` are optional. Commands that act on a server accept an optional `server` option; it autocompletes with the servers your guild may use. Without it, the command uses your guild's default server. If the guild has no default but can use exactly one server, that one is used. Otherwise the bot lists the available server IDs and asks you to pass `server:`. In a DM the bot can only pick for you when a single server is configured.

## Server info

| Command | Options | Description |
|---|---|---|
| `/status` | (`server`) | Online/offline, player count, who is online, TPS, how long the server has been online, its version, and bot latency. An offline server says who stopped it and when (after a confirmed `/server stop` or `restart`) and how to start it. On locally managed servers also a **Host** section: RAM/CPU of the server process and disk usage of the world and backup paths. |
| `/uptime` | (`server`) | Uptime history with 24h/7d/30d percentage bars and an hourly 24h sparkline for one server. Use `server:all` for an overview of every server your guild may use. |
| `/info` | (`server`) | How to join: address, version, loader and required mods. |
| `/seed` | (`server`) | The world seed. |
| `/tps` | (`server`) | Current TPS. Paper-style servers show 1/5/15-minute averages, vanilla shows TPS plus MSPT and tick timing percentiles. |
| `/backup` | (`server`) | Backup overview: count, age, and size of the latest backup per backup tier. |
| `/whitelisted` | (`server`) | All whitelisted players, paginated. |
| `/mods` | (`server`) | All installed server mods as clickable Modrinth links, grouped by whether you need to install them on your client, under a line with the count, loader and Minecraft version. Large modpacks are split over pages. |
| `/map` | | Link to the live web map (Dynmap/Bluemap), if the admin configured one. |

## Stats

| Command | Options | Description |
|---|---|---|
| `/playtime` | `player`, (`server`) | Total playtime of a player. |
| `/stats player` | `player`, (`stat`), (`server`) | All-time stats, grouped by category, paginated. The `stat` option filters, e.g. `stat:killed` for mob kills. |
| `/stats daily` | `player`, (`stat`), (`server`) | Only the stats gained in roughly the last 24 hours. |
| `/compare` | `player1`, `player2`, (`stat`), (`server`) | Side-by-side comparison of every stat both players share. |
| `/leaderboard` | (`stat`), (`server`) | Top 10 by a chosen stat: playtime, mob kills, deaths, blocks mined, distance walked, items crafted, player kills, jumps, animals bred, fish caught, diamond ore — plus the daily-streak boards (current and longest streak). Defaults to playtime. |
| `/top` | (`stat`), (`server`) | Same as `/leaderboard`. |
| `/sessions` | `player`, (`server`) | A player's recent sessions: online-now / last-seen, playtime across the recorded sessions, and the last 10 individual sessions. |
| `/players` | (`server`), (`sort`), (`inactive`), (`include_unknown`) | Every player who has played on the server, 20 per page, with online state or last-seen and lifetime playtime, under a line such as "3 online, 41 known. Sorted by playtime." `sort` is `last-seen` (default; online first), `playtime` or `name`. `inactive:<days>` keeps only players last active more than that many days ago; players with no tracked activity are added with `include_unknown:true`. Last-seen only covers time since the bot started tracking sessions, so earlier players show "before tracking". The name list comes from the whitelist and the server's usercache, which vanilla caps at about 1000 entries, so very old players without a stats file may be missing. |
| `/activity` | (`server`) | When is the server busy? 24-hour sparkline of average player counts plus the busiest hours of day (14-day average). |
| `/profile` | (`player`), (`server`) | One player card: head, linked Discord account, who whitelisted them and when, playtime, last seen, daily streak. Without `player`, shows your linked account. |

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
| `/daily` | Claim your daily item reward. Needs a linked account. If you are offline the reward is queued for your next join. The reward is shown to the whole channel; cooldown notices and errors are only visible to you. |
| `/daily-reminder` | Opt in/out of a DM when your next daily reward is ready (`enabled: true/false`). |
| `/streak` | Your current streak, longest streak, and the next bonus milestone. |
| `/daily-history` | Your recent claims on a server: date, streak at the time, and what dropped (last 30 are stored). |

See [daily-rewards.md](daily-rewards.md).

## Tools

| Command | Options | Description |
|---|---|---|
| `/chunkbase` | (`dimension`), (`server`) | Chunkbase seed map link, pre-filled with the server seed. If you are linked and online, centered on your position. |
| `/netherportal` | | The Nether coordinates matching your current Overworld position. Needs link + being online. |
| `/playerhead` | `mcname` | Shows a player's head with a button that gives it to you in-game (link + online required to click). |
| `/waypoints` | (`server`) | All community waypoints on a server, paginated — the Discord view of the in-game `!waypoint` system. |

## Communication

| Command | Options | Description |
|---|---|---|
| `/say` | `message`, (`server`) | Sends your message to the Minecraft chat as `[YourName] message`. |
| `/poll` | `create` / `status` / `close` | Cross-platform polls (admin): votable via buttons on Discord and `!vote` in-game, with linked accounts counted once. Results are announced in both directions when the poll closes. `create` accepts `servers:"smp, creative"` (or `all`) to run ONE poll across several instances — merged tally, announcements on every participating server. |
| `/watch` | `server` / `player` / `list` / `remove` | One-shot personal DMs: get pinged once when a server comes back online or when a specific player joins. Fired watches remove themselves; re-arm with the command. DMs must be open. |

## Moderation

| Command | Options | Description |
|---|---|---|
| `/clear` | `amount` | Bulk-deletes the last 1 to 100 messages in the current channel. Only visible to members with the Manage Messages permission. Messages older than 14 days cannot be bulk-deleted (Discord restriction). |
| `/kick` | `player`, (`reason`), (`server`) | Admin: kick a player. The reason is shown to the player and written to the admin audit log. |
| `/ban` | `player`, (`duration`), (`reason`), (`server`) | Admin: ban a player (vanilla ban list), audited. `duration` (`30m`, `2h`, `3d`, `1w`, `2mo`, `1.5y`, max `10y`) makes it a timed ban — the bot pardons automatically when it runs out. Omit it for a permanent ban. Players with a linked Discord account are DM'd when the ban lifts. |
| `/pardon` | `player`, (`server`) | Admin: unban a player, audited. |

## Admin commands

`/server` (start/stop/restart/backup/status/prune-stats), `/whitelist`, `/verify`, `/unwhitelist`, `/config`, `/note` (admin notes on players, shown in `/whois`), `/challenge` (advancement challenges: first player to earn X wins), `/daily-admin` (move/reset/inspect daily-claim records per server), `/console` (log tail + live console relay), and the moderation shortcuts above are restricted to configured admins. They are documented in [../admin/permissions.md](../admin/permissions.md).

`/server stop` and `/server restart` first ask for confirmation, visible only to you: the reply says how many players are online, and the action runs only after you press the red button. The buttons expire after 60 seconds. Once confirmed, a public message in the channel says who stopped or restarted the server and follows the progress. If you are not a bot admin, admin commands answer only to you, before anything is posted in the channel.

`/config show` replies only to you. It lists the servers by host, the current guild's features and counts, and never prints the bot token or admin IDs.

If the guild has whitelist applications configured, non-admins apply for the whitelist with a button (no command needed) — an admin reviews the application in the queue channel.

## Misc

| Command | Description |
|---|---|
| `/help` | All commands with their options, paginated, only visible to you. |
| `/clear-dm` | Deletes the bot's own messages from your DM with it. Options: `amount` (omit for all) and `save_history` (sends a `.txt` copy of the deleted messages first). |

## How replies look

- **Who sees a reply:** errors, "admins only" denials, confirmations, cooldowns and your own settings are visible only to you. Status, stats, leaderboards, moderation results and a claimed `/daily` reward are public.
- **Confirmations** for actions that disconnect players (`/server stop`, `/server restart`) are a violet message with a red action button and Cancel. The buttons expire after 60 seconds and keep working if the bot restarts in between.
- **Errors** are only visible to you. They say what went wrong and what to do next, for example "`Steve` is not known on this server. Check the spelling or pick a name from the suggestions."
- **Long lists** (`/players`, `/mods`, `/stats`, `/help`, ...) have a row of buttons: Previous, a grey "Page 2/5" and Next. After 3 minutes the buttons switch off but stay visible.
- **Colours** match the dashboard: green for online and done, amber for "not responding" and warnings, red for offline and failures, grey for unknown and plain events (joins, leaves, deaths), violet for things waiting on you (confirmations, whitelist applications), blue for answers and running jobs.
- **Server state** is the only emoji in a title: 🟢 online, 🟡 not responding, 🔴 offline, ⚪ unknown.
- **Times** are Discord timestamps, so everyone sees them in their own time zone.

## Rate limit

Each user can run 5 commands per rolling 30 seconds by default (admins can tune this via the `limits` config block). Going over it gets you a short "please wait" message instead of an answer.

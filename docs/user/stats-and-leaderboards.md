# Stats and leaderboards

Minecraft tracks hundreds of statistics per player. The bot reads them straight from the server, so everything you see is the real, current data (with at most a few seconds of caching).

## Your stats

`/playtime player:Name` shows total playtime.

`/stats player player:Name` shows everything, grouped by category (mined, killed, crafted, custom, ...). Long results are paginated; use the arrow buttons (they stay active for 3 minutes).

Filter with the `stat` option to avoid scrolling:

```
/stats player player:Name stat:killed     → only mob kills
/stats player player:Name stat:mined      → only mined blocks
```

The filter is fuzzy: it matches categories first, then individual stat names, so `stat:diamond` finds diamond-related entries across categories.

## Daily stats

`/stats daily player:Name` shows only what changed in roughly the last 24 hours. The bot snapshots all stats hourly and diffs against the snapshot closest to 24 hours ago. The title tells you the exact window (e.g. "last 23.4h"); if the bot was restarted recently, the window can be shorter.

Right after the bot is installed there is no baseline yet, so the command asks you to try again later.

## Comparing players

`/compare player1:A player2:B` lists every stat both players share, side by side. The `stat` option filters here too. Great for settling "who actually mined more" arguments.

## Leaderboards

`/leaderboard` ranks the top 10 players. Pick a stat from the dropdown:

| Stat | Sorted |
|---|---|
| Playtime | most first |
| Mob kills | most first |
| Blocks mined | most first |
| Distance walked | most first |
| Deaths | fewest first |
| Items crafted | most first |
| Player kills | most first |
| Jumps | most first |
| Animals bred | most first |
| Fish caught | most first |
| Diamond ore | most first |
| Current streak, longest streak (daily rewards) | most first |

No stat picked means playtime.

## Scheduled leaderboards

If your server has a leaderboard channel, the bot posts leaderboards there automatically (playtime and blocks mined unless the admin picked others) (daily, weekly, or monthly, depending on configuration). These count only the stats gained during that period, not all-time totals, so newer players have a fair shot every period. The footer states the exact data window.

## The dashboard Analytics page

Analytics has two tabs. **Players** (the default) shows the activity chart, the leaderboard and the players who are active, have gone quiet or are new. **Server** shows uptime and command usage.

One range control (24h to 90d) applies to every panel. Each panel can only look as far back as the history behind it, so a longer range is clamped, and every panel title says how far it actually reached ("last 30d, all that is kept" when that is shorter than asked):

| Panel | History kept |
|---|---|
| Players online and busiest hours | 90 days. Up to 14 days one bar is one hour; longer ranges draw one bar per day. The bar is the average, the tick above it the peak |
| Leaderboard | 32 days |
| Players | 365 days of sessions |
| Uptime | about 30 days (next to the fixed 24h, 7d and 30d figures, the selected range is shown) |
| Command usage | 90 days |

Click a name in the leaderboard or the players list to open that player on the Players page.

The leaderboard for a range is the stat gained in that range, measured against the nearest hourly or daily snapshot, like the scheduled boards. On a young bot the snapshots may not reach back far enough; the panel then says from when the numbers start (or that they are all-time totals when there is no snapshot yet). The players list counts only the time played inside the range. "Gone quiet" lists players who are not online and were last seen at least 7, 14, 30, 60 or 90 days ago; "New" lists players whose first recorded session falls inside the range.

## The dashboard Players page

Players lists everyone the bot has recorded a session for on the server, with a search box, the same filters (active in the window, online now, gone quiet, new) and a sort. Opening a player shows when they joined and were last seen, time played per day for the last 90 days, recent sessions and their stats. With the audit permission on that server it also shows the linked Discord account, whitelist history, applications, any temporary ban, moderation notes and the daily streak (see [capabilities](../admin/capabilities.md)). The page is read-only; notes, bans and the whitelist are still managed from Discord.

Sessions are recorded since the bot started tracking them and kept for 365 days, so a player's first-seen date and playtime cover that history, not the whole life of the server.

## Where the numbers come from

These are vanilla Minecraft statistics, the same ones you see on the in-game pause menu under Statistics. Stats start existing the first time you do the thing (your first death creates the deaths counter), and only players on the whitelist or in the server's `usercache.json` appear in bot results.

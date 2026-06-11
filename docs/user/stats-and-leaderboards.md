# Stats and leaderboards

Minecraft tracks hundreds of statistics per player. The bot reads them straight from the server, so everything you see is the real, current data (with at most a few seconds of caching).

## Your stats

`/playtime player:Name` shows total playtime.

`/stats player player:Name` shows everything, grouped by category (mined, killed, crafted, custom, ...). Long results are paginated; use the arrow buttons within 60 seconds.

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

`/leaderboard` (or `/top`, same thing) ranks the top 10 players. Pick a stat from the dropdown:

| Stat | Sorted |
|---|---|
| Playtime | most first |
| Mob kills | most first |
| Blocks mined | most first |
| Distance walked | most first |
| Deaths | fewest first |

No stat picked means playtime.

## Scheduled leaderboards

If your server has a leaderboard channel, the bot posts playtime and blocks-mined leaderboards there automatically (daily, weekly, or monthly, depending on configuration). These count only the stats gained during that period, not all-time totals, so newer players have a fair shot every period. The footer states the exact data window.

## Where the numbers come from

These are vanilla Minecraft statistics, the same ones you see on the in-game pause menu under Statistics. Stats start existing the first time you do the thing (your first death creates the deaths counter), and only whitelisted players appear in bot results.

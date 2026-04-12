# Stats & Leaderboards

## Your Stats

`/playtime PlayerName` — Shows a player's total playtime.

`/stats PlayerName` — Shows all tracked stats for a player, grouped by category. If there are many stats, the response is paginated — use the arrow buttons to navigate.

You can filter to a specific category by adding the `stat` option, e.g. `/stats PlayerName stat:killed` to only see mob kills.

## Comparing Players

`/compare Player1 Player2` — Shows a side-by-side comparison of every stat both players share. You can optionally filter by category with the `stat` option.

## Leaderboards

`/leaderboard` — Shows the top 10 players ranked by a stat you choose. If you don't pick a stat, it defaults to playtime. `/top` does the same thing.

The stat options are listed in the command's dropdown when you use it — Discord will show you what's available.

## Scheduled Leaderboards

If your server has a leaderboard channel set up, the bot automatically posts a leaderboard on a regular schedule (daily, weekly, or monthly depending on configuration). These scheduled leaderboards only count stats **gained during that period**, not all-time totals — so they reflect recent activity.

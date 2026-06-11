# Getting started

This bot connects your Discord server to one or more Minecraft servers. Here is what it can do for you as a player, and where to read more.

## What you can do without any setup

- `/status`: see if the server is online and who is playing
- `/stats`, `/playtime`, `/compare`, `/leaderboard`: explore everyone's stats ([details](stats-and-leaderboards.md))
- `/seed`, `/chunkbase`, `/map`: world seed, seed map, and live map links
- `/whitelisted`: list everyone on the whitelist
- `/help`: the full command list, right in Discord

If the server has a chat bridge channel, you can also talk to in-game players from Discord without any commands. See [chat-bridge.md](chat-bridge.md).

## What needs a linked account

Linking connects your Discord account to your Minecraft account. It takes one minute and unlocks:

- `/daily` and `/streak`: daily item rewards with streak bonuses ([details](daily-rewards.md))
- `/netherportal`: portal coordinates for your current in-game position
- `/chunkbase`: the seed map centered on where you are standing
- The button on `/playerhead` that delivers the head to your inventory

How to link: [linking.md](linking.md).

## Commands inside Minecraft

Some things work directly in the game chat, prefixed with `!`. Type `!commands` in-game to list them, or read [in-game-commands.md](in-game-commands.md).

## Multiple servers

If the bot manages several Minecraft servers, most commands have an optional `server` field. Start typing and Discord autocompletes the names. Leave it empty and the default server of your Discord guild is used.

## Good to know

- Replies that only concern you (link codes, errors, daily cooldowns) are ephemeral: only you see them.
- There is a spam limit of 5 commands per 30 seconds per user.
- Paginated answers (stats, whitelist) have arrow buttons that work for 60 seconds, only for the person who ran the command.

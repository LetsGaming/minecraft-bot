# Account linking

Linking connects your Discord account to your Minecraft account. It is a one-time process and takes about a minute.

## How to link

1. In Discord, type `/link`. You get an 8-character code, visible only to you.
2. Join the Minecraft server and type `!link CODE` in the game chat (replace `CODE` with your code).
3. Done. The bot sends you a Discord DM confirming the link.

The code expires after 5 minutes. If it expires, run `/link` again for a new one. While a code is still valid, `/link` reminds you of it instead of generating a second one.

## Checking and removing the link

| Command | Effect |
|---|---|
| `/linkstatus` | Shows the linked Minecraft account name. |
| `/unlink` | Removes the link. You can re-link any time. |

Want to switch to a different Minecraft account? `/unlink` first, then `/link` again.

## What linking unlocks

| Command | Why it needs the link |
|---|---|
| `/daily`, `/streak` | Rewards are delivered to your Minecraft inventory. |
| `/netherportal` | Reads your current in-game position. |
| `/chunkbase` | Optionally centers the seed map on your position. |
| `/playerhead` | The "give to me" button delivers the head to your character. |

Running one of these without a link gets you a friendly error telling you to link first.

## Notes

- One Minecraft account per Discord account. The link is per bot, not per Discord guild.
- The code only works typed by you in the game chat; nobody can link your Discord account by guessing, since codes are random and short-lived, and repeated guesses in chat are rate-limited.

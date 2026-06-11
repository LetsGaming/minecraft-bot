# In-game commands

Some things work directly in the Minecraft chat, no Discord needed. Type the command like a normal chat message, prefixed with `!`. The bot reads the server log, reacts, and answers you via private message (`/msg`), so only you see the response.

## Available commands

| Command | Cooldown | What it does |
|---|---|---|
| `!commands` | 5 s | Lists all in-game commands. Also works as `!help`, `!cmds`, or `!commandlist`. |
| `!link CODE` | | Completes [account linking](linking.md). Get the code from `/link` in Discord first. |
| `!chunkbase` | 10 s | Sends you a clickable Chunkbase seed map link, centered on your position and matching your current dimension. |
| `!netherportal` | 5 s | In the Overworld: the matching Nether coordinates. In the Nether: the matching Overworld coordinates. |
| `!playerhead Name` | 15 s | Gives you that player's head as an item (any valid Minecraft name works, not just players on this server). |
| `!seed` | 30 s | The world seed. |

Cooldowns are per player and exist to keep the chat and the server console clean.

## Good to know

- Responses are private messages; the rest of the server does not see them.
- These commands only work while you are on the server, since they are read from the live server log.
- Messages starting with `!` are treated as commands and are not forwarded to Discord by the chat bridge.
- The server admin can disable individual commands, so the list on your server may be shorter. `!commands` always shows what is actually available.

## The sleep prompt

One hidden extra: if you are lying in bed at night and type exactly `liege wie` in chat, every player who is still awake gets a full-screen title telling them to go to sleep. Write it in lowercase for a dry nudge, IN CAPS for a shouted one. Ten-second cooldown per server, so no spamming the screen.

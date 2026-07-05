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
| `!slime` | 10 s | Whether the chunk you are standing in is a slime chunk (Overworld only — computed from the seed, no waiting for spawns). |
| `!deathpos` | 10 s | The coordinates and dimension of your last death. Also works as `!lastdeath`. |
| `!waypoint name` | 3 s | Looks up a community waypoint. `!waypoint set name [category]` saves your current position (with an optional category tag like `base` or `farm`), `!waypoint del name` deletes one you created. Also works as `!wp`. |
| `!waypoints [category]` | 10 s | Lists this server's waypoints, optionally filtered by category (the full list lives in `/waypoints` on Discord). Also works as `!wps`. |
| `!report message` | 120 s | Sends your message to the admin team on Discord — griefing, bugs, stuck players. You get a confirmation once it's delivered. |
| `!vote number` | 3 s | Votes in the currently open poll (see `/poll` on Discord). If your account is linked, in-game and Discord votes count as one. |

Cooldowns are per player and exist to keep the chat and the server console clean.

## Good to know

- Responses are private messages; the rest of the server does not see them.
- These commands only work while you are on the server, since they are read from the live server log.
- Messages starting with `!` are treated as commands and are not forwarded to Discord by the chat bridge.
- The server admin can disable individual commands, so the list on your server may be shorter. `!commands` always shows what is actually available.

## The sleep prompt

One hidden extra: if you are lying in bed at night and type exactly `liege wie` in chat, every player who is still awake gets a full-screen title telling them to go to sleep. Write it in lowercase for a dry nudge, IN CAPS for a shouted one. Ten-second cooldown per server, so no spamming the screen.

# In-Game Commands

These commands are typed directly in the Minecraft server chat. They're prefixed with `!`.

## Available Commands

`!commands` — Lists all available in-game commands. Also works as `!help` or `!cmds`.

`!link CODE` — Completes the account linking process. Get your code from the `/link` command in Discord first. See [Account Linking](linking.md).

`!chunkbase` — Sends you a Chunkbase seed map link via private message in-game.

`!netherportal` — Sends you the Nether coordinates for your current position via private message.

`!playerhead PlayerName` — Gives you the specified player's head as an in-game item.

## Good to Know

- Responses to in-game commands are sent as private messages (`/msg`) — only you see them.
- Each command has a short cooldown per player to prevent spam.
- These commands only work while you're on the server — they're read from the server's chat log.

## Chat Bridge

If the server has a chat bridge set up, everything you type in Minecraft chat (that isn't a `!` command) also appears in a Discord channel, and vice versa. This happens automatically — no commands needed.

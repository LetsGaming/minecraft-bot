# In-game `!commands`

Commands players type in Minecraft chat. Auto-discovered from
`src/bot/logWatcher/commands/<category>/`, one file each — the loader walks
subdirectories, so the category is a directory exactly like it is for slash
commands.

**Use the same category as the slash command.** Several of these are the same
feature on a second surface: `/seed` lives in `commands/info/`, so `!seed` lives
in `logWatcher/commands/info/`. Someone who knows where one is should not have
to guess at the other.

Use the `defineCommand` framework. Never hand-roll the chat regex — the log line
has more shapes than it looks (the `[AFK]` prefix, Bedrock names with a `.`
prefix via Geyser/Floodgate), and every hand-rolled copy has missed at least one.

## Writing one

```ts
// src/bot/logWatcher/commands/info/coords.ts
import { defineCommand } from "../defineCommand.js";

const cmd = defineCommand({
  name: "coords",
  aliases: ["pos"],
  description: "Get your current coordinates",
  args: [],            // e.g. ["player"] adds a required <player> argument
  cooldown: 5,         // seconds, per player
  handler: async (username, _args, _client, server) => {
    const coords = await server.getPlayerCoords(username);
    if (!coords) {
      await server.sendCommand(`/msg ${username} Could not get your position.`);
      return;
    }
    await server.sendCommand(
      `/msg ${username} X: ${Math.floor(coords.x)} Y: ${Math.floor(coords.y)} Z: ${Math.floor(coords.z)}`,
    );
  },
});

export const { init, COMMAND_INFO } = cmd;
```

The framework generates the log-line regex, enforces the per-player cooldown
with an automatic "please wait" reply, parses `args` into named strings, catches
handler errors, and exports `COMMAND_INFO` so `!commands` lists your command
automatically. A command file ends up being ~30 lines of handler logic.

Reply via `/msg ${username} ...` so only the caller sees the response.

If your command needs startup work (loading state, registering a listener), wrap
`init` — `logWatcher/commands/link.ts` is the example.

## Scoping and enablement

Slash commands scope per **guild** (that is where they are issued); in-game
commands scope per **server**. The global `commands` block is the shared fallback
for both, and `commandPolicy.ts` in core is the one resolver:

```
effective = defaults ← commands[name] ← scope.commands[name]
```

A command disabled in *every* scope is skipped at load; per-server enablement is
enforced live at dispatch inside `defineCommand`, so a config reload takes effect
without a restart.

## The rule that matters

**Anything a player typed that goes back to the console gets sanitized first.**
`sanitizeForConsole` / `stripControlChars`, and names through `isValidMcName`.
The handler above interpolates `username` into `/msg` — that is a console
command, and a name containing a newline would be a second one. There is one
sanitizer in `core/utils/sanitize.ts`; use it, don't rewrite it.

Localized strings here follow the *global* language rather than a guild locale:
a Minecraft server has no guild context.

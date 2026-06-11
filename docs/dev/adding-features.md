# Adding features

Recipes for the three common extension points: slash commands, in-game commands, and log watchers. Each is copy-paste-adjust; the frameworks do the boring parts.

Before you start: read [architecture.md](architecture.md) once and keep [coding-guidelines.md](coding-guidelines.md) open. New code must come with tests (see [testing.md](testing.md)).

## Adding a slash command

Commands are auto-discovered: any `.ts` file under `src/commands/` (except `middleware.ts`) that exports `data` and `execute` is loaded and registered at startup. No central registry to edit.

1. Create the file in the right category folder, e.g. `src/commands/info/ping.ts`:

```ts
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Measure bot and server latency")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);

  const start = Date.now();
  const running = await server.isRunning();
  const rtt = Date.now() - start;

  const embed = createEmbed({
    title: `Ping - ${server.id}`,
    description: running ? `Server reachable in ${rtt}ms` : "Server offline",
  });
  await interaction.editReply({ embeds: [embed] });
});
```

What the pieces buy you:

- `withErrorHandling` defers the reply, catches everything, renders a standard error embed, and logs. Inside it, always use `editReply`, never `reply`. Pass `{ ephemeral: true }` for private replies, `{ defer: false }` if you must reply immediately yourself.
- Wrap with `requireServerAdmin(...)` inside `withErrorHandling` for admin-only commands.
- An option literally named `server` with `.setAutocomplete(true)` gets server-ID autocomplete for free (handled centrally in `index.ts`). Options named `player`, `player1`, `player2` get whitelist-based player-name autocomplete the same way.
- Imports end in `.js`, not `.ts`. The project is ESM with Node16 resolution; this is the compiled path.

2. Build and restart (`npm run pm2:restart` or `docker compose up -d --build`). Registration is global; updates to existing commands appear quickly, brand-new ones can take a moment.

3. Add a test in `tests/` mocking the interaction (plenty of examples, e.g. `tests/commands_misc.test.ts`).

4. Document it in `docs/user/commands.md` (and `docs/admin/permissions.md` if admin-only).

The command name is automatically a valid key for the `commands` config block, so admins can disable it without code changes.

## Adding an in-game !command

In-game commands are also auto-discovered, from `src/logWatcher/commands/`. Use the `defineCommand` framework; never hand-roll the chat regex.

```ts
// src/logWatcher/commands/coords.ts
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

The framework generates the log-line regex (including the `[AFK]` prefix case), enforces the cooldown with an automatic "please wait" reply, parses `args` into named strings, catches handler errors, and exports `COMMAND_INFO` so `!commands` lists your command automatically. Reply via `/msg ${username} ...` so only the caller sees the response.

If your command needs startup work (loading a data file), wrap `init` like `logWatcher/commands/link.ts` does.

## Adding a log watcher

For reacting to server events that are not chat commands (a new log line pattern), add a register function in `src/logWatcher/watchers/`:

```ts
// src/logWatcher/watchers/villagerDeaths.ts
import { type Client } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { log } from "../../utils/logger.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../types/index.js";

const REGEX = /\[.+?\].*:\s+Villager .+ died/;

export function registerVillagerDeathWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  logWatcher.register(REGEX, async (match) => {
    // build embed, fetch channel, send; always try/catch the Discord call
  });
}
```

Then wire it once in `initMinecraftCommands.ts`, next to the existing `register*` calls inside the per-server loop. Type it against `ILogWatcher` so it works for both local and remote servers without changes.

Conventions for watchers:

- A handler that throws only kills its own invocation; the watcher logs and continues. Still, catch Discord API errors yourself so one unreachable channel does not spam the error log.
- Anchor regexes on the log prefix (`/\[.+?\].*:\s+/`) to avoid matching player chat that quotes a system message.
- Player-name captures should use `[\w.]+`, not `\w+`, so Bedrock players with a `.` prefix (Geyser/Floodgate) are matched.

## Adding a scheduled task

Timer-driven features (like the TPS monitor) export a `startX(client, guildConfigs)` function that sets up its own `setInterval`/`setTimeout`, returns the timer, and is called once from `initMinecraftCommands.ts`. For anything that must run at a wall-clock time, use `nextMidnightEpoch()` from `utils/time.ts` and reschedule after each run (see `channelPurge.ts`); a fixed 24h interval drifts across DST changes.

## Adding a leaderboard stat

Add an entry to `LEADERBOARD_STATS` in `utils/statUtils.ts`:

```ts
crafted: {
  label: "Items Crafted",
  extract: (flat) =>
    flat.filter((s) => s.category === "minecraft:crafted")
        .reduce((sum, s) => sum + s.value, 0),
  format: (v) => v.toLocaleString(),
  sortAscending: false,
},
```

`/leaderboard` and `/top` pick it up automatically (the choices list is generated from this map), and hourly snapshots start including it, so period leaderboards work after one snapshot cycle.

## Checklist before opening a PR

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all clean (CI runs exactly these)
- [ ] New behavior covered by tests
- [ ] User-visible changes documented under `docs/`
- [ ] No rule from [coding-guidelines.md](coding-guidelines.md) violated

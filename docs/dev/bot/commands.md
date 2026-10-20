# Slash commands

Commands are auto-discovered: any file under `src/bot/commands/` (except
`middleware.ts`) that exports `data` and `execute` is loaded and registered at
startup. There is no central registry to edit.

Categories are directories: `admin/`, `info/`, `stats/`, `server/`,
`moderation/`, `connection/`, `general/`. `shared/` holds helpers several
commands use, not commands. (`communication/` exists only for in-game
commands; `whitelist`, `unwhitelist` and `verify` sit directly in `commands/`
and show as "Other" in the dashboard.) Put the file where a reader would look
for it.

## Writing one

```ts
// src/bot/commands/info/ping.ts
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import { t } from "@mcbot/core/utils/i18n.js";

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

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: t("ping.title", { server: server.id }),
        description: running ? t("ping.reachable", { ms: rtt }) : t("ping.offline"),
      }),
    ],
  });
});
```

What the pieces buy you:

- **`withErrorHandling`** defers the reply, resolves the guild locale, catches
  everything, renders a standard error embed, and logs. Inside it, always use
  `editReply`, never `reply`. Pass `{ ephemeral: true }` for private replies,
  `{ defer: false }` if you must reply immediately yourself.
- **`requireServerAdmin(...)`**, wrapped *inside* `withErrorHandling`, is the
  admin gate. It fails closed.
- **Autocomplete is free for known option names.** An option literally named
  `server` with `.setAutocomplete(true)` gets server-ID autocomplete, handled
  centrally in `index.ts`. Options named `player`, `player1`, `player2` get
  player-name autocomplete the same way. The names are a shared contract
  (`@mcbot/schema/commandOptions.js`); the dashboard reads them too.
- **Imports end in `.js`, not `.ts`.** The project is ESM with Node16
  resolution; that is the compiled path, even in a `.ts` source.

The command name is automatically a valid key for the `commands` config block,
so an admin can disable it without a code change.

`/bridge optout` and `/bridge optin` (`commands/general/bridge.ts`) are the reference for a small per-user preference command: ephemeral replies, state in `relayOptOutStore`. The notice button (`relay:optout:<guildId>`, `interactions/relayNotice.ts`) does the same as `optout`. See [watchers.md](watchers.md#relay-between-bridges).

## Errors that reach the user

Throw a `CommandError` with a localised `problem`, a `recovery` and, where it
helps, a `title`; the middleware turns it into an error embed only the invoker
sees. Do not build your own try/catch + reply ladder unless you need custom
flow.

What you must not do is hand the raw error text to Discord. Server errors carry
absolute paths, sudo output, and stderr fragments; map them to something a user
can act on and log the detail. [replies.md](replies.md) has the full rules for
errors, visibility, confirmations, paging and mentions.

## Checklist

1. File in the right category directory, exporting `data` and `execute`.
2. Wrapped in `withErrorHandling`, plus `requireServerAdmin` if it is admin-only.
3. Target server via `resolveServer(interaction)`.
4. User-visible strings through `t()`.
5. A test in `tests/` mocking the interaction; see `tests/commands/commands_misc.test.ts`
   for the pattern.
6. Documented in [user/commands.md](../../user/commands.md), and in
   [admin/permissions.md](../../admin/permissions.md) if admin-only.

Then build and restart (`npm run pm2:restart` or `docker compose up -d --build`).
Registration is global; edits to existing commands appear quickly, brand-new
ones can take a moment.

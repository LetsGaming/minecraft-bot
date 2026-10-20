# `@mcbot/bot`

The product: the Discord process. It owns the gateway connection, the commands,
the watchers, and everything Discord-facing. It depends on `@mcbot/core` and
`@mcbot/schema`, and never on `src/web`: the bot does not know its extension
exists.

Started with `npm start` → `src/bot/dist/index.js`.

## Layout

```
src/bot/
├── index.ts              Entry: client, command loading/registration,
│                         interaction dispatch, rate limiting, heartbeat
├── commands/             Slash commands, one file per command
│   ├── middleware.ts     withErrorHandling(), requireServerAdmin()
│   └── <category>/<name>.ts   exports `data` (builder) and `execute`
├── interactions/         Stable-customId flows (confirm rows, follow-up hints,
│                         whitelist applications)
├── logWatcher/
│   ├── logWatcher.ts     The in-game command registry and the ILogWatcher type
│   ├── RemoteLogWatcher.ts   SSE stream from the API wrapper; the only watcher
│   ├── defineCommand.ts  Declarative framework for in-game !commands
│   ├── initMinecraftCommands.ts   Wires watchers + schedulers per server
│   ├── commands/<category>/<name>.ts   In-game !commands, same categories
│   │                     as commands/ above; /seed is info/, so !seed is too
│   └── watchers/
│       ├── log/          React to a log line (register*)
│       ├── monitors/     Poll something, alert on a condition (start*)
│       ├── schedulers/   Do a thing on a clock (start*/reconcile*)
│       └── notifyGuilds.ts, watchFirer.ts, poller.ts, sendQueue.ts,
│           discordErrors.ts   Used by more than one group
├── processGuards.ts      Unhandled-fault handling and the final database flush
└── utils/
    ├── embeds/           embedUtils, embedColors, statEmbeds, alertUtils, confirm, ...
    ├── guild/            guildRouter, discordChannel, linkedRole, permissions, ...
    ├── commands/         loadCommandFiles: finding command modules on disk
    ├── hints/            followUps: suggesting the paired feature after a command
    ├── applyConfig.ts    Apply a fresh config to the running client
    ├── autocomplete.ts   Shared autocomplete completers
    ├── discordTime.ts    Discord timestamp formatting
    └── mcHeads.ts        Player-head avatar URLs
```

`utils/` is grouped the same way `commands/` is. `embeds/` is everything that
builds something Discord renders; `guild/` is everything that resolves a guild
to a server, a channel, or a role. The files at the root belong to neither
and are used by both.

## The pieces

| Topic | File |
|---|---|
| Slash commands: the middleware, autocomplete, adding one | [commands.md](commands.md) |
| How replies look: builders, colours, errors, confirm rows, paging, mentions | [replies.md](replies.md) |
| In-game `!commands` and the `defineCommand` framework | [in-game-commands.md](in-game-commands.md) |
| Log watchers and scheduled tasks | [watchers.md](watchers.md) |

## Things that are true across all of them

**Embeds come from the factories.** No naked `new EmbedBuilder()`, no raw
`0x…` colour literals. Use `createEmbed` and friends from `utils/embeds/`, with
colours from `EmbedColor` (see [replies.md](replies.md)). The palette is a separate module from the builders
because it is pure data: tests can mock the builders and still get the real
colours.

**Every server target goes through `resolveServer()`.** It is the tenant
isolation point, not just a convenience. See
[architecture.md](../architecture.md#server-resolution).

**Anything user-typed that reaches a console gets sanitized.**
`stripControlChars`/`sanitizeForComponent` from core, or `consoleCommand()`, every time, no exceptions.
A newline in a chat message is a second console command.

**User-visible strings go through `t()`.** Guild locale for slash commands
(`runWithGuildLocale`); the global language for in-game strings and DMs, since
a Minecraft server has no guild context.

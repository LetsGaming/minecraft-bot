# `@mcbot/core`

The shared library. Everything the bot and the dashboard both need, and nothing
either of them owns alone. It imports `@mcbot/schema` and nothing else from the
repo — no `src/bot`, no `src/web`, ever. ESLint enforces that, and so does the
dependency tree.

discord.js appears only as a type-only import. If you find yourself wanting to
send a message from `core`, the code belongs in `bot`.

## Layout

```
src/core/
├── config.ts             Load, freeze, env overrides, fs-watch hot reload
├── configValidation.ts   The semantic checks config.ts runs before accepting
├── db/                   SQLite: driver seam, connection, migrations,
│                         legacy import, kv blob store, row mappers
├── locales/              en.ts / de.ts string tables
├── rcon/RconClient.ts    Pure RCON protocol: TCP, packets, auth, dispatch
├── shell/execCommand.ts  execFile wrapper (no shell), sudo error detection
├── types/                Shared interfaces, grouped like utils/ below and
│                         re-exported via types/index.ts — import from there
└── utils/                See below
```

## `utils/`, and why it has subdirectories

`utils/` used to be 37 flat files, and the flatness was doing real damage: a
`utils.ts` grab-bag had accumulated filesystem helpers, whitelist domain logic,
and log parsing in one module, and nothing about the directory suggested where
anything new should go. The subdirectories are grouped by purpose, the same way
`bot/commands/` is:

| Directory | Holds | Rule of thumb |
|---|---|---|
| `minecraft/` | statUtils, snapshotUtils, streakLeaderboard, playerUtils, whitelist, mojang, modUtils, slimeChunk, chunkbaseUrl | Reads or interprets the Minecraft world and its players |
| `server/` | server, serverAccess, capabilities, hostResources, runtimeHeartbeat | The server instance, its host, and how we reach them |
| `stores/` | adminAudit, linkUtils, dailyStore, pollStore, sessionStore, noteStore, watchStore, waypointStore, challengeStore, uptimeTracker, playerCountHistory, whitelistAudit | Owns a table or a `kv_store` key. One owner per key, no exceptions |
| `config/` | configService, configDiff, configHistory | Reading, writing, diffing, and rolling back config |
| `commands/` | commandManifest, commandPolicy | What commands exist and whether they're enabled |

The eight files still at the root — `logger`, `time`, `i18n`, `objects`,
`sanitize`, `rateLimiter`, `paths`, `jsonStore` — are there on purpose. They are
the primitives every group uses and none of them owns; pushing them into a
subdirectory would just mean every subdirectory imports that one.

**A file at the root has to earn it.** The bar is: no domain knowledge, and more
than one group depends on it. If a new file is only used by one group, it goes
in that group. If it does not fit any group, that is a sign it does two things —
split it before it becomes the next `utils.ts`.

## The pieces

| Topic | File |
|---|---|
| Config loading, validation, env overrides, hot reload | [config.md](config.md) |
| SQLite, the JSON that stays JSON, caches, snapshots | [data-storage.md](data-storage.md) |
| `ServerInstance`, `serverAccess`, RCON, capabilities | [server-access.md](server-access.md) |
| Stats, leaderboards, players, whitelist | [minecraft.md](minecraft.md) |

## The two rules that catch people

**Console sinks go through `sanitize.ts`.** Any user-supplied text that ends up
in an RCON or screen command — `/say`, the chat bridge, whitelist, moderation,
in-game `!commands` — passes `sanitizeForConsole`/`stripControlChars` first, and
player names pass `isValidMcName`. A `\n` in a chat message is a second console
command. There is one implementation, it is tested, and hand-rolling a second
one is how the first hole gets opened.

**Every read from the database goes through a row mapper.** `mapRows`/`mapRow`
with an explicit `col.*` per column, selecting named columns. Never
`.all() as Row[]` — the repo runs `noUncheckedIndexedAccess` precisely so a
dropped column is a type error, and a cast at the storage edge throws that away
for every reader downstream. See [data-storage.md](data-storage.md).

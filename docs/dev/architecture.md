# Architecture

How the repo is laid out, what each layer is allowed to know, and which rules
keep it that way. Read this once before touching anything; it makes the rest of
the code predictable.

Workspace-specific detail lives with the workspace: [bot/](bot/index.md),
[core/](core/index.md), [web/](web/index.md).

## The 30-second version

The bot is a single Node.js process (TypeScript, ESM, discord.js v14). It has
two inputs and one abstraction in the middle:

```
Discord interactions ─┐                       ┌─ RCON (direct TCP)
                      ├─▶  ServerInstance  ───┼─ screen + sudo (local shell)
Server log lines  ────┘    (per MC server)    └─ API wrapper (HTTP, remote)
```

Everything a command or watcher wants from a Minecraft server goes through a
`ServerInstance`. The instance decides whether that means RCON, a screen
session, or an HTTP call to the remote API wrapper. Callers never know or care
which.

The dashboard is a second, optional process. It shares the config file and the
database with the bot and calls into it never: see [web/index.md](web/index.md).

## The workspaces

Since 4.0 the repo is an npm workspace whose layout mirrors the product
hierarchy — the bot is the main artifact, the dashboard its optional extension,
both standing on shared packages — while the code stays under `src/`, where this
repo has always kept it. Each workspace carries its own
`package.json`/`tsconfig.json`, with sources directly inside and build output in
a per-workspace `dist/` (a package's `exports` map cannot point outside its own
directory).

```
src/
├── bot/     (@mcbot/bot)     The product — the Discord process
│                             npm start → src/bot/dist/index.js
├── web/     (@mcbot/web)     The extension — Fastify backend + Vue frontend
│                             npm run start:web → src/web/dist/backend/index.js
├── core/    (@mcbot/core)    Process-agnostic core, imported by both
└── schema/  (@mcbot/schema)  Isomorphic contracts, imported by all three
```

Dependencies point one way only: `bot` and `web` depend on `core`; `core`
depends on `schema`; `schema` depends on nothing. There is no path back up, and
no path sideways between `bot` and `web`.

Imports across workspaces use package specifiers
(`@mcbot/core/utils/logger.js`), never relative paths. Tests live in `tests/`
(vitest, one suite for all workspaces), infrastructure at the root (Dockerfile
with `bot`/`web` targets, compose, PM2 ecosystem, GitHub workflows, setup wizard
under `scripts/`).

## The layers, bottom up

The first three are `core`; the fourth is `bot`. Each layer may call downward
and never upward.

### 1. Protocol: `RconClient`

A pure RCON implementation: socket lifecycle, binary packet encode/decode, auth
handshake, request/response correlation by packet ID, timeouts. It imports only
`net` and the logger. It knows nothing about Minecraft semantics or Discord,
which is what makes it mockable in tests. Concurrent callers during connect are
queued in a waiter list instead of polling.

### 2. Access routing: `serverAccess.ts`

One rule: if `config.apiUrl` is set, the operation becomes an HTTP call to the
API wrapper; otherwise it is the local implementation (file reads, `tail`,
spawning scripts via `sudo -u`). Functions are deliberately thin: routing plus
raw data, no business logic. Every operation that touches the filesystem or
shell for server data lives here, so callers never import `fs` or
`child_process` for server state.

### 3. Game operations: `ServerInstance`

One instance per configured server, created at startup and held in a
module-level registry. It owns `sendCommand()` (RCON first, screen fallback, or
wrapper for remote instances), the state readers (`isRunning`, `getList`,
`getTps`, `getSeed`, `getPlayerCoords`, `getPlayerDimension`), and a few small
caches. The canonical regexes for parsing RCON/NBT output live here and only
here. Details in [core/server-access.md](core/server-access.md).

### 4. Feature logic: commands and watchers

Slash commands, in-game `!commands`, and log/timer watchers — all of it `bot`,
all of it documented in [bot/index.md](bot/index.md).

## Server resolution

Commands resolve their target server through `resolveServer(interaction)` in
`bot/utils/guild/guildRouter.ts`:

1. Explicit `server` slash option
2. The guild's `defaultServer`
3. The first registered instance
4. Throws if nothing is configured

`tryResolveServer()` returns null instead of throwing for callers that handle
the missing case themselves (autocomplete). This is also the single enforcement
point for tenant isolation in multi-guild deployments: a guild may only target
servers it is allowed to, and that check exists exactly once. Never call
`getServerInstance()` directly from a command.

## Data flow examples

`/leaderboard`:

```
interaction → middleware (defer) → resolveServer → buildLeaderboard
  → loadAllStats (30s TTL cache) → serverAccess.readStats per UUID
  → flatten + extract + sort → statEmbeds.buildLeaderboardEmbed → editReply
```

A player types `!chunkbase` in-game:

```
server writes log line → LogWatcher reads delta → regex match
  → defineCommand cooldown check → handler
  → server.getSeed() + getPlayerCoords() (RCON or log-poll fallback)
  → server.sendCommand("/tellraw ...") back to the player
```

## State and persistence

Runtime state lives under `data/` in two media, and **ownership decides which**:
machine-written state goes to SQLite (`data/bot.db`), because the bot and the
dashboard write it concurrently and need transactional read-modify-write;
human-authored, machine-read state stays JSON (`config.json`,
`dailyRewards.json`), because an operator edits it in a text editor.

The table of what lives where, the migration runner, the caches, and the
snapshot format are in [core/data-storage.md](core/data-storage.md).

## Startup sequence

1. `loadConfig()`: read, validate, apply env overrides, freeze; `watchConfig()`
   arms hot reload.
2. `getDb()`: open the store, apply pragmas, run pending migrations, import any
   legacy JSON once. Both processes do this; whichever starts first applies the
   migrations and the other finds nothing to do.
3. `initServers()`: build one `ServerInstance` per config entry.
4. Load command files, skip disabled ones, register all globally with Discord.
5. On `clientReady`: `initMinecraftCommands()` loads in-game commands, creates a
   log watcher per server (via `wireServer`), and starts the schedulers (TPS,
   leaderboard, status embed, downtime, uptime flush, channel purge).
6. SIGTERM/SIGINT flush the uptime history before exit.

## Config-reload reconciliation

Both reload paths (`/config reload` and the `config.json` file watcher) call
`reconcileServers(client, freshConfig)` in `initMinecraftCommands.ts`:

- **Added server IDs**: `addServerInstance()` registers the instance, then
  `wireServer()` starts its log watcher and TPS monitor — identical to startup
  wiring. Tick-based consumers (snapshot timer, downtime monitor, status embed)
  resolve instances via `getAllInstances()` each cycle, so they pick the new
  server up automatically.
- **Removed server IDs**: `unwireServer()` stops the log watcher and clears the
  TPS timer, `removeServerInstance()` disconnects RCON and drops the instance
  from the registry.
- **Changed settings on an existing ID**: detected by config diff and reported
  as restart-required; the live instance keeps its original connection wiring on
  purpose.

Reconciliations are serialized through an internal promise chain, so a
near-simultaneous `/config reload` and file-watcher event for the same edit
cannot interleave add/remove of the same ID — the second call sees an empty
diff.

## Localization

User-visible strings resolve through `t(key, vars)` in `core/utils/i18n.ts`.
Locales are plain TS maps in `core/locales/` (`en.ts` is the default and
fallback, `de.ts` overrides per key); `config.language` selects the active one,
and missing keys fall back en → key. The layer is deliberately minimal — no
plural rules, no nested keys, no runtime file loading. **All new user-visible
strings must go through `t()`**; existing literal strings migrate key-by-key
whenever a command is touched, so the map grows with the code instead of in one
risky bulk rewrite. `npm run i18n:check` fails CI if the two files drift.

## The setup-suite contract

Several features assume artifacts created by
[minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup)
rather than vanilla server files. This is an implicit external contract; keep it
in mind when changing `serverAccess.ts`:

| Code | Suite artifact |
|---|---|
| `serverAccess.runScript` (used by `/server *`) | `start.sh`, `shutdown.sh`, `smart_restart.sh`, `misc/status.sh`, `backup/backup.sh` in `scriptDir`; backup accepts `--archive` |
| `serverAccess` backup info (used by `/backup`) | Tier layout `backups/hourly` and `backups/archives/{daily,weekly,monthly,update}` |
| `modUtils` (used by `/mods`) | `{scriptDir}/common/downloaded_versions.json` |
| `config.ts` overrides | `{scriptDir}/common/variables.txt` |
| The remote API wrapper | Is itself part of the suite ecosystem |

Everything else (RCON, log parsing, stats, whitelist) works against a plain
server. How the artifacts are detected and how the gaps are gated is in
[core/server-access.md](core/server-access.md).

## Layer import rules

The workspace rows are enforced twice — by ESLint boundary rules
(`eslint.config.js`) and by the dependency trees themselves (`npm ci -w
@mcbot/web` cannot even install discord.js). The module rows are enforced in
review.

| Layer | May import | Must not import |
|---|---|---|
| `src/schema/**` | nothing | every workspace, Node built-ins |
| `src/core/**` | core + `@mcbot/schema` | `src/bot`, `src/web` |
| `src/bot/**` | `@mcbot/core`, `@mcbot/schema` | `src/web` |
| `src/web/**` | `@mcbot/core`, `@mcbot/schema` | `src/bot`, discord.js at runtime |
| `bot/commands/*` | guildRouter, embeds, middleware, core utils, types | `fs`/`child_process` directly, RconClient |
| `bot/logWatcher/watchers/**` | `ServerInstance`, embeds, logger | `bot/commands/*` |
| `core/utils/minecraft/*` | core utils, server, serverAccess, logger | embeds, discord.js |
| `bot/utils/embeds/statEmbeds` | statUtils, embedUtils, discord.js | server.ts, config.ts |
| `core/rcon/RconClient` | `net`, logger | everything else |
| `core/utils/server/serverAccess` | `fs`, `child_process`, types | discord.js, `bot/commands` |

The point of the table: Discord rendering, game logic, and transport stay
separable, so each can be tested without the others — and the dashboard can
never call into the running bot. It writes config through
`configService.writeConfig`; the bot's fs-watcher applies it. Both directions of
independence are load-bearing: the bot never references its extension, and the
dashboard runs its own `ServerInstance` registry so server control and config
edits keep working while the bot is down.

If your change needs to cross a line, the design is wrong; restructure instead
of importing.

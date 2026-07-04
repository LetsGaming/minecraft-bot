# Architecture

How the codebase is structured, how data flows through it, and which rules keep it that way. Read this once before touching anything; it makes the rest of the code predictable.

## The 30-second version

The bot is a single Node.js process (TypeScript, ESM, discord.js v14). It has two inputs and one abstraction in the middle:

```
Discord interactions ─┐                       ┌─ RCON (direct TCP)
                      ├─▶  ServerInstance  ───┼─ screen + sudo (local shell)
Server log lines  ────┘    (per MC server)    └─ API wrapper (HTTP, remote)
```

Everything a command or watcher wants from a Minecraft server goes through a `ServerInstance`. The instance decides whether that means RCON, a screen session, or an HTTP call to the remote API wrapper. Callers never know or care which.

## Directory map

```
src/
├── index.ts                  Entry point: client, command loading/registration,
│                             interaction dispatch, rate limiting, shutdown hooks
├── config.ts                 Config loading, validation, env overrides, hot reload
├── commands/                 Slash commands, one file per command
│   ├── middleware.ts         withErrorHandling(), requireServerAdmin()
│   └── <category>/<name>.ts  exports `data` (builder) and `execute`
├── logWatcher/
│   ├── logWatcher.ts         Local file tailing (fs.watch + 1s polling fallback)
│   ├── RemoteLogWatcher.ts   SSE stream from the API wrapper, same interface
│   ├── defineCommand.ts      Declarative framework for in-game !commands
│   ├── initMinecraftCommands.ts  Wires watchers + schedulers per server at startup
│   ├── commands/             In-game !commands (one file each)
│   └── watchers/             Log-driven and timer-driven background features
├── rcon/RconClient.ts        Pure RCON protocol: TCP, packets, auth, dispatch
├── shell/execCommand.ts      execFile wrapper (no shell), sudo error detection
├── utils/
│   ├── server.ts             ServerInstance + instance registry
│   ├── serverAccess.ts       Local-vs-remote routing for every FS/shell/HTTP op
│   ├── guildRouter.ts        resolveServer(interaction): the one server resolver
│   ├── utils.ts              loadJson/saveJson (cache + write locks), whitelist cache
│   ├── statUtils.ts          Stat loading/flattening/filtering, leaderboard data
│   ├── statEmbeds.ts         Stat data → Discord embeds
│   ├── embedUtils.ts         Embed factories, pagination
│   └── ...                   time, logger, links, mods, uptime, snapshots, audit
└── types/                    All shared interfaces, re-exported via types/index.ts
```

Tests live in `tests/` (vitest), infrastructure at the root (Dockerfile, compose, PM2 ecosystem, setup wizard under `scripts/`).

## The layers, bottom up

### 1. Protocol: `RconClient`

A pure RCON implementation: socket lifecycle, binary packet encode/decode, auth handshake, request/response correlation by packet ID, timeouts. It imports only `net` and the logger. It knows nothing about Minecraft semantics or Discord, which is what makes it mockable in tests. Concurrent callers during connect are queued in a waiter list instead of polling.

### 2. Access routing: `serverAccess.ts`

One rule: if `config.apiUrl` is set, the operation becomes an HTTP call to the API wrapper; otherwise it is the local implementation (file reads, `tail`, spawning scripts via `sudo -u`). Functions are deliberately thin: routing plus raw data, no business logic. Every operation that touches the filesystem or shell for server data lives here, so callers never import `fs` or `child_process` for server state.

### 3. Game operations: `ServerInstance`

One instance per configured server, created at startup and held in a module-level registry (`getServerInstance`, `getAllInstances`, `getGuildServer`). It owns:

- `sendCommand()`: RCON first, screen fallback, or wrapper for remote instances
- `isRunning()`, `getList()`, `getTps()`, `getSeed()`, `getPlayerCoords()`, `getPlayerDimension()`
- Small caches (seed, "does this server have a /tps command")

The canonical regexes for parsing RCON/NBT output live here and only here.

### 4. Feature logic: commands and watchers

**Slash commands** are discovered by walking `dist/commands/` at startup. Each file exports a `SlashCommandBuilder` as `data` and an `execute` function. Cross-cutting concerns come from `middleware.ts`:

```ts
export const execute = withErrorHandling(      // defer + error embed + logging
  requireServerAdmin(async (interaction) => {  // optional admin gate
    const server = resolveServer(interaction); // the one way to pick a server
    ...
  }),
);
```

**Watchers** subscribe regexes to a per-server log watcher (`watcher.register(regex, handler)`). Local servers use file tailing, remote ones an SSE stream; the interface is identical (`ILogWatcher`), so watcher code never branches on local/remote. Timer-driven features (TPS monitor, downtime monitor, leaderboard scheduler, status embed, channel purge) are started from `initMinecraftCommands.ts` too.

**In-game commands** use `defineCommand()` from `logWatcher/defineCommand.ts`, which generates the chat-line regex, handles per-player cooldowns, parses arguments, and registers the handler globally. A command file is ~30 lines of pure handler logic.

### 5. Server resolution: `guildRouter.ts`

All commands resolve their target server through `resolveServer(interaction)`:

1. Explicit `server` slash option
2. The guild's `defaultServer`
3. The first registered instance
4. Throws if nothing is configured

`tryResolveServer()` returns null instead of throwing for callers that handle the missing case themselves (autocomplete).

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

There is no database. All runtime state is JSON under `data/`, accessed through `loadJson`/`saveJson` in `utils.ts`, which add an mtime-based read cache and a per-file promise-chain write lock (concurrent writes serialize instead of clobbering each other). Details per file: [data-storage.md](data-storage.md).

## The setup-suite contract

Several features assume artifacts created by [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup) rather than vanilla server files. This is an implicit external contract; keep it in mind when changing `serverAccess.ts`:

| Code | Suite artifact |
|---|---|
| `serverAccess.runScript` (used by `/server *`) | `start.sh`, `shutdown.sh`, `smart_restart.sh`, `misc/status.sh`, `backup/backup.sh` in `scriptDir`; backup accepts `--archive` |
| `serverAccess` backup info (used by `/backup`) | Tier layout `backups/hourly` and `backups/archives/{daily,weekly,monthly,update}` |
| `modUtils` (used by `/mods`) | `{scriptDir}/common/downloaded_versions.json` |
| `config.ts` overrides | `{scriptDir}/common/variables.txt` |
| The remote API wrapper | Is itself part of the suite ecosystem |

Everything else (RCON, log parsing, stats, whitelist) works against a plain server.

Suite artifacts are detected at runtime: `serverAccess.detectCapabilities(cfg)` probes the documented layout (management scripts, backup tiers, mod manifest, variables.txt) per server — locally via `fs.existsSync`, remotely via `GET /instances/:id/capabilities` with a conservative all-true fallback for wrappers that predate the route. The result is cached on `ServerInstance.capabilities`, logged as a one-line summary at startup, and re-probed on every config reload (so installing the suite later is picked up without a restart, except for command registration).

Gating happens at two levels (`utils/capabilities.ts`): `/backup` and `/mods` are skipped at command-registration time when *no* configured instance provides the capability; per invocation, `requireCapability()` replaces raw ENOENT/"Script not found" errors with a friendly message pointing at the setup docs. `/server` is never registration-gated because its `prune-stats` subcommand is suite-independent — only its script-based subcommands are gated per invocation. Unprobed instances (`capabilities === null`) always pass the gates, which keeps legacy behaviour for anything that skips probing. Suite-dependent additions still belong behind `serverAccess` functions so the contract stays in one file — plus a flag in `detectCapabilities` and a gate at the call site.

## Startup sequence

1. `loadConfig()`: read, validate, apply env overrides, freeze; `watchConfig()` arms hot reload.
2. `initServers()`: build one `ServerInstance` per config entry.
3. Load command files, skip disabled ones, register all globally with Discord.
4. On `clientReady`: `initMinecraftCommands()` loads in-game commands, creates a log watcher per server (via `wireServer`, which tracks the watcher + TPS timer per server ID), and starts the schedulers (TPS, leaderboard, status embed, downtime, uptime flush, channel purge).
5. SIGTERM/SIGINT flush the uptime history before exit.

## Localization

User-visible strings resolve through `t(key, vars)` in `utils/i18n.ts`. Locales are plain TS maps in `src/locales/` (`en.ts` is the default and fallback, `de.ts` overrides per key); `config.language` ("en" | "de") selects the active one, and missing keys fall back en → key. The layer is deliberately minimal — no plural rules, no nested keys, no runtime file loading. **All new user-visible strings must go through `t()`**; existing literal strings migrate key-by-key whenever a command is touched, so the map grows with the code instead of in one risky bulk rewrite.

## Config-reload reconciliation

Both reload paths (`/config reload` and the `config.json` file watcher) call `reconcileServers(client, freshConfig)` in `initMinecraftCommands.ts`:

- **Added server IDs**: `addServerInstance()` registers the instance, then `wireServer()` starts its log watcher and TPS monitor — identical to startup wiring. Tick-based consumers (snapshot timer, downtime monitor, status embed) resolve instances via `getAllInstances()` each cycle, so they pick the new server up automatically.
- **Removed server IDs**: `unwireServer()` stops the log watcher and clears the TPS timer, `removeServerInstance()` disconnects RCON and drops the instance from the registry.
- **Changed settings on an existing ID**: detected by config diff and reported as restart-required; the live instance keeps its original connection wiring on purpose.

Reconciliations are serialized through an internal promise chain, so a near-simultaneous `/config reload` and file-watcher event for the same edit cannot interleave add/remove of the same ID — the second call sees an empty diff.

## Layer import rules

These are enforced in review (see [coding-guidelines.md](coding-guidelines.md) for the full rule set):

| Layer | May import | Must not import |
|---|---|---|
| `commands/*` | guildRouter, embedUtils, middleware, statUtils, types | fs/child_process directly, RconClient |
| `logWatcher/watchers/*` | server.ts (ServerInstance), embedUtils, logger | commands/* |
| `statUtils`, `playerUtils` | utils, server, serverAccess, logger | embedUtils, discord.js |
| `statEmbeds` | statUtils, embedUtils, discord.js | server.ts, config.ts |
| `RconClient` | net, logger | everything else |
| `serverAccess` | fs, child_process, types | discord.js, commands |

The point of the table: Discord rendering, game logic, and transport stay separable, so each can be tested without the others.

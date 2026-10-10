# Server access

How the code reaches a Minecraft server. Two modules, stacked, the lower one
knowing less than the upper: `serverAccess` (transport) → `ServerInstance`
(operations).

Everything goes to the [API wrapper](https://github.com/LetsGaming/minecraft-server-api)
on the Minecraft host, over HTTP. The bot does not read the server's files,
does not spawn its scripts, and does not open an RCON socket — the wrapper
does all three, because it is the process that is actually on that machine.

## `serverAccess` — the transport

One route per function, raw data back, no business logic. Nothing in the bot
imports `fs` or `child_process` for server state; there is nothing to import it
for. `serverAccess.ts` is a barrel over the per-feature modules in
`src/core/utils/server/access/`; the module map is in
[architecture.md](../architecture.md#1-transport-serveraccessts).

Until 5.0.0 this module was a *routing* seam with one rule — HTTP if
`config.apiUrl` was set, local filesystem and `sudo -u` otherwise — and under
it sat an `RconClient` and an `execCommand` layer. Both are gone. The two modes
meant every feature was implemented twice, and they drifted: `/stats` answered
differently for a player with no stats file, daily rewards were verified on one
path and assumed on the other, and `sendCommand` silently preferred RCON over
the wrapper when both were configured.

Two functions do not simply assert-and-decode:

- `readStats` treats a 404 as `null` — a player who has never played is an
  answer, not a failure — while a 500 still throws.
- `sendCommandOutcome` never throws. It maps the wrapper's `POST /command`
  reply (`{ result, via, sent, rconError? }`, `rcon-command` v2) to a
  `CommandOutcome`: `via: "rcon"` is `delivered`, `via: "screen"` is `sent`
  (`rcon-fallback` when `rconError` is set), and a `502` (neither channel
  could deliver) is `unreachable` with reason `screen-failed`. A v1 wrapper
  answers `{ result }` only; a string is read as `delivered` and `null` as
  `sent`. Transport failures, timeouts, 429 and an open circuit breaker are
  `unreachable` too. It is the only write that goes through the circuit breaker:
  a down wrapper fails an in-game command at once, while scripts, mod mutations
  and restore still reach the wrapper on every attempt.

Three functions deliberately bypass the `apiGet` decode path, because JSON in
memory is the wrong shape for what they carry:

- `openLogStream` opens the wrapper's SSE feed and returns a live
  `SseLineStream`. It is the only place that knows the wrapper sends
  `{"line": …}` per frame; the transport underneath knows nothing about
  Minecraft, Discord, or what a payload means. Both the bot's log watcher and
  the dashboard's console hub consume it, which is the point — there was one
  working SSE client in the repo and it lived somewhere `web` could not import.
- `openBackupDownload` returns the `Response` with its body **unread**, so the
  caller can pipe it. These archives run to gigabytes; decoding one to hand it
  on would take the process down.
- `restoreBackupFile` posts to a dedicated wrapper route rather than running a
  script action. The wrapper's argument validator forbids `/` so a client can
  never hand a path to a spawned shell, and `restore.sh` needs an absolute path
  — so the wrapper resolves an opaque backup id to a path itself, and no caller
  on this side ever names one.

## `ServerInstance` — the operations

One instance per configured server, built at startup, held in a module-level
registry (`getServerInstance`, `getAllInstances`, `getGuildServer`). It owns:

- `send()`, which returns a `CommandOutcome` and never throws. A command that
  did not reach the server is logged once there; callers decide what to skip
  (record nothing, release a cooldown, retry later).
- `isRunning()`, `getList()`, `getTps()`
- The live player queries `getSeed()`, `getPlayerCoords()`,
  `getPlayerDimension()`, `getLastDeathLocation()` and `getPlayerData()`. Each
  returns a `QueryResult` (`{ ok: true, value }` or `{ ok: false, reason }`
  with `unreachable`, `player-offline`, `no-data` or `unreadable`). An RCON
  reply is parsed as is; only a send with no reply channel makes it poll the
  log, and only server-emitted lines count (`minecraft/consoleResponse.ts`), so
  chat cannot forge an answer. An unreachable server fails at once. There is no
  default dimension: a caller that cannot learn it says so.
- A seed cache. The "does this server have a `/tps` command" cache went with
  the RCON client.

**The canonical regexes for parsing console/NBT output live here and only
here.** Every time one of them has been copied out, the copy drifted. TPS is
the exception and for the same reason: the wrapper holds the connection, so it
is the only side that sees a `tps` response, and it parses it. Those regexes
and their regression guards live in the wrapper's `tests/instances/tps.test.ts`.

Commands do not reach the registry directly — they go through
`resolveServer(interaction)`. See
[architecture.md](../architecture.md#server-resolution).

## Timeouts and failure handling

- Reads wait 8 s (`DEFAULT_GET_TIMEOUT_MS` in `access/apiClient.ts`). Mod
  install and update, backup download (header wait only, the body is streamed
  without a limit), restore, delete and config writes each have their own
  ceiling next to the function that makes the request.
- A management script waits as long as the wrapper does. `access/manifest.ts`
  keeps the `scriptTimeoutsMs` table from `/manifest`; `wrapperContract.ts`
  clamps each value to 5 s to 15 min and falls back to a built-in table
  (`FALLBACK_SCRIPT_TIMEOUTS_MS`) for a wrapper that does not advertise one. A
  script that outlives the wait throws `ScriptStillRunningError`, which callers
  report as "still running", not as a failure.
- The per-server circuit breaker (`circuitBreaker.ts`) opens after 5
  consecutive failures, fails fast for 15 s, then lets one probe through. A 429
  is the wrapper rate limiting, not failing: it never counts toward the breaker
  and surfaces as `RateLimitedError`. Reads and `sendCommandOutcome` use the
  breaker; scripts, mod mutations and restore do not.

## Capabilities

The bot is designed for servers installed via the
[minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup)
suite, but works against a plain server for everything that does not depend on
suite artifacts. Rather than letting that surface as a raw ENOENT at invocation
time, `detectCapabilities(cfg)` asks the wrapper — `GET /instances/:id/capabilities`,
with a conservative all-true fallback for wrappers that predate the route. The result
is cached on `ServerInstance.capabilities`, logged as a one-line summary at
startup, and re-probed on every config reload, so installing the suite later is
picked up without a restart (command registration excepted).

Gating happens at two levels, both in `utils/server/capabilities.ts`:

- **At registration.** `/backup` and `/mods` are skipped entirely when *no*
  configured instance provides the capability.
- **Per invocation.** `requireCapability()` replaces the raw error with a
  message pointing at the setup docs.

`/server` is never registration-gated, because its `prune-stats` subcommand is
suite-independent; only its script-based subcommands gate per invocation.
Unprobed instances (`capabilities === null`) always pass, which keeps legacy
behaviour for anything that skips probing.

The script names themselves are a shared contract
(`@mcbot/schema/serverActions.js`), not a literal per layer — the capability
flags derive from the same tuple (`ScriptCapabilities` is
`Record<ServerScriptAction, boolean>`), so adding a script fails the build
everywhere it has to be handled. Adding `rollback` in 5.1.0 is the worked
example: one entry in the tuple, and the compiler named every site that had to
change.

`restore` sits on `ServerCapabilities` **outside** `scripts`, because it is not
a script action — see `restoreBackupFile` above.

Capabilities answer "does this instance have the artifact". They cannot answer
"is this wrapper new enough to serve that route", which is what the manifest is
for: `EXPECTED_WRAPPER_FEATURES` in `wrapperContract.ts` lists every feature
this bot knows about with what is lost without it, and the startup report prints
the gaps. The dashboard reads the same manifest to decide whether to show its
Backups tab.

Suite-dependent additions still belong behind a `serverAccess` function, so the
contract stays in one file, plus a flag in `detectCapabilities` and a gate at
the call site.

## Host and liveness

- `hostResources.ts` — RAM/CPU of the server process and disk usage of the world
  and backup paths, read from the wrapper's `/info`. An older wrapper yields
  null and the caller skips the instance rather than erroring.
- `runtimeHeartbeat.ts` — the bot overwrites `data/runtime.json` roughly once a
  minute; the dashboard reads it and treats a stale timestamp as "bot down". A
  file rather than a socket, because both processes already share the data
  directory and a socket would add a failure mode for one boolean.

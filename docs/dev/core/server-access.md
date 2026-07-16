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
for.

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
- `sendCommand` returns `null` when the wrapper reached the server over screen
  and has no output to relay, which is distinct from the request failing.

## `ServerInstance` — the operations

One instance per configured server, built at startup, held in a module-level
registry (`getServerInstance`, `getAllInstances`, `getGuildServer`). It owns:

- `sendCommand()`, which catches transport errors and returns `null` — so
  callers that must tell "unreachable" from "no output channel" (`give()` in
  `daily.ts`) read `serverAccess` directly instead
- `isRunning()`, `getList()`, `getTps()`, `getSeed()`, `getPlayerCoords()`,
  `getPlayerDimension()`
- A seed cache. The "does this server have a `/tps` command" cache went with
  the RCON client.

**The canonical regexes for parsing console/NBT output live here and only
here.** Every time one of them has been copied out, the copy drifted. TPS is
the exception and for the same reason: the wrapper holds the connection, so it
is the only side that sees a `tps` response, and it parses it. Those regexes
and their regression guards live in the wrapper's `tests/tps.test.ts`.

Commands do not reach the registry directly — they go through
`resolveServer(interaction)`. See
[architecture.md](../architecture.md#server-resolution).

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
flags derive from the same tuple, so adding a script fails the build everywhere
it has to be handled.

Suite-dependent additions still belong behind a `serverAccess` function, so the
contract stays in one file, plus a flag in `detectCapabilities` and a gate at
the call site.

## Host and liveness

- `hostResources.ts` — RAM/CPU of the server process and disk usage of the world
  and backup paths. Local instances go through `execCommand` (`execSafe`, no
  shell interpolation); remote ones get the same numbers from the wrapper's
  `/info`. An older wrapper yields null and the caller skips the instance rather
  than erroring.
- `runtimeHeartbeat.ts` — the bot overwrites `data/runtime.json` roughly once a
  minute; the dashboard reads it and treats a stale timestamp as "bot down". A
  file rather than a socket, because both processes already share the data
  directory and a socket would add a failure mode for one boolean.

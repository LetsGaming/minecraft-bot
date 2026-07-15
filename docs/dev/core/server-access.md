# Server access

How the code reaches a Minecraft server. Three modules, stacked, each knowing
less than the one above it: `RconClient` (protocol) → `serverAccess` (routing) →
`ServerInstance` (operations).

## `RconClient` — the protocol

Socket lifecycle, binary packet encode/decode, the auth handshake,
request/response correlation by packet ID, timeouts. It imports `net` and the
logger, and nothing else. No Minecraft semantics, no Discord, no config.

That is what makes it testable against an in-process mock socket
(`tests/server/rconClient.test.ts` round-trips the packets), and it is the shape to
copy for any future protocol client: dependency-injected, no ambient knowledge
of the app it serves.

## `serverAccess` — the routing seam

One rule, and it is the whole module:

> If `config.apiUrl` is set, the operation is an HTTP call to the API wrapper.
> Otherwise it is the local implementation.

Local means reading files, `tail`, and spawning scripts via `sudo -u`. Remote
means the wrapper on the Minecraft host does that instead. Functions here are
deliberately thin — routing plus raw data, no business logic — because the
moment one of them makes a decision, that decision exists in only one of the two
modes.

**This is the only place in the codebase that imports `fs` or `child_process`
for server data.** If a caller needs something from the server's disk, it gets a
function here; it does not read the file itself. That is what makes remote
instances work without a single `if (remote)` anywhere else.

Responses from it are cast to the caller's `T` — that is asserting a pinned
first-party contract that the feature check below protects, not trusting
arbitrary JSON. The one exception is the manifest itself, which is parsed
rather than cast: it *is* the check, so trusting its shape would assume what
it exists to establish.

## The wrapper feature contract

Every wrapper call degrades on its own: a 404 on `/usercache` becomes "no
usercache names", a 404 on `/capabilities` becomes "assume everything works".
Individually that is right. Collectively it means **an outdated wrapper and a
healthy one look identical**, which is exactly how a feature gap reaches
production.

`GET /manifest` on the wrapper closes that. It reports the wrapper version, a
versioned feature list, the routes it serves, and the script actions its runner
accepts — generated from Fastify's router and the runner's own action map, so
it cannot claim something the wrapper does not do. (It is generated rather than
being `openapi.yaml` for a concrete reason: that file is hand-maintained and has
already drifted badly enough to describe four routes that never existed. A
mismatch check reading it would be confidently wrong, which is worse than the
honest 404 it replaces.)

`wrapperContract.ts` holds the bot's half — `EXPECTED_WRAPPER_FEATURES`, one
entry per feature with a version and a plain-English `degrades` string — and
`verifyWrapperContract()` diffs the two at startup, **both directions**:

| Case | Reported as |
|---|---|
| Bot wants it, wrapper lacks it | `does not provide "usercache" — names for players who are not on the whitelist. Update the wrapper.` |
| Wrapper's feature version is older | `provides "host-info" v0, this bot expects v1 … Update the wrapper.` |
| Wrapper's feature version is newer | `newer than the v1 bot 4.3.0 implements — may misbehave until the bot is updated.` |
| Wrapper offers something the bot never uses | `offers features bot 4.3.0 does not use: backup-prune. Update the bot.` |

The last two had no mechanism at all before: "the wrapper is ahead of the bot"
was invisible.

Feature names are a cross-repo contract with no shared package — the wrapper
cannot depend on `@mcbot/schema`. The two ends are this table and the wrapper's
`FEATURES` const, and the wrapper's CI holds up its side: every feature's routes
must exist, every instance route must belong to a feature (so a new route cannot
ship without the bot hearing about it), and `openapi.yaml` must match the router.

**`MIN_WRAPPER_VERSION` is the fallback only.** Wrappers predating `/manifest`
get the old coarse version compare. Set it to the release that introduced the
endpoints the bot treats as baseline — currently `3.0.0` (`/info`, `/usercache`,
capabilities). It read `1.2.0` until 2026-07: the version the bot *predicted*
`/info` would land in. The wrapper shipped it two majors later, so no wrapper
that answered `/info` was ever below the floor, the comparison was unreachable,
and the constant documented something untrue. Worth remembering when bumping it
— a floor you cannot fail is not a floor.

## `ServerInstance` — the operations

One instance per configured server, built at startup, held in a module-level
registry (`getServerInstance`, `getAllInstances`, `getGuildServer`). It owns:

- `sendCommand()`: RCON first, screen fallback, or the wrapper for remote
  instances
- `isRunning()`, `getList()`, `getTps()`, `getSeed()`, `getPlayerCoords()`,
  `getPlayerDimension()`
- Small caches (seed, "does this server have a `/tps` command")

**The canonical regexes for parsing RCON/NBT output live here and only here.**
Every time one of them has been copied out, the copy drifted.

Commands do not reach the registry directly — they go through
`resolveServer(interaction)`. See
[architecture.md](../architecture.md#server-resolution).

## Capabilities

The bot is designed for servers installed via the
[minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup)
suite, but works against a plain server for everything that does not depend on
suite artifacts. Rather than letting that surface as a raw ENOENT at invocation
time, `detectCapabilities(cfg)` probes for the artifacts per server — locally
with `fs.existsSync`, remotely via `GET /instances/:id/capabilities`, with a
conservative all-true fallback for wrappers that predate the route. The result
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

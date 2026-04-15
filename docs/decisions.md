# Architectural Decisions

This file documents *why* certain choices were made — the invisible logic that isn't visible in the code itself. It is kept current with every significant refactor.

---

## Phase 1 — Quick Wins

### `saveJson()` write-lock mutex

**Problem:** Two concurrent Discord interactions (e.g. two players running `/link` simultaneously) could both read the same JSON file, modify it independently, and write it back. Last write wins — the other change is silently lost.

**Decision:** Per-file async mutex using a promise chain (`writeLocks` map in `utils/utils.ts`). Each write operation chains off the previous write to the same file, so they serialize automatically without a library dependency.

**Trade-off:** If a write callback throws an unhandled error and the `.catch(() => {})` sentinel fires, the chain resets cleanly — but that write is lost. This is preferable to poisoning all future writes to that file.

---

### Centralized logging via `log` from `logger.ts`

**Rule:** No direct `console.log`, `console.warn`, or `console.error` anywhere in production code except `logger.ts` itself. All log output goes through `log.info / log.warn / log.error`.

**Rationale:** Structured log output with timestamps and tags. When log aggregation is added later, there is a single insertion point.

**Enforcement:** `"no-console": "error"` in `.eslintrc`.

---

### `createEmbed()` factory — no naked `new EmbedBuilder()` chains

**Rule:** All embed construction uses named factory functions from `utils/embedUtils.ts`. No module outside `embedUtils.ts` may call `new EmbedBuilder()` directly.

**Rationale:** Any style change (default color, timestamp format, footer branding) requires touching one file instead of hunting every watcher and command.

**Extension:** `EmbedOptions` was extended with an optional `author` field and `title` was made optional, allowing author-only embeds (chat bridge) and embed-only embeds (status) to use the same factory.

---

### `statEmbeds.ts` split from `statUtils.ts`

**Problem:** `statUtils.ts` violated SRP — it handled stat loading, flattening, filtering, leaderboard building, *and* Discord embed rendering.

**Decision:** `buildStatsEmbeds` and its `groupByCategory` helper moved to `utils/statEmbeds.ts`. `statUtils.ts` is now pure data — no Discord imports.

**Layer rule:** `statUtils` may import `utils`, `server`, `logger`. It must NOT import `embedUtils` or any Discord type. Embed concerns belong in `statEmbeds.ts`.

---

### `getRootDir()` as the single project root resolver

`findProjectRoot()` in `config.ts` and `getRootDir()` in `utils/utils.ts` were algorithmically identical. `findProjectRoot()` was deleted; `config.ts` now imports `getRootDir()` from `utils/utils.ts`.

---

## Phase 2 — Structural Changes

### `RconClient` extracted from `ServerInstance`

**Problem:** `ServerInstance` mixed RCON protocol (TCP socket management, binary packet encoding/decoding, connection lifecycle) with Minecraft game logic (TPS, player list, seeds). The protocol layer could not be unit-tested without a real network socket.

**Decision:** `RconClient` (`rcon/RconClient.ts`) owns everything protocol-related: `encodePkt`, `decodePkt`, `connect()`, `disconnect()`, `send()`. `ServerInstance` composes a `RconClient` via `this._rcon`. Game-level methods (`getTps`, `getList`, `getSeed`, etc.) remain in `ServerInstance`.

**Key invariant:** `RconClient` has zero imports from Discord, config, or game utilities. It is a pure protocol adapter: `net` (stdlib) + `logger` only.

**Testability:** `RconClient` can be tested by injecting a mock `net.Socket`. `ServerInstance` can be tested by injecting a mock `RconClient`.

---

### Guild router — `resolveServer(interaction)`

**Problem:** Every command independently duplicated `serverId ? getServerInstance(serverId) : getGuildServer(guild.id)`. This was ~12 identical blocks, impossible to test, and hard to change consistently.

**Decision:** `utils/guildRouter.ts` exports a single `resolveServer(interaction)` function. All commands call exactly this, nothing else.

**Resolution order:**
1. Explicit `server` slash option → `getServerInstance(explicit)`
2. Guild's `defaultServer` config → `getGuildServer(guild.id)`
3. First registered instance (fallback)
4. Throws if none found

**`tryResolveServer`** is also exported for commands that need to handle the missing-server case themselves rather than letting the middleware catch the throw.

---

### Legacy server shims — deprecation path

Six free functions at the bottom of `server.ts` hard-code the server ID `"default"`:  
`getServerConfig`, `sendToServer`, `isServerRunning`, `getServerSeed`, `getServerList`, `getPlayerData`.

These exist for backward compatibility with `utils/utils.ts` and `utils/playerUtils.ts` which predate multi-server support. They are marked `// TO BE REMOVED` and will be deleted in a follow-up once `playerUtils.ts` is fully migrated to accept a `ServerInstance` argument.

---

### Duplicate coordinate/dimension parsing removed

`playerUtils.ts` had its own implementations of `getPlayerCoords` and `getPlayerDimension`, each with a duplicated regex for parsing NBT output. `ServerInstance` had the authoritative versions.

**Decision:** `playerUtils.ts` versions now delegate to `ServerInstance`:
```typescript
export async function getPlayerCoords(server: ServerInstance, playerName: string)
```

The coordinate regex `[\d.+-]+)d` now lives in exactly one place: `ServerInstance.getPlayerCoords`.

---

### `loadAllStats()` TTL cache

**Problem:** Every `/leaderboard` or `/top` invocation triggered a full `readdir` + N file reads. Under burst usage (e.g. several users running commands at once), this was needlessly redundant.

**Decision:** 30-second in-memory TTL cache. The cache is invalidated explicitly by:
- `invalidateAllStatsCache()` — called after `takeSnapshot()` and after `deleteStats()`
- Automatic TTL expiry after 30 seconds

**Trade-off:** Leaderboard results can lag up to 30 seconds behind a player's stats updating. This is acceptable for a public leaderboard. If real-time accuracy is needed, reduce `ALL_STATS_TTL_MS` or call `invalidateAllStatsCache()` on the `playerLeave` log watcher event.

---

## Layer Import Rules

| Layer | May import | Must NOT import |
|---|---|---|
| `commands/*` | `guildRouter`, `embedUtils`, `middleware`, `types` | `server.ts` internals, `loadJson`, `fsPromises` directly |
| `logWatcher/watchers/*` | `server.ts` (ServerInstance), `embedUtils`, `logger` | `commands/*`, `config.ts` directly |
| `statUtils`, `playerUtils` | `utils.ts`, `server.ts`, `logger` | `embedUtils`, `commands/*` |
| `statEmbeds.ts` | `statUtils`, `embedUtils`, `discord.js` | `server.ts`, `config.ts`, `logger` |
| `RconClient` | `net` (stdlib), `logger` | Everything else — pure protocol layer |
| `guildRouter` | `server.ts`, `config.ts` | `embedUtils`, `statUtils`, `commands/*` |

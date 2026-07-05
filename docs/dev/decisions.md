# Architectural decisions

This file documents why certain choices were made: the invisible logic that the code itself does not show. It is kept current with every significant refactor. Newest entries at the bottom.

The enforceable rules derived from these decisions live in [coding-guidelines.md](coding-guidelines.md); this file holds the reasoning.

---

## `saveJson()` write-lock mutex

**Problem:** Two concurrent interactions (e.g. two players finishing `/link` at the same time) could both read the same JSON file, modify it independently, and write it back. Last write wins; the other change is silently lost.

**Decision:** Per-file async mutex via a promise chain (`writeLocks` map in `utils/utils.ts`). Each write chains off the previous write to the same file, so writes serialize without a library dependency.

**Trade-off:** If a write throws, the `.catch(() => {})` sentinel resets the chain cleanly, but that write is lost. Preferable to poisoning all future writes to the file.

---

## Centralized logging via `log` from `logger.ts`

**Rule:** No `console.*` anywhere in production code except `logger.ts` itself.

**Rationale:** Structured output with timestamps and tags, one insertion point if log aggregation is added later. Enforced by ESLint `no-console`.

---

## `createEmbed()` factory, no naked `new EmbedBuilder()`

**Rule:** All embeds come from the factories in `utils/embedUtils.ts`.

**Rationale:** Style changes (default color, timestamp behavior, branding) touch one file instead of every watcher and command. `EmbedOptions` grew an optional `author` field and an optional `title` so author-only embeds (chat bridge) and field-only embeds (status) use the same factory.

---

## `statEmbeds.ts` split from `statUtils.ts`

**Problem:** `statUtils.ts` handled stat loading, flattening, filtering, leaderboard building, and Discord rendering. One module, two responsibilities.

**Decision:** Rendering (`buildStatsEmbeds`, `buildLeaderboardEmbed`) moved to `utils/statEmbeds.ts`. `statUtils.ts` is pure data with no Discord imports, which is also what makes it trivially testable.

---

## `getRootDir()` as the single project-root resolver

`findProjectRoot()` in `config.ts` and `getRootDir()` in `utils/utils.ts` were algorithmically identical. The former was deleted; everything imports `getRootDir()`.

---

## `RconClient` extracted from `ServerInstance`

**Problem:** `ServerInstance` mixed the RCON wire protocol (sockets, packet encoding, auth) with game logic (TPS, player lists, seeds). The protocol could not be unit-tested without a real socket.

**Decision:** `rcon/RconClient.ts` owns everything protocol-level; `ServerInstance` composes it. Key invariant: `RconClient` imports only `net` and the logger. Tests inject a mock socket for the client and a mock client for the instance.

---

## Guild router: `resolveServer(interaction)`

**Problem:** ~12 commands duplicated the explicit-option-or-guild-default resolution block.

**Decision:** One function in `utils/guildRouter.ts`; all commands call exactly it. Resolution order: explicit `server` option → guild `defaultServer` → first registered instance → throw. `tryResolveServer` returns null for callers (autocomplete) that handle absence themselves.

---

## `serverAccess.ts` as the local/remote seam

**Problem:** Supporting remote Minecraft hosts (and Docker, which is "remote" from the filesystem's perspective) would otherwise have meant `if (remote)` branches scattered across every feature.

**Decision:** A single routing module. Every filesystem/shell/HTTP operation for server data is a thin function there: `apiUrl` set → HTTP call to the wrapper, otherwise the unchanged local logic. Callers (stats, whitelist, backups, mods, scripts, log tailing) are identical for local and remote instances. `LogWatcher` and `RemoteLogWatcher` share the `ILogWatcher` interface for the same reason.

**Trade-off:** The wrapper's HTTP API is a second contract to keep in sync (instance IDs, route shapes). Timeouts on every call (8 s GET, 30 s POST) keep a hung wrapper from stalling the bot.

---

## Duplicate coordinate/dimension parsing removed

`playerUtils.ts` had its own NBT-parsing regexes for coordinates and dimension; `ServerInstance` had the authoritative ones. The `playerUtils` versions now delegate. The coordinate regex lives in exactly one place: `ServerInstance.getPlayerCoords`.

---

## `loadAllStats()` TTL cache

**Problem:** Every `/leaderboard` triggered a full `readdir` plus N file reads; bursts made that redundant work.

**Decision:** 30-second in-memory TTL cache per server, invalidated explicitly after snapshots and stat deletion.

**Trade-off:** Leaderboards can lag reality by up to 30 seconds. Acceptable for a public leaderboard; lower `ALL_STATS_TTL_MS` if not.

---

## Self-provisioning status channels

**Problem:** The status embed originally required a configured channel ID; users got it wrong constantly (wrong ID, missing permissions, deleted channels).

**Decision:** The bot owns its display surface: it creates a private category, a text channel for the embed, and a voice channel as a player counter, persists the IDs, and re-creates anything deleted. Config shrank to a single `enabled` flag. Voice channel as counter because voice channel names allow unicode/emoji/spaces; renames are skipped when the count is unchanged because Discord allows only 2 renames per channel per 10 minutes.

---

## Timezone-safe scheduling in `utils/time.ts`

**Problem:** Daily tasks scheduled with `setInterval(86_400_000)` drift an hour across DST transitions, and `new Date(y, m, d)` uses the system timezone, which differs from the configured `TZ` in containers.

**Decision:** All wall-clock math goes through `utils/time.ts`, built only on `Intl` APIs with the `TZ` env var. `nextMidnightEpoch()` recomputes the delay after every run instead of using a fixed interval.

---

## Log watcher read cap (`MAX_DELTA_BYTES`)

**Problem:** If the bot is down while the server keeps logging, the next read could be hundreds of MB, spiking heap and stalling the event loop.

**Decision:** Each poll cycle reads at most 1 MB of new log data; the rest is consumed across subsequent cycles. Mirrors the same guard in the API wrapper's log streamer.

---

## Secure link codes

**Problem:** The original `Math.random()` link codes were brute-forceable within the 5-minute expiry window by spamming `!link` guesses in chat.

**Decision:** `crypto.randomBytes(4)` hex codes (4 billion combinations) plus a 3-second per-player cooldown on `!link` attempts.

---

## Source layout: `src/bot` / `src/common` / `src/web`

**Problem:** The dashboard must run as a separate process but share the config service, server access, and stores — without ever pulling discord.js into the web process or letting web code call into the running bot.

**Decision:** Three layers enforced by ESLint boundary rules: `src/common` (process-agnostic; imports neither sibling), `src/bot` (Discord process), `src/web` (dashboard; may import common only). `applyConfig` was split out of the config service into `src/bot/utils/applyConfig.ts` because applying touches the live Discord client — the web side only ever *writes* config (`configService.writeConfig`) and lets the bot's fs-watcher pick it up. A few `src/common/types` files import discord.js **types only** (`import type`), which is safe: type-only imports are erased at compile time, so the web bundle never loads discord.js.

---

## Per-guild locale via AsyncLocalStorage

**Problem:** `guilds.<id>.language` must localize ~150 existing `t()` call sites, many of them in layers that are deliberately Discord-agnostic (statUtils, stores) — threading a `guildId` parameter through all of them would couple those layers to Discord.

**Decision:** An ambient guild context in `AsyncLocalStorage`, entered once per slash command (withErrorHandling) and per guild in every broadcast loop (`notifyGuilds`, alert monitors). `t()` consults context → global language → en; an explicit `guildId` argument always wins. In-game strings and DMs deliberately stay on the global language: one server instance can serve several guilds, so there is no single correct guild to borrow a locale from.

---

## Dashboard frontend: Vue 3 (Options API) + Vite, isolated subproject

**Problem:** The plan doc left the frontend framework open (SvelteKit vs. lighter). Requirements: easy to extend, zero interference with the bot's toolchain, slim runtime.

**Decision:** Vue 3 with the Options API (maintainer's strongest stack) built by Vite as a small SPA — no SSR, no adapter, Fastify stays the only runtime and serves `dist/web/frontend` statically. The frontend is a self-contained subproject (`src/web/frontend/` with its own package.json and tsconfig) excluded from the root tsconfig/ESLint/vitest, so the bot's strict-TS build never sees `.vue` files. SvelteKit was rejected because it brings its own server; with `adapter-static` it degrades to "just a compiler", at which point Vite+SPA is the simpler shape.

---

## Dashboard auth: hand-rolled OAuth2 + HMAC cookies, user-ID admin gate

**Problem:** The dashboard needs login, but every auth dependency is attack surface in a tool that can restart servers.

**Decision:** The Discord OAuth2 identify flow is three fetch calls; sessions are stateless HMAC-signed cookies (`WEBUI_SESSION_SECRET`), and the admin list is re-checked on **every request** so removal from `adminUsers` locks out immediately. Only user-ID entries qualify — resolving role entries would need guild member fetches with a bot token, so roles stay a Discord-side permission (documented in permissions.md).

---

## Bot liveness for the dashboard: heartbeat file

**Problem:** The dashboard is a separate process and must show whether the bot is alive without holding a connection to it.

**Decision:** The bot overwrites `data/runtime.json` every ~60 s; the dashboard treats a timestamp older than 150 s as down. File-based because both processes already share the data directory — a socket or HTTP channel would add a failure mode for a single boolean.

---

## defineCommand: optional last argument (`"name?"`)

**Problem:** `!waypoints [category]` needs an argument that may be omitted; defineCommand only knew required tokens and the greedy `"name..."` form.

**Decision:** A `"name?"` suffix mirroring the greedy extension: optional, last-position-only (anything else is ambiguous), regex `(?:\s+(\S+))?`, handler receives `undefined` when omitted. Handler arg maps are now typed `Record<string, string | undefined>`, which matches how handlers already treated them under `noUncheckedIndexedAccess`.

---

## Milestone announcements: silent first-pass seeding

**Problem:** Enabling milestones on an established server would announce every veteran's entire history at once — dozens of pings that mean nothing.

**Decision:** The first pass per server+stat records current values as already-announced without posting, so announcements begin with the next real crossing. A per-pass cap (10) additionally bounds the blast radius of any config change.

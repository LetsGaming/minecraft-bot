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

*(Superseded in v4.0 by the npm-workspaces entry below — same boundaries, now structural.)*

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

---

## Scoped command policy: dispatch-time enforcement + manifest file

**Problem:** Command settings (`enabled`, `adminOnly`, future fields) must work per guild for slash commands and per server for in-game commands, stay hot-reloadable, and be editable from the dashboard — which runs in a process that cannot see the command registry.

**Decision:** One resolver (`common/utils/commandPolicy.ts`) merges defaults ← global `commands` ← scope override **field-by-field**, so new fields inherit the scoped fallback for free. Enforcement moved from registration time to dispatch time (bot/index.ts for slash, defineCommand for in-game), reading `loadConfig()` live; registration only skips a command disabled in **every** scope (`commandEnabledAnywhere`), because a globally-disabled-but-guild-enabled command must stay registered to be dispatchable. Two rules the config deliberately cannot express: `adminOnly: false` never bypasses a built-in `requireServerAdmin` wrapper, and in-game `adminOnly` resolves the player's linked account against the **global** admin list only (game chat has no guild context). For the dashboard, the bot writes `data/commandManifest.json` at startup (all discovered commands, including disabled ones — they must be listable to be re-enabled), same file-based pattern as the runtime heartbeat; `GET /api/commands` combines manifest, raw overrides, and effective policies per scope.

---

## v4.0: npm workspaces — the layout finally tells the truth

**Problem:** The dependency graph was already right (`src/common` imported neither `src/bot` nor `src/web`; both imported common), but the folder taxonomy said something else: the web *backend* sat as a bot-sibling under `src/`, while the web *frontend* dangled as a foreign nested npm subproject with its own lockfile and its own `npm ci`. Nothing in the toolchain enforced the boundaries; one convenient relative import could silently drag `discord.js` into the web process.

**Decision:** Four npm workspaces mirroring the product hierarchy — living under `src/`, because this repo's convention is that code lives in `src/` and a build-tooling change is not allowed to overrule a project convention:

```
src/
├── bot/       @mcbot/bot     the product
├── web/       @mcbot/web     ONE package = the whole optional extension
│   ├── backend/  frontend/     (inherently one unit: one version, one build, one artifact)
├── core/      @mcbot/core    process-agnostic core (config, data layer, server access, RCON)
└── schema/    @mcbot/schema  isomorphic contracts (config types, web API DTOs) —
                              the only package the browser bundles
```

Each workspace carries its own `package.json`/`tsconfig.json` with sources directly inside (no nested `src/src/`), which makes the tree read almost exactly like the 3.x layout it replaces — `src/web` even keeps its historical name. One consequence is structural, not stylistic: build output lives *inside* each package (`src/bot/dist`, `src/web/dist/{backend,frontend}`, …) because a package's `exports` map cannot point outside its own directory.

npm workspaces over pnpm deliberately: native to the toolchain we already run, a single root lockfile, one `npm ci`, `--workspace` flags for scoped installs — and none of the CI/CD friction a second package manager brings. What pnpm would have added (strict hoisting, deploy pruning) matters little with two runtime dependencies; the ESLint boundary rules are the guard that actually bites.

**Consequences that are features, not accidents:**

- `discord.js` lives only in `src/bot/package.json`; `vite`/`vue` only in `src/web`. `npm ci --omit=dev --workspace=@mcbot/web` provisions a dashboard environment that could not import the bot even by accident — the Docker `web` target contains zero bot code.
- Subpath imports use the `"./*.js"` exports pattern (`@mcbot/core/utils/logger.js` → `dist/utils/logger.js`). The naive `"./*"` pattern silently mis-mapped `.js`-suffixed specifiers to `dist/<name>.js.d.ts`, degrading every imported type to `unknown` — if types ever collapse like that again, check the exports map first.
- One version for the whole repo: a release tag describes the bot *and* its dashboard. The extension stays one opt-in away at every layer (`webui.enabled`, compose `--profile web`, `pm2 --only minecraft-bot-web`) while both processes remain fully sovereign at runtime.

---

## v4.0: SQLite for machine-written state (better-sqlite3, with a driver seam)

**Problem:** The `saveJson()` mutex entry above overclaims. The promise chain serializes *writes* to a file — it never made *read-modify-write* atomic, so two concurrent `/link` completions in one process could still lose an update between the read and the queued write. Worse, once the dashboard became a second process, the per-process `writeLocks` map guarded nothing at all: `data/adminAudit.json` was appended from both processes, and a dashboard action racing a bot action silently dropped an audit entry.

**Decision:** Machine-written state moves to SQLite; the ownership rule in [data-storage.md](data-storage.md) decides the medium from now on (human-authored + machine-read → JSON; machine-written → `data/bot.db`). WAL journal + `busy_timeout` make the two-process case safe; `withTransaction()` (BEGIN IMMEDIATE) makes read-modify-write one unit. First movers: `admin_audit` (the cross-process race), `whitelist_audit`, `linked_accounts` + `link_codes` (the in-process race — the whole confirm flow is now a single transaction, and the module-level code cache in the in-game `!link` handler is gone).

**Driver: better-sqlite3, by maintainer decision.** The zero-dependency `node:sqlite` route was on the table; the call was that better-sqlite3's maturity and performance are worth the one new dependency. It ships as the default behind a ~50-line seam (`src/core/db/driver.ts`): the stores speak a four-method interface both drivers satisfy identically — same SQL, same synchronous semantics, same transaction behavior. `MCBOT_SQLITE_DRIVER=node` selects the built-in `node:sqlite` instead, the documented escape hatch for hosts without a compile toolchain (needs Node ≥ 22.13; the default keeps `engines >= 20`). The one cost better-sqlite3 carries — native compilation on Alpine/musl — lives in the Dockerfile's dependency stages, not in user-facing steps. Two field notes encoded in the code: better-sqlite3 v12 loads its native binding **at construction, not at require**, so availability probes must open a real database; and no ORM — at ten-ish tables of trivial CRUD, raw SQL behind typed store functions is the more reviewable artifact. If a query builder ever earns its place, the swap is contained in `src/core/db/`.

**Migration contract:** both processes run idempotent schema migrations at boot (whoever starts first — or alone — has a current schema; neither requires the other). Legacy JSON imports once, inside the same transaction that checks the table is empty, then the source renames to `*.imported` — never deleted. Upgrading stays "pull and start".

---

## v4.0: dashboard config writes use optimistic concurrency

**Problem:** `PUT /api/config` was last-write-wins. Two dashboard admins editing simultaneously — or one admin racing the bot's own config write — clobbered each other with no warning, on the one file where a silent loss hurts most.

**Decision:** `GET /api/config` returns `{ hash, config }` where `hash` is the sha256 of the raw on-disk bytes; `PUT` requires `{ baseHash, config }` and answers **409** (with the current hash) when the file changed underneath the editor. The frontend surfaces the conflict and reloads its baseline. A content hash, not a version counter, so hand edits and bot writes — which know nothing about the scheme — invalidate stale editors exactly the same way.

---

## v4.0: the ownership rule, applied to completion

**Problem:** After the first movers (audit + links), a dozen machine-written JSON stores remained — every one a read-modify-write on a shared file, every one invisible to the second process's locks, and two of them actively expensive: the uptime tracker rewrote a 43,200-entry array every flush, the player-count sampler rewrote its whole store for every 60-second status pass.

**Decision:** *Every* machine-written store moves to `data/bot.db`; only files an admin edits by hand stay JSON. Three shapes emerged:

- **Versioned-blob stores → `kv_store`** (watches, playerNotes, waypoints, sessions, challenges, polls, claimedDaily, pendingRewards, plus the bot's watcher states: statusMessages, leaderboardSchedule, updateNotifier, consoleRelay, milestones, whitelistApplications). These share one pattern — a small typed document loaded whole, mutated by pure helpers, saved whole — which survives unchanged; only the medium moved. Keys are the legacy filename stems, so `bot.db` reads like the old `data/` listing. `kvUpdate()` gives the read-modify-write atomicity the file mutex never had; `takeMatchingWatches` uses it so a one-shot watch can never DM twice.
- **Time series → real tables.** `uptime_checks` (one INSERT per check, retention by DELETE) and `player_count_hours` (one UPSERT per sample). The public APIs are unchanged; `flushUptimeHistory`/`startUptimeFlushScheduler` remain as no-op compatibility shims because writes are immediate now.
- **Snapshots → `snapshots(server_id, ts, payload)`.** The key the per-server directories encoded in paths — and the one the original flat files got wrong across servers — is now the primary key. The retention policy (31-day cap, latest-per-day thinning, never delete the newest) transferred verbatim. `migrateLegacySnapshots` became a file→table importer covering both historical layouts and retires the directory as `snapshots.imported`.

**Deliberate exceptions:** `dailyRewards.json` (hand-edited — the rule's other half), `config*.json`, and two *process contract files* that are not stores: `runtime.json` (the liveness beacon must stay readable with `cat` when everything else is broken) and `commandManifest.json` (regenerated every boot; a handoff artifact, not state).

**A lesson the sandbox caught before production could:** the legacy importer runs *inside* `getDb()` initialization — it must not call the public kv API, whose connection resolution re-enters `getDb()`. First boot on any deployment with a `sessions.json` recursed to stack overflow. The importer now carries its own raw helpers on the handle it was given; the boundary is documented in `importLegacy.ts`. Related guard from the same incident: the import (which *retires* its source files) never runs against a `:memory:` database — destroying durable files to feed an ephemeral store is exactly backwards, and tests run on `:memory:`.


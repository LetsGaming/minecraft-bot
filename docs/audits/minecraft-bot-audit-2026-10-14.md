# minecraft-bot: project audit

- **Date:** 2026-10-14
- **Commit:** `cbad78c` (main)
- **Type:** Audit only. No project files were changed.

## 1. Executive summary

The codebase is careful overall. It typechecks, lints, and passes all 2933 tests. It has a declared-capability gate that refuses to boot if a route has no rule, signed OAuth state, HMAC sessions, no XSS sinks, atomic config writes, and solid migrations. The serious problems are not in those well-guarded paths. They sit at **trust boundaries the design treats as narrower than they are**:

**Top risks**

1. **A guild manager can make themselves a bot admin and reach other tenants' servers** (AUD-001). The dashboard's guild-config PUT accepts any guild block, including `adminUsers` and `allowedServers`. Anyone with Manage Guild on a guild the bot is in can therefore grant themselves Discord admin commands (`/server stop`, `/whitelist`, `/ban`, console, …) against any server.
2. **Player identity in in-game chat can be spoofed** (AUD-002). The regexes that parse chat for `!commands` and for the bridge are unanchored. A player can type text, or a Discord user can send it through the bridge, that makes the bot treat the message as coming from a different player. That defeats `adminOnly` in-game commands and `!link`, and lets one person cast votes as other players.
3. **Rollback, which is irreversible, needs only `server:control`** (AUD-003). The `server:rollback` capability is declared, but no route enforces it.
4. **Dashboard "prune stats" can delete every player's stats** when the whitelist and usercache reads fail (AUD-004). Read failures are turned into empty lists, and an empty list means "every UUID is unknown".

**Recurring weakness.** Several stores read a whole JSON blob from SQLite, modify it, `await` network I/O, and then write the whole blob back. Daily claims, pending rewards, whitelist applications and `config.json` writes all do this. Concurrent users then overwrite each other's changes, which shows up as double daily claims and duplicated or lost rewards (AUD-005, AUD-014). A transactional `kvUpdate` helper already exists, but these paths don't use it.

**Main limitation.** The Minecraft API wrapper (a separate repository) was not audited. Findings that depend on how it behaves are marked that way. No live Discord or Minecraft environment was used.

**Finding counts:** Critical 0 · High 4 · Medium 12 · Low 17 · Informational 4.

## 2. Audit scope and method

- **Scope:** the whole repository, with effort weighted by risk:
  - dashboard authN/authZ and every Fastify route
  - the wrapper HTTP client
  - config load/validate/write
  - the SQLite layer and migrations
  - bot commands, interactions, log watchers and schedulers
  - the Vue frontend (state and XSS)
  - Docker, entrypoint, compose and GitHub workflows
  - dev scripts
  - test suite gaps
- **Context assumed (from the interview):** the dashboard runs on a private LAN, users log in with Discord OAuth and are scoped per guild, and non-sysadmins must not reach servers or guilds they don't control. The deployment may serve more than one Discord guild.
- **Method:** static review first. Five parallel read-only reviews (auth, routes/IO, data layer, bot, frontend/deploy/tests) produced candidate findings.
  - I then re-checked the High and most Medium findings myself in the source.
  - The chat-regex spoofing claims were reproduced in `node` against sample log lines.
  - Findings I did not re-check myself are marked "strongly supported (traced, not independently re-checked)".
- **Checks run (with their actual results):** see §4.

## 3. Findings

### [HIGH] AUD-001: Guild managers can grant themselves bot-admin and widen their guild's server scope

**Location:** `src/web/backend/routes/guildConfig.ts:108-186`, with the splice at about line 153; `src/web/backend/routes/schemas.ts:167-170` (`guildConfig: AnyObject`). Consumed by `src/bot/commands/middleware.ts:43-44` (`isServerAdmin`) and `src/core/utils/server/guildTargets.ts:52-72` (`getAllowedServerIds`).

**Evidence**

- `PUT /api/guilds/:id/config` checks `canManageGuild` and then writes the submitted block as-is. `validateCandidate` reports an unknown `allowedServers` id only as a warning.
- `isServerAdmin` treats `guilds[guildId].adminUsers` (user or role IDs) as admins for that guild.
- `getAllowedServerIds` takes the guild's own `allowedServers` (or the servers its config references) as the list of servers that guild may target. With a single guild configured it applies no restriction at all.
- The config is reloaded live.

**What an attacker can do**

- A Manage Guild holder submits `adminUsers: [<self or @everyone role>]` and `allowedServers: [<any server id>]`. They then run admin slash commands against that server.
- This contradicts `docs/admin/permissions.md:63` ("You can edit that guild's config block and nothing else. You never see the Minecraft host") and `docs/admin/configuration.md:230` (tenant isolation).
- **Preconditions:** Manage Guild on any guild the bot is in. In a single-guild deployment that means anyone with Manage Guild becomes a full bot admin.
- **Related:** `routes/auth.ts:76-82` fails open. If `listBotGuilds()` throws, the session keeps every guild the user manages, including guilds the bot is not in. Writing a block for such a guild flips the deployment into multi-guild mode and changes routing for the real guild.

**Remediation**

- For non-sysadmins, make `adminUsers`, `allowedServers` and every server reference sysadmin-only:
  - preserve their current values on write; or
  - require every referenced server to already be in the operator-set `allowedServers`.
- Treat an unknown server id as an error, not a warning, on this path.
- On login, fail closed (`guildIds = []`) when bot guilds can't be listed.
- Add route tests that pin this behavior.

**Confidence:** Verified by reading the web write path and the bot consumers. The live Discord command was not exercised.

### [HIGH] AUD-002: Unanchored chat parsing lets players impersonate others for in-game commands and the chat bridge

**Location:**
- `src/bot/logWatcher/defineCommand.ts:127-129` (in-game `!command` regex)
- `src/bot/logWatcher/watchers/log/chatBridge.ts:22` (`CHAT_REGEX`)
- `src/bot/logWatcher/watchers/log/sleepWatcher.ts:9`
- Discord→MC relay: `chatBridge.ts:~417-421` and `core/utils/minecraft/serverMessages.ts` (`/say`)

**Evidence**

The pattern `\[.+?\]: <([^>]+)> …` has no start anchor, and its lazy `.+?` lets the engine skip past the real speaker. I checked these lines in node:

| Log line | Parsed as |
|---|---|
| `…/INFO]: <Mallory> x]: <Admin> !link 123456` | command regex → user `Admin`, `!link 123456` |
| `…/INFO]: * Mallory x]: <Admin> !vote 2` (`/me`, available to any player) | user `Admin` |
| `…/INFO]: [Server] [Bob] x]: <AdminGuy> !link 9` (a Discord message relayed through `/say`; `<`/`>` are not escaped) | user `AdminGuy` |
| `…/INFO]: [Not Secure] <Mallory> x]: <Admin> I resign` | bridge regex → `Admin: I resign` |

**Consequences**

- **`adminOnly` in-game commands** (`defineCommand.ts:182-193`) pass for anyone who names an admin's linked MC account.
- **`!link CODE`** can bind the attacker's Discord account to someone else's MC name.
- **`!vote`** can be cast under any number of fake names.
- **`!waypoint set`** stores the victim's coordinates, and the attacker can then read them.
- **The bridge (webhook mode)** posts messages to Discord under the victim's name and head.
- **sleepWatcher** puts the last `<…>` from player text into `/data get entity ${player}` without checking it is a valid name, so a player can inject a selector.
- The comment at `serverLine.ts:33-35` claims chat watchers "already anchor"; they don't.

**Remediation**

- Use one shared anchored chat regex that requires the line prefix, an optional `[Not Secure] `, and a strictly valid name (`[A-Za-z0-9_]{1,16}`). Match `!cmd` only within the captured message.
- Run `isValidMcName` before any interpolation into a console command.
- On Discord→MC, use `tellraw` with a JSON text component instead of `/say`. That also removes selector expansion and the stray-backslash escaping.

**Confidence:** Verified (regex behaviour reproduced in node; call sites read). The exact log prefix may vary by server software, but the attack does not depend on it.

### [HIGH] AUD-003: Irreversible world rollback is gated by `server:control`, not `server:rollback`

**Location:** `src/web/backend/routes/servers.ts:80-135` (`capability: "server:control"` at line 84); `src/schema/serverActions.ts:28-34` (`"rollback"` is in `SERVER_OPERATOR_ACTIONS`).

**Evidence**

- No route declares `server:rollback`. It appears only in `src/schema/capabilities.ts` and the docs.
- `docs/admin/capabilities.md` presents `server:control` as safe to hand out and lists rollback as a separate, irreversible capability.
- A user granted only `server:control` can `POST /api/servers/<id>/rollback`, which replaces the world from a snapshot.

**Remediation:** Require `server:rollback` when `action === "rollback"`. Better, move rollback to its own route that declares that capability. Add a test.

**Confidence:** Verified.

### [HIGH] AUD-004: Dashboard prune-stats deletes every player's stats when the whitelist and usercache reads fail

**Location:** `src/web/backend/routes/servers.ts:~165-205`; `src/core/utils/server/access/players.ts:25-38` (`readUserCache` swallows every error).

**Evidence**

- The route runs `readWhitelist(...).catch(() => [])` and `readUserCache` (which returns `[]` on any error), then `prunable = uuids.filter(u => !known.has(u))`.
- If `/stats` succeeds while both name sources fail (429, timeout, open breaker, older wrapper), `known` is empty and every stats file is deleted.
- The non-dry-run call recomputes the list, so what it deletes is not the list the operator reviewed in the dry run.
- The Discord command refuses when the whitelist is empty (`src/bot/commands/server/control.ts:~360`). The dashboard has no such guard.

**Consequence:** Stats and leaderboard data for all players is permanently lost. The only recovery is a server backup.

**Remediation**

- Propagate name-source errors.
- Refuse when both sources are empty, or when `prunable` is a large share of `uuids`.
- Have apply take the exact UUID list from the dry run and delete only its intersection with the current list.

**Confidence:** Verified by reading. Not reproduced against a wrapper.

### [MEDIUM] AUD-005: Whole-blob read-modify-write across awaits loses updates (daily claims, pending rewards, whitelist applications)

**Location:**
- `src/bot/commands/connection/daily/daily.ts`: load at about line 105, awaits (online check, RCON `give`), whole-store save at about line 197.
- `src/bot/logWatcher/watchers/schedulers/dailyReminderScheduler.ts:35/56/76`
- `src/core/utils/minecraft/rewards.ts:155-177`, called fire-and-forget from `joinLeave.ts:57`
- `src/bot/interactions/whitelistApplications.ts:336-386, 446-490`
- `src/core/utils/stores/dailyStore.ts:173-177, 229` (`kvSet`; `kvUpdate` exists but is unused here)

**Evidence**

`claimLock` is per user only. Two users claiming at once, or a reminder pass that DMs users one by one between its load and its save, write stale snapshots back. The effect:

- **Daily claims:** one user's claim is reverted, so that user can claim again (double reward).
- **Pending rewards:** two joins at about the same time redeliver items or drop queued ones.
- **Whitelist applications:** an approved application can be written back to `pending`, and `MAX_PENDING_PER_USER=1` then blocks that user.

**Remediation:** Never hold a whole-blob snapshot across an `await`. Either re-read and merge only the touched key inside `kvUpdate`/`withTransaction` at save time, or move claims and queues to keyed rows with conditional updates (`UPDATE … WHERE last_claim < ?`). For rewards, dequeue atomically before calling `give` and re-queue failures.

**Confidence:** Verified (code read). Not reproduced under load.

### [MEDIUM] AUD-006: A failed `BEGIN IMMEDIATE` permanently disables every transaction in the process

**Location:** `src/core/db/index.ts:97-119`.

**Evidence**

- `inTransaction = true` is set before `db.exec("BEGIN IMMEDIATE")`, and that call sits outside the `try` whose `finally` resets the flag.
- `SQLITE_BUSY` after `busy_timeout` (5 s) leaves the flag set, so every later `withTransaction`/`kvUpdate` throws "nested transactions are not supported" until the process restarts.
- Realistic triggers: the other process running a VACUUM on start, a large legacy import, or a slow volume. The bot and the dashboard share the DB file.

**Remediation:** Set the flag only after `BEGIN` succeeds, or move `BEGIN` inside the `try`.

**Confidence:** Verified.

### [MEDIUM] AUD-007: A failed config reload drops the cached config, so every later read fails

**Location:** `src/core/config.ts:305-308` (`reloadConfig` sets `_config = null` before `loadConfig()`); watcher at `:345-360`.

**Evidence**

- The watcher comment says "the old config stays active", but the cache is already cleared when `loadConfig` throws.
- Every later `loadConfig()` call, in both processes and from many call sites, re-reads the bad file and throws. Commands and routes fail until the file is fixed. `/config reload` behaves the same way.

**Remediation:** Load into a local variable and assign `_config` only on success.

**Confidence:** Verified.

### [MEDIUM] AUD-008: An interaction-handler rejection crashes the bot process

**Location:**
- `src/bot/index.ts:322` (async `interactionCreate` listener with no outer try)
- `:348` (`autocomplete.respond` with no catch)
- `:361-366` (the `catch` awaits `respond([])` again)
- `src/bot/processGuards.ts:33` (`unhandledRejection` → exit)

**Evidence**

- A slow player autocomplete (wrapper GET timeout of up to 8 s) misses Discord's 3 s window. `respond` throws "Unknown interaction", and the fallback `respond([])` throws again.
- The listener's promise rejects with no handler, and the process guard exits.
- Compose restarts the bot (`restart: unless-stopped`), but every in-flight operation is lost and any user can trigger the crash repeatedly while the wrapper is slow.

**Remediation:** Wrap the bodies of the `interactionCreate`/`messageCreate` listeners, and `.catch(() => {})` on the `respond`/`reply` calls in fallback paths.

**Confidence:** Strongly supported. The code path was verified; the claim that discord.js does not capture async listener rejections comes from the review and was not re-checked against the installed version.

### [MEDIUM] AUD-009: `config:read`/`config:write` expose and allow editing `server.properties`, including RCON settings

**Location:** `src/web/backend/routes/modConfigs.ts:~222-231` and its write path; `docs/admin/mod-configs.md:7` (the wrapper lists `server.properties`); `docs/admin/capabilities.md` (pitched as a mod-tuning capability).

**Evidence**

- No redaction or key restriction exists in the routes or in `configfmt`.
- A holder can read `rcon.password`, and with write access can change `enable-rcon`, `rcon.password`, `op-permission-level`, `enable-command-block` and similar.
- That bypasses `server:console`, the console deny-list and the audit log wherever the RCON port is reachable. Plugin and mod configs holding secrets are exposed the same way.

**Remediation**

- Exclude `server.properties` (and known secret-bearing files) unless the user holds a stronger capability; or
- redact secret keys and make privilege-granting keys read-only.

**Confidence:** Assumption-dependent. It relies on the wrapper's file listing, which is documented but was not inspected.

### [MEDIUM] AUD-010: The console deny-list can be bypassed with namespaced commands

**Location:** `src/schema/consoleCommands.ts:43-62` (matches the first word only; default list `stop`, `op`, `deop`); enforced in `src/web/backend/routes/console.ts`.

**Evidence:** `minecraft:op <name>` and `minecraft:stop` have the verb `minecraft:op`/`minecraft:stop`, which don't match, so a `server:console` holder can op themselves. `execute … run op …` also gets through.

**Remediation:** Strip a `namespace:` prefix before matching, and inspect `execute … run <cmd>` recursively. Document that the deny-list is advisory if it can't be complete.

**Confidence:** Code path verified. That vanilla accepts `minecraft:`-prefixed aliases is well established but was not tested here.

### [MEDIUM] AUD-011: Backups view can act on the wrong server after a fast server switch

**Location:** `src/web/frontend/src/composables/useBackups.ts:67-70` (`if (loading.value) return;` runs before `serverId = id`) and the URL builders at `:128-178`; `src/web/frontend/src/views/BackupsView.vue:478-503`.

**Evidence**

- Switching servers while the previous list request is still in flight drops `load(B)`.
- The header, the confirmation dialog and the typed confirmation name all say B, but the file list and module-level `serverId` are still A.
- So delete, restore and download hit A. The "server must be offline" check for restore was evaluated against B.
- `ModsView` already guards against this (`ModsView.vue:~894`); this view does not.

**Remediation:** Use a request-generation token instead of the early return, update `serverId` on every call, and pass the server explicitly to `restore`/`remove`, asserting it matches.

**Confidence:** Verified by reading. Not reproduced in a browser.

### [MEDIUM] AUD-012: Dashboard reports a still-running or rejected script as "did not run" and offers a retry

**Location:** `src/web/backend/routes/servers.ts:119-132`; the restore path in `src/web/backend/routes/backups.ts:~218-232`; `src/core/utils/server/access/scripts.ts:32-33` (`ScriptStillRunningError`).

**Evidence**

- Every error, including a timeout while the script keeps running and an `ApiError` where the wrapper did answer, is recorded as an intent and reported as "The wrapper did not answer, so X did not run". The dashboard then offers a one-click retry.
- A long backup, restart or restore can therefore be started twice.
- The bot handles this case correctly (`control.ts:~188`).

**Remediation:** Catch `ScriptStillRunningError` and timeouts separately and return "still running" without recording an intent. Map `ApiError` statuses honestly.

**Confidence:** Strongly supported (traced, not independently re-checked).

### [MEDIUM] AUD-013: Queued (offline) mod-config edits skip the etag, editable and parse-warning checks, and one bad file aborts the flush

**Location:** `src/web/backend/routes/modConfigs.ts:~110-146` (`queueFromCache`, called at about line 323) compared with the direct save at about lines 339-355; `src/core/utils/wrapper/queueFlush.ts:~94-115`.

**Evidence**

- When the wrapper is unreachable, the edit is queued against the cached copy without checking `req.body.etag`, so an editor working from an older copy silently overwrites a newer change.
- Files marked read-only or with parse warnings are queued anyway.
- At flush time, a `ConfigAccessError` thrown inside the loop aborts the remaining files, and the manual flush route returns 500.

**Remediation**

- Queue only when the etag matches the cache.
- Apply the same `editable`/`warning` checks and a dry `applyConfigEdits` before queueing, and again at flush.
- Wrap each file in the flush in its own try/catch.

**Confidence:** Strongly supported (traced, not independently re-checked).

### [MEDIUM] AUD-014: Concurrent `config.json` writes from the dashboard lose updates

**Location:** `src/web/backend/routes/config.ts:~186-209`; `src/web/backend/routes/guildConfig.ts:133-164`; `src/core/utils/config/configService.ts:~76-140` (`writeConfig` awaits before the rename); the rollback route has no base-hash check.

**Evidence**

- The hash check is synchronous, then `await writeConfig`, with nothing serializing the writes.
- Two managers saving *different* guilds at about the same time each build their write from the same `current`. The second rename reverts the first guild's change, and no 409 is returned because each request only checks its own block's hash.

**Remediation:** Put an in-process async mutex around read → merge → validate → write, and re-check the expected hash inside it just before the rename.

**Confidence:** Verified by reading.

### [MEDIUM] AUD-015: Chat-bridge webhook failures drop messages, with no fallback to the embed form

**Location:** `src/bot/logWatcher/watchers/log/chatBridge.ts:340-362` (`hook.send` is not caught; `webhookCache` is never invalidated).

**Evidence**

- The doc comment promises a fallback to the embed form, but the code returns or throws after a webhook failure.
- A deleted webhook (10015) silences the channel until a reload.
- Discord rejects webhook usernames containing "discord" or "clyde", so those players' messages never arrive.

**Remediation:** Wrap `hook.send` in try/catch, fall back to the embed, and evict the cache entry on 10015/404.

**Confidence:** Verified (code read).

### [MEDIUM] AUD-016: In-game `!commands` and the chat bridge ignore `[Not Secure]` chat

**Location:** Same regexes as AUD-002.

**Evidence:** In node, `…/INFO]: [Not Secure] <Steve> hi` matches neither the bridge regex nor the command regex. Players with unsigned chat (offline-mode servers, No Chat Reports clients) get no bridging and no `!commands`.

**Remediation:** Fold this into the shared anchored regex from AUD-002.

**Confidence:** Verified for the regex behaviour. How common unsigned chat is in real deployments is not known.

### [LOW] AUD-017: CSRF protection relies only on `SameSite=Lax`

**Location:** `src/web/backend/auth/auth.ts:~445`. The backend has no Origin, `Sec-Fetch-Site` or token check.

**Evidence**

- SameSite ignores ports and subdomains. A same-site origin can POST with the user's cookie as a `text/plain` form: another service on the same LAN host, or an XSS on a sibling subdomain.
- Bodyless POSTs are reachable this way, including `/api/servers/:id/:action` (restart and rollback) and backup restore.
- Low on a private LAN, but the impact if triggered is high.

**Remediation:** In an `onRequest` hook, reject mutating `/api/*` requests unless `Origin` matches the public base URL or `Sec-Fetch-Site` is `same-origin`.

**Confidence:** Strongly supported (based on Fastify defaults; not executed).

### [LOW] AUD-018: Console view can show the wrong server's stream and leak an EventSource

**Location:** `src/web/frontend/src/composables/useConsole.ts:~89-112`.

**Evidence**

- `open()` closes the current stream, awaits the policy fetch, then assigns `source`. A switch during that await leaves A's stream open, and it writes into the console now labelled B.
- The leaked SSE connection keeps a backend upstream open.

**Remediation:** Add a generation counter and return if it has changed after the await.

**Confidence:** Strongly supported.

### [LOW] AUD-019: Guild managers receive whole-config validation output and file paths

**Location:** `src/web/backend/routes/guildConfig.ts:~159, 175, 186`.

**Evidence:** Errors and warnings cover the entire config (other guilds' ids, every server id) and are returned to non-sysadmins. The write error includes the absolute config path, which goes against the stated rule that paths never reach the browser.

**Remediation:** For non-sysadmins, filter results to the `guilds.<id>.` prefix and return a generic message for write errors.

**Confidence:** Verified (code read).

### [LOW] AUD-020: `/server stop|restart` confirmation can miss Discord's 3 s deadline and misreport online players

**Location:** `src/bot/commands/server/control.ts:~233-262, 434` (`defer: false`); `src/core/utils/server/server.ts:~190-202` (`getList` retries and swallows errors).

**Evidence:** When the wrapper hangs, the confirmation fails with "application did not respond", and because errors become `players: []` the prompt says "nobody online".

**Remediation:** Reply first, then fill in the player count with `editReply`. Surface "unknown" instead of an empty list.

**Confidence:** Strongly supported.

### [LOW] AUD-021: In-game commands enabled by a config reload are never dispatched

**Location:** `src/bot/logWatcher/initMinecraftCommands.ts:~84-117`.

**Evidence:** Watchers copy the handler list once. Commands added after a reload go only to the global list, so the log says "loaded" but the command does nothing until restart.

**Remediation:** Read the global list at dispatch time.

**Confidence:** Strongly supported.

### [LOW] AUD-022: `/daily` with multiple items gives duplicates when a later give fails

**Location:** `daily.ts:~240-249`.

**Evidence:** The gives run in a loop and the claim is persisted only after all succeed. If item 2 fails after item 1 was given, the user retries and receives item 1 again, plus a new roll.

**Remediation:** Persist the claim first and queue undelivered items in `pendingRewards`.

**Confidence:** Verified (code read).

### [LOW] AUD-023: Status embed does not recover from a deleted channel, and orphans embeds on transient errors

**Location:** `src/bot/logWatcher/watchers/schedulers/statusEmbed.ts:~423-433, 491-505`.

**Evidence:** The channel cache is cleared only on `shardResume`. Any fetch error, including a 5xx or rate limit, is treated as "message missing", so a new embed is posted and the old one is left showing a stale status.

**Remediation:** Evict on 10003/10008, and post a new embed only on 10008.

**Confidence:** Strongly supported.

### [LOW] AUD-024: Mod slug and prune dimension allow dot segments that rewrite wrapper URLs

**Location:** `src/web/backend/routes/schemas.ts:~190-193` (slug has no pattern) and `:~300` (`^[a-z0-9_.:-]{1,64}$` allows `..`); `src/core/utils/server/access/mods.ts:71,103,120,132`; `src/core/utils/server/access/prune.ts:101`.

**Evidence:** `encodeURIComponent("..")` leaves it unchanged and WHATWG URL normalises it away. For example, `/instances/s/mods/../update` becomes `/instances/s/update`. A `mods:write` holder can therefore reach other wrapper routes with the mod route's HTTP method.

**Remediation:** Add strict patterns: slug `^[A-Za-z0-9_-]+$`, and no `.`/`..` segments in dimension.

**Confidence:** Assumption-dependent; the impact depends on the wrapper's routes.

### [LOW] AUD-025: Config edit values are not type-checked before splicing

**Location:** `src/web/backend/routes/schemas.ts:~71` (`Type.Unknown()`); `src/core/utils/configfmt/{toml,formats,ini}.ts` literal writers; `configfmt/index.ts:~137-149` (checks structure, not values).

**Evidence:** The string `"false"` is written as `true`, a non-array value empties a TOML list, and `""` becomes `0`. A client bug or a hand-crafted request can corrupt a mod config silently.

**Remediation:** Validate each value against `node.kind`, and after re-parsing assert that the edited values equal what was requested.

**Confidence:** Strongly supported.

### [LOW] AUD-026: `.dockerignore` patterns match only at the context root

**Location:** `.dockerignore`; `Dockerfile:~105-106` (`COPY data/` twice).

**Evidence:** `config.json` and the explicit `data/*` entries don't exclude `data/agent-<id>/config.json` or `bot.db` (dev-up output, which may contain a real token when run with `--real-discord`), or a `data/config.json` from a non-Docker deployment. Release images are built from a clean checkout and are not affected; local `docker compose build` from a working tree is.

**Remediation:** Exclude `data/` with an allow-list (`!data/dailyRewards.json`), and add `**/config.json` and `**/*.db*`.

**Confidence:** Verified (file read; Docker's matching semantics).

### [LOW] AUD-027: Dashboard process has no SIGTERM handling and is PID 1 in its container

**Location:** `docker-entrypoint.sh:~77` (`exec su-exec node`); `src/web/backend/index.ts` (no SIGTERM/SIGINT handler; grep confirmed). The bot has one at `src/bot/index.ts:527-531`.

**Evidence:** `docker stop` waits for the timeout and then SIGKILLs. Fastify, SSE upstreams and the SQLite handle are never closed cleanly.

**Remediation:** Add a shutdown handler (`app.close()`, close the console hub, close the DB), or use `init: true`.

**Confidence:** Verified.

### [LOW] AUD-028: Bot container healthcheck always passes

**Location:** `Dockerfile:~158-161` (`grep -q node /proc/1/cmdline`).

**Evidence:** After the `exec` chain, PID 1 is always node, so a hung or disconnected bot is never reported unhealthy.

**Remediation:** Check how old the runtime heartbeat is (`src/core/utils/server/runtimeHeartbeat.ts`).

**Confidence:** Verified.

### [LOW] AUD-029: Entrypoint `envsubst` without a variable list blanks `$schema` and breaks on special characters

**Location:** `docker-entrypoint.sh:42`; `config.template.json:2`.

**Evidence:** Unrestricted `envsubst` replaces `$schema`, producing a `""` key. Environment values containing `"` or `\` produce invalid JSON.

**Remediation:** Pass an explicit variable list, or generate the config with a small Node script.

**Confidence:** Verified for the template content; envsubst behaviour is well known.

### [LOW] AUD-030: Release workflow grants write tokens to unpinned and third-party code

**Location:** `.github/workflows/release.yml:17-19` (workflow-level `contents: write`, `packages: write`); external wrapper checked out at its default branch and built with `npm ci`; actions pinned by tag only; `persist-credentials` left at its default. `contract.yml:~64` interpolates `${{ inputs.wrapper_ref }}` into shell (only users with write access can trigger it).

**Evidence:** A compromised tag or upstream commit runs with publish rights.

**Remediation:** Split gate and publish jobs, give the gate job read-only permissions, set `persist-credentials: false`, pin actions by SHA, pin the wrapper ref, and pass inputs through `env:`.

**Confidence:** Strongly supported.

### [LOW] AUD-031: `dev-up`/`dev-down` pass an unvalidated `--id` to `rmSync(recursive)`

**Location:** `scripts/dev-up.mjs:104-112`; `scripts/dev-down.mjs:~37-51`; `scripts/lib/parseArgs.mjs:13-14`.

**Evidence**

- `--id "x/../../.."` resolves outside `data/` and is then recursively deleted. That contradicts the repo's agent instructions, which guarantee the scripts only touch `data/agent-<id>/`. The id is typically chosen by an agent.
- A health-check failure exits before `dev-session.json` is written, which leaves orphan processes that `dev-down` can't stop.

**Remediation:** Validate `^[a-z0-9-]+$` in `parseArgs`, and record PIDs as each process is spawned.

**Confidence:** Verified (code read; `path.join` behaviour is deterministic).

### [LOW] AUD-032: Schema-migration bootstrap and legacy import can fail startup

**Location:** `src/core/db/migrations.ts:~258-263` (the `ALTER TABLE … ADD COLUMN checksum` probe runs outside `BEGIN IMMEDIATE`); `src/core/db/importLegacy.ts:~148, 210`.

**Evidence**

- On a pre-checksum database, starting the bot and the dashboard together can race, and one crashes with "duplicate column". It recovers on restart.
- A malformed legacy row (missing `discordId`, or whitelist keys that collide by case) rolls back the import and blocks boot for both processes.
- A downgrade (an applied migration id unknown to this build) is not detected.

**Remediation:** Run the probe inside the transaction, skip and warn on bad import rows, and refuse to start when `max(id)` is greater than the highest known migration.

**Confidence:** Strongly supported.

### [LOW] AUD-033: Lockfile installs vite 8 against a declared `^6` range

**Location:** `src/web/package.json:21,23`; `package-lock.json:~5985` (`src/web/node_modules/vite` 8.2.1).

**Evidence:** `npm ls vite` reports `invalid: "^6.0.5"` and an unmet `@vitejs/plugin-vue@5` peer range (`^5 || ^6`). The frontend still builds; I checked with an out-of-tree build that succeeded. The next `npm install` may re-resolve, so the toolchain a contributor gets is not deterministic.

**Remediation:** Make the declared ranges and the lockfile agree (either bump `vite` and `plugin-vue`, or regenerate the lock).

**Confidence:** Verified.

### Informational

- **Streak display:** `currentStreak` is shown without checking whether it has lapsed (`streakLeaderboard.ts`, `streak.ts`), so stale streaks stay on the board until the user's next claim.
- **Sessions and streams:** sessions are stateless and last 7 days, and logout only clears the cookie. Console streams don't re-check `sessionEpoch`. `/metrics` is open when `WEBUI_METRICS_TOKEN` is unset (it exposes server ids and player counts). There is no per-user limit on console streams and no SSE backpressure (`console.ts:~75-78`).
- **Dev-only advisory:** `npm audit` reports 3 moderate advisories in dev-only `vitest`/`@vitest/mocker` (GHSA-82fw-gwwq-j7x9). `npm audit --omit=dev`: 0.
- **Test gaps on high-risk behaviour:**
  - No route tests for `mods:write` authorization.
  - No tests for guild-config field restrictions (AUD-001) or rollback capability (AUD-003).
  - No tests for frontend server-switch races.
  - No upgrade-path test for migration 6 (`payload_gz`).
  - Tests force the `node:sqlite` driver (`tests/setup.ts:~28`), so the production `better-sqlite3` path is untested.
  - `tests/config/watchConfig.test.ts` relies on fixed-sleep fs-watcher timing.
  - `webBackend.test.ts`'s "complete gated route table" is in fact a hand-picked subset.

## 4. Coverage and limitations

### Inspected adequately

- dashboard auth (OAuth, sessions, capability gate, dev bypass gating) and every backend route's guard
- the guild-config write path
- the wrapper HTTP client (timeouts, breaker, 429 handling)
- backup, mod, mod-config, console, prune and server-action routes
- config load, validate and write
- the SQLite transaction helper and migrations
- daily and reward stores
- bot dispatcher, admin gates, chat bridge, in-game command parsing
- frontend XSS sinks (none found: no `v-html`/`innerHTML`)
- Docker, entrypoint, compose and workflows

### Inspected with limits

- Bot schedulers: `consoleRelay`, `restartScheduler`, `tempBanScheduler`, `leaderboardScheduler`, `channelPurge`, `upgradeMonitor` and `hostResourcesMonitor` were only skimmed.
- kv stores other than daily, rewards and whitelist applications (notes, waypoints, challenges, sessions) were spot-checked; they may share the AUD-005 pattern.
- Not traced fully: `compatGuard`, the analytics and monitoring routes, YAML/forgeCfg parser internals, frontend accessibility, and late responses in PruneView/UpgradeView after a server switch.

### Not inspected

- The Minecraft API wrapper (separate repository): path resolution, operation locking between restore, prune and upgrade, what it accepts as a slug or dimension, and its `server.properties` listing.
- Live Discord and Minecraft behaviour.

### Checks run (actual outcomes)

| Check | Result |
|---|---|
| `npm ci` | succeeded |
| `tsc -b src/bot src/web` | passed |
| `vue-tsc` frontend typecheck | passed |
| `npm run lint` | passed (0 warnings) |
| `schema:check`, `i18n:check`, `layout:check` | in sync / OK |
| `vitest run` | 223 files, 2933 tests passed |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (including dev) | 3 moderate, all in dev-only vitest |
| `npm ls vite` | invalid (AUD-033) |
| Frontend `vite build` into a temp directory | succeeded; temp output deleted |
| Node regex tests for AUD-002/016 | reproduced as described |

**Side effects of these checks:** `node_modules/` and the gitignored `src/*/dist/` build output were created in the working tree. Nothing tracked was modified.

### Not run

- `dev-up.mjs`: not needed, because the findings didn't require a running instance and the bot needs real Discord credentials to exercise slash commands.
- `e2e:*` scripts: they need the external wrapper and sudo.
- Load or concurrency reproduction of AUD-005 and AUD-014.
- A browser reproduction of AUD-011.

### Assumptions that could change conclusions

- **AUD-001:** severity assumes that guild managers are *not* meant to be able to make themselves bot admins. If single-guild operators intend "Manage Guild ⇒ bot admin", the single-tenant part drops to a documentation issue, but the cross-tenant part remains.
- **AUD-009 and AUD-024:** depend on wrapper behaviour.
- **AUD-008:** depends on discord.js not capturing async listener rejections.

## 5. Conclusion

**Priorities**

1. Close the privilege boundaries:
   - restrict which fields a guild manager can write (AUD-001)
   - anchor chat parsing and stop relaying `<`/`>` through `/say` (AUD-002)
   - enforce `server:rollback` (AUD-003)
   - make prune-stats fail closed (AUD-004)
2. Remove the whole-blob read-modify-write pattern from reward and claim stores (AUD-005), and fix the two small robustness bugs that turn one transient error into a lasting outage (AUD-006, AUD-007).
3. Harden the remaining Medium items, which are mostly local fixes.

**Principal limitations:** the API wrapper was not audited, nothing was exercised against live Discord or Minecraft, and several bot schedulers and secondary stores got only light review.

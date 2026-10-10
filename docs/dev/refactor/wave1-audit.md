# Wave 1 audit

> **Status:** this audit was written before Wave 1 and is kept unchanged. What was done, what was deferred and how it was verified is in [wave1-summary.md](wave1-summary.md). Line references below describe the code at audit time.

Audit of the three repos that form the minecraft-bot system, written before any Wave 1 code changes.

| Alias | Repo | Path | Version |
|---|---|---|---|
| BOT | `minecraft-bot` | repo root | 6.1.0 |
| WRP | `minecraft-server-api` (package `mc-api-server`), a git submodule of SETUP | `minecraft-server-setup/src/scripts/api-server` | 3.5.0 |
| SETUP | `minecraft-server-setup` (holds the bash and Node scripts) | `minecraft-server-setup/src/scripts/{update,backup,common,misc,*.sh}` | 4.0.0 |

The sibling directory `minecraft-api-server` is a stale checkout of the wrapper (last commit 2026-08-02, a different remote). It is out of scope. Delete it to stop it being mistaken for the live wrapper (decision D14).

## 1. Scope and method

- **Read:** source of all three repos, targeted by risk. The contract-relevant READMEs, changelogs and docs were read. The full `docs/` trees were not read page by page.
- **Tools run:** `npm audit` and `npm outdated` (BOT, WRP), `eslint --max-warnings 0` (BOT, WRP, both clean). `shellcheck` is not installed, so the bash findings come from reading. `tsc` was not rerun; the brief states the baseline is green.
- **Confidence:** findings marked *suspected* were read but not executed. Everything else was confirmed against the code at HEAD. Spot-checks of the highest-impact findings (F01, F02, F04, F08, F10, F12) were repeated by hand before this report was written.
- **Not covered:** the Vue component internals beyond the admin flows, the Discord embed builders (Wave 2), and runtime behaviour on a live Linux host.
- **Items from the request** (chunkbase, server-argument audit, analytics filter, player list) are designed in section 8 and scheduled in section 7.

## 2. Executive summary

Top findings, ranked. Section 3 has the full table.

1. **Commands are acknowledged as delivered when they never reached the server (F01, F02).** `sendCommand` returns `null` for four different situations. Ban, kick, pardon, whitelist add and remove ignore the result and record success. The temp-ban scheduler deletes the ban record after a `/pardon` that may have failed, so the player stays banned with nothing left to retry.
2. **Two config fields are silently dropped (F03).** `loadConfig()` builds `BotConfig` from an explicit key list that omits `timezone` and `featureNudges`. Setting either in `config.json` or the dashboard has no effect.
3. **Wrapper restore cannot work as wired (F04, F05, F06).** The wrapper passes an absolute `--file`, which `restore.sh` joins onto the backup directory. The script deletes the world before checking the archive, and the route does not require the server to be offline.
4. **Server resolution is wrong in three cases (F07).** Without a default, `getGuildServer` picks the first server in the whole deployment (not the guild's). DMs never resolve. A stale `defaultServer` is silently replaced. `/daily-admin` skips the tenant check.
5. **The dashboard process never reloads config (F09).** Grants, `adminUsers` and the console block list stay frozen until the container restarts. A code comment promises that revoking access takes effect on the next request.
6. **No shared contract source (F11).** Wire types exist in at least six hand-copied places. The cross-repo test covers roughly a third of the wrapper surface.
7. **Docker ships a committed schema (F12).** The brief requires generation inside the Docker build. Only CI guards drift.
8. **Mod config saves above 4 KB fail (F08).** The wrapper's global body limit is 4096 bytes while its config-file limit is 1 MB.

## 3. Ranked findings

Severity: Critical (data loss or security hole now), High (wrong behaviour or data loss on a plausible path), Medium (defect with a workaround, or latent), Low (debt). Evidence paths are relative to the repo named in the Repo column; WRP paths are relative to `src/scripts/api-server/`, SETUP paths to `src/scripts/`.

### High

| ID | Repo | Evidence | Finding | Fix |
|---|---|---|---|---|
| F01 | BOT | `src/core/utils/server/server.ts:57-66`; `src/bot/logWatcher/watchers/schedulers/tempBanScheduler.ts:103-104` | `ServerInstance.sendCommand` swallows every error and returns `null`. `tempBanScheduler` sends `/pardon`, ignores the result, then calls `removeTempBan`. If the wrapper is down, the ban record is deleted and the player is banned for good. | Result type (section 5). Do not remove the record unless the outcome is `delivered` or `sent`. |
| F02 | BOT | `src/bot/commands/moderation/ban.ts:89`, `kick.ts:49`, `pardon.ts:40`, `shared/whitelistAdd.ts:65`, `unwhitelist.ts:34` | Return value ignored. Each then records state (`recordAdd`, `recordRemove`, temp-ban, audit entry), invalidates the whitelist cache and replies with success. | Result type. On `unreachable`, abort before recording and tell the admin. |
| F03 | BOT | `src/core/config.ts:168-192`; `src/schema/config.ts` (`timezone`, `featureNudges`) | The frozen `BotConfig` is built from an explicit key list. `timezone` and `featureNudges` are in the schema and the editor but not in the list, so `guildTimeZone()`, `scheduleTimeZone()` and `nudgeSettings()` never see the global values. Introduced in 7854dc9. | Add the two keys and an exhaustive test: every `RawBotConfig` key survives `loadConfig`. |
| F04 | WRP/SETUP | `WRP src/instances/restore.ts:63`; `SETUP backup/restore.sh:44-46,72-73` | The wrapper runs `restore.sh --file <absolute> --y`. The script builds `"$BACKUP_DIR/$SPECIFIC_BACKUP"`, producing `…/hourly//abs/path`, which fails the existence check. Wrapper-driven restore appears to always fail (confirmed by reading, not executed). | Accept an absolute path after a `realpath` containment check inside the backups root. Add it to the contract test. |
| F05 | SETUP | `backup/restore.sh:100`; `rollback.sh:74,82` | `rm -rf "$SERVER_PATH"/*` runs before the archive is validated or extracted. If extraction fails the world is gone. `rollback.sh` ignores a failed `systemctl stop` and deletes anyway. The glob also leaves dotfiles. | Validate (`zstd -t`, `tar -t`), extract into a staging directory, swap, and abort on a failed stop. |
| F06 | WRP/SETUP | `WRP src/http/routes/instance/backups.ts:156-176`; `SETUP backup/restore.sh` | The restore route does not require the server to be offline and the script never stops it. A restore on a live server deletes a world that is in use. The bot may gate this (`serverAccess.ts:1127`); not verified. | Refuse unless health is `offline`, or have the script stop and start the unit. |
| F07 | BOT | `src/core/utils/server/server.ts:305-316`; `src/bot/commands/admin/dailyAdmin.ts:84-93,137-148` | `getGuildServer`: DMs return `null`; the last fallback is `getFirstInstance()` (global, not the guild's allowed set); a stale `defaultServer` falls through silently. `/daily-admin reset` and `move` check only that the id exists, not that the guild may target it. | Section 8.2. |
| F08 | WRP | `src/http/app.ts:44,72` (`BODY_LIMIT_BYTES = 4096`); `src/instances/configFiles.ts:48` (`MAX_CONFIG_BYTES` 1 MB) | The global body limit is 4 KB and no route overrides it, so `PUT /configs/:id` bodies above 4 KB return 413. Most real mod configs cannot be saved, though the code intends 1 MB. | Per-route `bodyLimit` of about 1.1 MB on the config routes. |
| F09 | BOT | `src/web/backend/**` (no `watchConfig`/`reloadConfig` call); `src/core/config.ts:130`; `src/web/backend/auth/capabilities.ts:91` | The dashboard process caches `loadConfig()` forever. `webui.grants`, `adminUsers`, `webui.clientId`, `console.blockedCommands` and the command policy stay stale until restart. The server registry is also stale after a server is added or removed. The comment at `capabilities.ts:91` says revocation applies on the next request, which is false. | Reload in the web entrypoint using the same watcher plus reconcile as the bot. |
| F10 | BOT | `src/core/utils/cache.ts:73` | `void refresh()` in the stale-while-revalidate branch drops a rejecting promise. `src/web/backend/index.ts:22` exits the process on `unhandledRejection`. No caller passes `staleMs` today, so it is latent. | Catch and log in the background refresh, or delete `staleMs`. |
| F11 | all | `WRP src/contracts/wire.ts`; `BOT src/core/utils/server/serverAccess.ts` (types at :245, :609, :884-940); `BOT src/web/frontend/src/api.ts:128-222`; `BOT src/schema/contract.ts:58`; `WRP src/instances/backupFiles.ts:62`, `configFiles.ts:56` | Wire types are hand-copied in at least six places. `scripts/e2e-wrapper-contract.mjs` covers the manifest, info, whitelist, usercache, stats, capabilities, mod slugs, backups listing, log tail, list, tps and command. It does not cover health v2, stats bulk, any mod-management route, backup-files download and delete, restore, mod-configs, or `scripts/run`. | Section 4. |
| F12 | BOT | `Dockerfile:36,103`; `.github/workflows/ci.yml:39-40` | The image copies the committed `config.schema.json` and never runs `schema:generate`. Drift is caught only by CI `schema:check`. | Generate in the builder stage; keep `schema:check` as a second guard. |
| F13 | WRP | `src/platform/rcon/client.ts:117,135,172` | `authTimeout` is cleared only after a packet arrives. On `error` or `close` it stays armed and ten seconds later calls `_cleanup()` on whatever socket exists, killing a healthy newer connection and triggering the cooldown. This produces RCON flapping after an outage. | Hold the timer in a field and clear it in `_cleanup()`. |
| F14 | SETUP | `backup/backup.sh:226,233` | `tar … \| zstd` runs without `pipefail`. If `tar` dies midway, `zstd` still emits a valid archive, `zstd -t` passes, and a truncated backup is reported as success. | `set -o pipefail`, check `PIPESTATUS`, verify with `tar -tf`. |
| F15 | SETUP/WRP | `SETUP backup/backup.sh:139-145`; `backup/automation/run_backup.sh` | No `flock`. Cron and a wrapper-triggered backup share `$BACKUP_DIR/tmp_backup` with `rsync --inplace` and can interleave. A failed run leaves a stale temp directory. | Per-instance `flock`; include the temp directory in the EXIT trap. |
| F16 | BOT/SETUP | `BOT src/core/utils/server/serverAccess.ts:192,1288-1293`; `WRP src/instances/scripts.ts` (timeouts) | The bot's `runScript` uses the default 30 s POST timeout. The wrapper allows backup 600 s, rollback 300 s, stop and restart 60 s. The bot reports failure at 30 s while the script keeps running; rollback is destructive. | Per-action timeouts. Prefer a start-then-poll model for long actions. |
| F17 | SETUP/WRP | `SETUP docs/sudoers-setup.md:44-55`; `WRP src/instances/mods.ts:46-51` | The sudoers example allows `/usr/bin/bash …/scripts/*` only. Mod operations run `sudo -n -u <user> node update/*.js`. Without a `node` grant, install, remove, update and toggle fail with a generic sudo error. Both repos use PATH-resolved `bash` and `node`. | Document and test the `node` grant, or run the Node scripts through an allowed wrapper. |

### Medium

| ID | Repo | Evidence | Finding | Fix |
|---|---|---|---|---|
| F18 | BOT | `src/bot/logWatcher/commands/info/chunkbase.ts:35-56` | `!chunkbase` replies with `click_event: {action:"open_url", url}`, the 1.21.5+ format. Older servers expect `clickEvent: {action, value}` and ignore the key, so the link is not clickable and the URL is not shown as text. *Suspected*: needs the server's Minecraft version. | Section 8.1. |
| F19 | BOT | `src/core/utils/server/server.ts:128-137` | `getSeed()` returns `null` on any server without an RCON output channel since 2ec11bc removed the log-poll fallback. `!seed`, `!slime`, `!chunkbase`, `/seed` and `/chunkbase` all depend on it. The comment in `slime.ts:9-11` is now wrong. Failures are not negative-cached. | Result type, plus a restored log poll for the `sent` case. |
| F20 | BOT | `src/bot/logWatcher/commands/general/waypoint.ts:68-100` | `getPlayerDimension` returns `"overworld"` on any failure. The waypoint is then saved with the wrong dimension. | Return a result; refuse to save when unknown. |
| F21 | BOT | `src/core/utils/server/server.ts:143-221` | `getPlayerCoords`, `getPlayerDimension` and `getLastDeathLocation` poll the log after a transport failure, adding 900 ms. `tailLog` can throw (including `BreakerOpenError`) out of them. | Skip the poll on `unreachable`; catch inside. |
| F22 | BOT | `src/core/utils/server/serverAccess.ts:189-213`; `circuitBreaker.ts:12-15` | Writes bypass the circuit breaker and never record failure. A down wrapper costs every in-game command up to 30 s with no fast fail. 429 on POST is not typed. | Route writes through the breaker (section 5). |
| F23 | BOT | `src/core/utils/minecraft/eventTips.ts:174-175`; `featureNudges.ts:191-195`; `defineCommand.ts:168` | State is recorded regardless of delivery: `markEventTipSent` (documented as "only after the whisper is sent"), `recordSuggestion`, and the in-game cooldown stamp. | Record on `delivered` or `sent` only. |
| F24 | BOT | `src/bot/commands/admin/challenge.ts:254`, `general/poll.ts:316-330`, `watchers/schedulers/pollScheduler.ts:202,209`, `restartScheduler.ts:112`, `watchers/monitors/milestoneWatcher.ts:145`, `watchers/log/advancements.ts:97`, `eventTips.ts` | `try { await server.sendCommand } catch` blocks that can never fire, because `sendCommand` never throws. The comments ("server may be down") describe behaviour that does not happen. | Replace with outcome handling. |
| F25 | BOT | `src/core/utils/minecraft/rewards.ts:99-153,18,125` | `give()` imports `serverAccess` directly to tell "sent, unverifiable" from "failed". The `null`-as-success rule also covers "RCON failed, fell back to screen, screen failed". | Remove the bypass once the result type exists. |
| F26 | WRP | `src/instances/commands.ts:21-45` | RCON errors are swallowed and fall through to `screen`. A failed `screen` send is logged and resolves; the function always returns `null` and the route answers `200 {result:null}`. | Return the transport used and a sent flag; reject on total failure. Bump `rcon-command`. |
| F27 | BOT | `src/bot/logWatcher/initMinecraftCommands.ts:100,213`; `chatBridge.ts:47-59` | `getServerIds()` is evaluated once at wiring and passed to the chat bridge. Single-server inference goes stale after a reload that adds or removes a server. | Pass a provider. |
| F28 | BOT | `watchers/monitors/tpsMonitor.ts:23-25`; `schedulers/leaderboardScheduler.ts:120-123`; `monitors/milestoneWatcher.ts:175-183`; `monitors/updateNotifier.ts:121-130` | Startup snapshots: TPS threshold and poll interval; global leaderboard interval, post time and post day; milestone and update-notifier timers armed only if enabled at boot. | Resolve per tick; always arm the timer (their `runPass`/`runCheck` already no-op). |
| F29 | BOT | `src/bot/logWatcher/initMinecraftCommands.ts:136,220,266`; `src/bot/index.ts:135-137` | `cfg.guilds` snapshot passed to status embed and application prompts (partly mitigated by per-pass reads). Reload events fired before `clientReady` are dropped. | Pass `liveGuildConfigs`; reconcile once at ready. |
| F30 | BOT | `src/core/utils/server/server.ts` (`initServers`, `addServerInstance`); `initMinecraftCommands.ts:329-335,399-404` | A `ServerInstance` holds its `ServerConfig` from construction. Changed `apiUrl`, `apiKey`, ping or `modpack` settings only log "restart required". | Replace the instance on change, or read config per call. |
| F31 | BOT | `src/core/config.ts:217-241` | `fs.watch(CONFIG_PATH)` watches the file, but `writeConfig` replaces it via temp and rename. On Linux (inotify) the watch can stay on the old inode, so the bot may miss every save after the first. The `error` handler never re-arms. *Suspected*; no test covers `watchConfig`. | Watch the directory, or re-arm after each event. Test on Linux. |
| F32 | BOT | `ConfigView.vue`, `useConfig.ts`, `useGuildConfig.ts`, `useGuildSetup.ts`, `useCommands.ts` | Admin editor gaps against the mods tab. Section 6. | Section 6. |
| F33 | BOT | `src/web/frontend/src/composables/useGuildSetup.ts:272-278,192-194,220-261` | The setup wizard re-fetches the hash immediately before the PUT, so the conflict check is meaningless. A failed or unfinished `seedFromExisting` yields an empty base. `buildGuildBlock` rebuilds features and drops sub-keys (`server`, `mentionRole`, `postTime`, `events`) and collapses a `chatBridge` array. Re-running the wizard on a configured guild is destructive. | Merge into the existing block; use the load-time hash. |
| F34 | BOT | `src/web/frontend/src/composables/useCommands.ts:213-260` | `save()` re-GETs `/api/config` and uses that fresh hash, so the 409 can never fire. | Use the hash from load. |
| F35 | BOT | `config_structure.json`; `src/core/config.ts:57,62-65`; `docker-entrypoint.sh:55`; `docs/admin/configuration.md:3,6` | `config_structure.json` still shows pre-5.0 per-server fields that `validateCandidateConfig` rejects, yet it is cited as the source of truth. Following the docs produces a config that fails validation. | Delete it; point at `config.template.json` and the schema. |
| F36 | BOT | `src/core/configValidation.ts:300-529` | Rules the schema can express are hand-coded: `guild.language`, `waypoints.maxPerServer`, `webui.port`, milestone arrays, restart time format. Unknown keys only warn, so a typo is ignored. `validateCandidateConfig` is one 349-line function. | Move to `@minimum`, `@maximum`, `@pattern`, enum tags; split the semantic checks per section. |
| F37 | BOT | `src/web/backend/routes/guildConfig.ts:31`; `src/web/frontend/src/views/GuildsView.vue:134`; `composables/useGuildSetup.ts:29` | The guild feature list exists three times; no test ties it to the schema. | Derive from the schema; test it. |
| F38 | BOT | `src/web/backend/routes/analytics.ts`; `useAnalytics.ts:93-143` | Range filter reaches only activity and command usage. Details in section 8.3. | Section 8.3. |
| F39 | WRP | `src/instances/mods.ts:69` | `SLUG_RE = /^[\w.-]{1,96}$/` allows a leading `-` and `..`. The slug is passed as argv to `node update/*.js`, where `--json` or `--help` are read as flags. No path escape (the slug indexes the manifest), but it is argument injection. | Require `^[a-z0-9][\w.-]*$`; put `--` before positionals. |
| F40 | SETUP | `update/add-mod.js:277,320`; `update/update-mods.js:252` | `decodeURIComponent(path.basename(pathname))` decodes after `basename`, so `%2F..%2F` becomes `../x.jar` (jar write path traversal if the API or CDN is hostile). No hash check although Modrinth supplies sha512. No axios timeout or size cap. `.tmp` files leak on failure. | Decode first, then `basename`; reject separators and `..`; verify the hash; add a timeout and size limit. |
| F41 | SETUP | `update/update-server.js:326-336` | The vanilla `server.jar` is written in place with no temp file and no sha1 check; a stream error leaves a truncated jar. | Download to a temp file, verify, rename. |
| F42 | WRP | `src/instances/mods.ts` (`runModScript`, ~:221) | No per-instance mutex. Concurrent add, remove and update run several `node` processes doing read-modify-write on `downloaded_versions.json`. Updates can be lost. | Serialize per instance; `flock` in the scripts. |
| F43 | SETUP | `maintenance.sh:13,94`; `message_onjoin.sh:14-19` | The second `trap cleanup EXIT` replaces the lock-removal trap, so the lock under `/tmp` is never removed and later runs report "already running". World-writable path, TOCTOU window. | Remove the lock in `cleanup`, or use `flock`. |
| F44 | SETUP | `common/server_control.sh:250-257,265-269,37,278` | `wait_for_save_completion` starts `tail -f` after `save-all` was sent, so a fast save is missed and the wait times out; orphan `tail` processes; `$LOG_FILE` is interpolated into a `bash -c` string. `session_running` does a substring match (`mc` matches `mc2`). `countdown` uses a global `i`. | Record the log offset before sending; anchor the screen match; declare locals. |
| F45 | WRP | `src/instances/scripts.ts` (timeouts) vs `SETUP shutdown.sh:25-35`, `smart_restart.sh` | Stop and restart have a 60 s timeout; the scripts sleep 25 s, count down, then wait for the save (up to 60 s). The kill hits mid-sequence, possibly after `save-off`. | 180 s or more, or run detached and poll. |
| F46 | SETUP | `backup/automation/cleanup_backups.sh:80-91` | The storage limit evicts the oldest archive across all tiers, including monthly and update archives. `archives/update` has no count policy; `jars/` is never pruned. `rm -v` under `set -e` aborts the run on one failure. | Count cap for `update`, prune jars, evict by tier priority. |
| F47 | SETUP | `backup/backup.sh:170-205`; `restore.sh:155` | Archives include `variables.txt`, the API key, RCON password and systemd units under the default umask. `restore.sh` copies units into `/etc/systemd/system` with `sudo`. *Suspected* (depends on sudoers). | `umask 077`; show a diff and require confirmation for units. |
| F48 | WRP | `src/platform/logStream.ts:122-124` | Offsets are in bytes and `readline` emits the final partial line. A window ending mid-line yields a truncated line, then a bogus second one. The chat bridge parses these. | Emit up to the last `\n` and carry the remainder. |
| F49 | WRP | `src/http/app.ts:111-114`; `routes/instance/logs.ts:55` | SSE replies use `reply.hijack()`. Whether `onResponse` runs for them was not verified. If not, each stream permanently adds to `inFlight`, and 32 streams return 503 for everything except `/health` and `/metrics`. *Suspected*. | `endRequest` on socket `close`; add a test. |
| F50 | WRP | `src/http/app.ts:157,166`; `writeRateLimit.ts` | The write limiter (10 per minute per IP) runs before auth, so unauthenticated POSTs from the bot's IP or a shared proxy exhaust the budget. The `hits` map is never swept, and with `trustProxy` a rotating `X-Forwarded-For` grows it. | Limit after auth; sweep. |
| F51 | WRP | `src/platform/spawn.ts:81,96` | `env: {...process.env}` goes to `sudo -u user`, including `MC_API_KEY` and `RCON_PASSWORD_*`. `env_reset` usually strips them (*suspected*). Timeout sends SIGTERM only. | Env allowlist; SIGKILL after a grace period. |
| F52 | BOT | `src/core/utils/server/serverAccess.ts:1109,1137,1166,1233` | Four fetches (backup download, restore POST, delete, config PUT) have no `AbortSignal.timeout`. | Add timeouts. |
| F53 | BOT | `src/web/backend/server.ts:67` | `trustProxy: true` unconditionally. If the dashboard is reachable without the proxy, clients can spoof `X-Forwarded-For` and dodge the auth and write limiters. | Make it configurable (hops or CIDR). |
| F54 | BOT | `src/web/backend/auth/auth.ts:39,157,229-247,348` | The OAuth `state` is signed and timed but not bound to the browser, so it can be replayed within 10 minutes. Sessions are stateless HMAC cookies for 7 days with no revocation. `MCBOT_DEV_NO_AUTH=1` grants sysadmin to everyone with no loopback or `NODE_ENV` guard. | State cookie; session version; refuse the bypass unless bound to loopback. |
| F55 | BOT | `src/web/backend/routes/mods.ts:350` | The icon proxy caches `icon:${href}` for 24 h with no entry or size cap and passes the upstream content type through. | Cap size and entries; allow `image/*` only. |
| F56 | BOT | `src/bot/index.ts:449-452` | Only SIGTERM and SIGINT are handled. No `unhandledRejection` or `uncaughtException` handler in the bot process. *Suspected*. | Log and exit cleanly. |
| F57 | BOT/WRP | dependency audit | BOT: 8 advisories (5 high): `vue` and `@vue/server-renderer` below 3.5.42 (XSS), `undici`, `brace-expansion`, `source-map-js`, `vitest` family (dev). WRP: 8 advisories (6 high): `fastify` (schema-validation bypass, `X-Forwarded-*` spoofing under `trustProxy`; fixed in 5.12.5), `fast-uri`, `js-yaml`, `nanoid`. All have fixes. Root BOT runs TypeScript 6 while the web workspace runs 7. | `npm audit fix`; bump `fastify` first; unify TypeScript. |

### Low

| ID | Repo | Evidence | Finding | Fix |
|---|---|---|---|---|
| F58 | BOT | `src/bot/commands/info/{chunkbase.ts:28,mods.ts:84,seed.ts:16,status.ts:27}`, `server/{backup.ts:17,control.ts:125,tps.ts:17}`, `shared/whitelistAdd.ts:80`, `unwhitelist.ts:27` | Dead `if (!server) throw` after `resolveServer()`, which already throws and returns non-null. | Delete. |
| F59 | BOT | `src/core/config.ts:255` | `getGuildServerId` is used only by its own test and bypasses tenant isolation. Also test-only: `getServer`, `getGuildConfig`, `getServerChoices`, `readLevelName`, `getPlayerNamesChoices`. Other dead exports: `startUptimeFlushScheduler`, `kvDelete`, `evictModCache`, `savePlayerCountStore`, `saveTempBanStore`, `getTempBan`. | Delete. |
| F60 | BOT | `src/core/utils/minecraft/playerUtils.ts:27-47,105,121` | `getListOutput` is called without a server and returns immediately; dead path. | Delete or give it a server parameter. |
| F61 | BOT | many (list in the debt scan) | Hard-coded English outside `t()`: `chunkbase.ts`, `mods.ts`, `seed.ts`, `status.ts`, `backup.ts`, `control.ts`, `tps.ts`, `whitelistAdd.ts`, `unwhitelist.ts`, `middleware.ts:71`, `clear.ts:28`, `index.ts:366,378`, `embedUtils.ts:203`, `uptime.ts:117-118`, `whitelisted.ts:56`, `playtime.ts`, in-game `link.ts`, `netherportal.ts`, `commands.ts`. The sample may be incomplete. | Add keys; extend `check-locales.mjs` with a literal-string lint (Wave 2 handles wording). |
| F62 | BOT | `src/core/utils/server/serverAccess.ts` (1349 lines); `scripts/setup.mjs` (1319); `statusEmbed.ts` (718); `routes/mods.ts:102` (364-line function); `modConfigs.ts:135` (256); `routes/config.ts:60` (234) | God modules and oversized functions. | Split `serverAccess` by feature behind a shared `apiClient`. |
| F63 | SETUP | `update/*.js`, `lib/`, `common/load_variables.sh`, `WRP src/config/parseVars.ts` | `loadVariables`, `escapeRegex`, `detectInstalledJars` and the `--json` console-hijack boilerplate are copy-pasted. At least three `variables.txt` parsers, one of which `source`s it. | Shared `lib/`. |
| F64 | SETUP | `backup/backup.sh:52,159`; `run_backup.sh:59`; `restore.sh:46-47` | `--archive` is unvalidated, so `..` changes `BACKUP_DIR` (the wrapper's `SAFE_ARG` allows `..`). `run_backup.sh` executes `$DO_GENERATION_BACKUPS` as a command. `restore.sh` reads `$2` under `set -u` without a count check. `smart_restart.sh --warn=abc` errors under `set -e`. | Validate with `^[a-z0-9_-]+$`; compare strings. |
| F65 | SETUP | `common/webhook.sh:156` | Background `curl` without `--max-time` or `-f`; the webhook URL (a secret) shows in `ps`. | `--max-time`, config file or stdin, `wait`. |
| F66 | WRP | `src/http/auth.ts:40-47`; `config/load.ts` | `isBlocked` creates an entry for every IP, even with no failures; the sweep runs only in `recordFailure` above 10 000 entries. Default bind `0.0.0.0` over HTTP, no minimum API-key length, `linuxUser` unvalidated before `sudo -u`. | Do not create entries on read; sweep; enforce 32 or more characters; validate. |
| F67 | WRP/SETUP | `.claude-flow/` in both repos; `variables.json` in SETUP | Tracked tool-state files, dirty in the submodule. | `.gitignore`, untrack. |
| F68 | WRP | `openapi.yaml:4`; `CHANGELOG.md`; `README.md:170-187` | `info.version` is 3.0.0 while the package is 3.5.0. The changelog has no 3.2 to 3.5 sections; 3.3.0 features sit loose under Unreleased. Docs say "wrapper 3.3.0 needed" for features the manifest already negotiates. | Reconstruct the changelog; drop hard-coded versions from docs. |
| F69 | WRP/BOT | `.github/workflows/tests.yml`; `BOT release.yml` | WRP tests are path-filtered, so an `openapi.yaml`-only change skips the openapi-vs-router test. BOT `release.yml` runs a build on Node 20 and skips tests, `schema:check` and `e2e:contract`; CI runs Node 24. Comments claim Node 22.13 is needed for `node:sqlite` although `better-sqlite3` is the default. | Run the full gate on tag; add `openapi.yaml` to the filter; fix the comments. |
| F70 | BOT/WRP | `.github/workflows/contract.yml` (both) | Each repo tests against the other's default branch, not the pinned submodule SHA. SETUP has no CI that checks the pinned wrapper against the bot, and the submodule bump is a manual commit. | Section 4. |
| F71 | BOT | `src/core/utils/server/wrapperContract.ts:103-110` | `stats-bulk` is deliberately absent from `EXPECTED_WRAPPER_FEATURES` although the bot calls it, so every start logs "offers features bot does not use yet: stats-bulk". The route is never contract-tested. | Add it (version 1). |
| F72 | SETUP/WRP | `remove-mod.js:~178`; `wire.ts` | The JSON always emits `orphanedDependencies: []` while the contract says it lists orphans. | Implement or drop the field. |
| F73 | BOT/WRP/SETUP | n/a | Test gaps. BOT, no direct test (*suspected*; some covered indirectly): `whitelistApplications.ts` (513 lines), `poll.ts`, `pollScheduler.ts`, `challenge.ts`, `note.ts`, `dailyAdmin.ts`, `ban.ts`, `watch.ts`, `profile.ts`, `hostResourcesMonitor.ts`, `updateNotifier.ts`, `importLegacy.ts`, web routes `analytics`, `config`, `guildConfig`, `monitoring`, `servers`, `setup`. WRP: `spawn.ts` (security critical), `mods.ts`, `restore.ts`, `scripts.ts`, `commands.ts`, `players.ts`, `world.ts`, most instance routes. SETUP: no tests at all. | Characterization tests before each restructure (section 7). |

## 4. Cross-repo coordination

### 4.1 Current map

```
@mcbot/schema (BOT)            wire.ts + manifest.ts + openapi.yaml (WRP)
   serverActions, capabilities       hand-written, responses only
        |                                    |
        |   hand-copied types                |  generated at runtime from the Fastify router
        v                                    v
serverAccess.ts + wrapperContract.ts (BOT) --HTTP--> /manifest, /instances/:id/...
        ^                                              |
        |  scripts/e2e-wrapper-contract.mjs            |  spawn.ts: sudo -u <user> bash|node <script>
        +----- runs BOT's built serverAccess ---------+--> SETUP scripts (update/*.js, backup/*.sh, *.sh)
                against a live WRP build                   parsed by WRP as JSON (mods) or raw (ScriptResult)
```

- **Source of truth:** none. The manifest (generated from the router, parsed strictly by `parseManifest`) is the nearest thing to one. `openapi.yaml` is hand-written and checked against the router in WRP CI only.
- **Feature gate:** `EXPECTED_WRAPPER_FEATURES` (18 entries) in BOT against `FEATURES` (20 entries) in WRP. Drift categories: missing, outdated, ahead (all blocking in the e2e) and unused (a note). At runtime `verifyWrapperContract` (`serverAccess.ts:713`, called from `src/bot/index.ts:93`) only logs; it never gates.
- **Compatibility:** probe order is `/manifest`, then `/info` with `MIN_WRAPPER_VERSION = 3.0.0`, then a warning. Every call degrades on its own (null, assume all capabilities, per-uuid fallback).
- **E2E locating the wrapper:** `WRAPPER_DIR`, default `../api-wrapper` (a name that matches no real directory). CI checks out the other repo's default branch, never the submodule pin.
- **Script contract:** mods scripts emit JSON that the wrapper `JSON.parse`s and checks only for a boolean `ok` (and a `results` array for `check-updates`). Management scripts return `ScriptResult {output, stderr, exitCode}` with no schema. Restore is outside `SCRIPT_MAP` and passes `--file` and `--y`.

### 4.2 Proposal: where shared contract types live

Three options.

| Option | What | For | Against |
|---|---|---|---|
| A. Shared package `@mcbot/wire` | Types and runtime validators (zod or typebox) published from one repo, imported by both | One definition, runtime validation in the bot, no generation step | Needs publishing or a git dependency; couples release cadence; new dependency |
| B. Schema-first OpenAPI | `openapi.yaml` is the source; generate TypeScript types for both sides (`openapi-typescript`) | Language-neutral; the file already exists and has 1383 lines; shell scripts can be documented in the same place | The file is hand-written today and wrong in places (version 3.0.0); needs a generation step in two repos |
| C. Wrapper owns, bot generates | WRP emits `openapi.json` from the Fastify route schemas at build; BOT fetches or vendors it and generates types | Types follow the real router, no hand-maintained spec | Needs route schemas on every route (many routes lack them); version pinning between repos |

**Recommendation: C, in two steps.** First give every route a response schema in WRP and generate `openapi.json` from the router, which removes the hand-written spec. Then vendor that file into BOT (committed, regenerated by a script, drift-checked in CI) and generate wire types from it, replacing the six hand copies and the frontend copies. The bot keeps validating at the edge with `parseManifest`-style checks for the few shapes it must trust. This needs no new package registry and keeps the two repos releasable independently. Marked **my decision (D1)**.

### 4.3 Proposal: deploy order and compatibility policy

- **Order for a contract change:** (1) contract test updated, (2) WRP change that serves the new shape, (3) BOT change that consumes it, (4) SETUP submodule pointer bump. The wrapper always ships first.
- **Policy: a one-minor window.** Within a major version the wrapper serves old and new shapes side by side, and the bot negotiates through manifest feature versions (`feature@v2` already exists for `server-health`, `host-info`, `mod-management`, `backup-files`). The old shape is removed in the next major. Lockstep releases are used only when the window is impractical, and then both PRs link each other and merge together.
- **Why not pure lockstep:** the bot already degrades per call, the wrapper runs on a different machine from the bot, and the operator upgrades them separately.
- **Gates to add:** BOT `release.yml` runs the full gate; both `contract.yml` jobs test against the submodule pin as well as `main`; SETUP gets a CI job that builds the pinned wrapper and runs the bot's e2e. Marked **my decision (D2)**.

### 4.4 Contract test coverage plan

Extend `e2e-wrapper-contract.mjs` per changed route in each phase. Missing today: health v2, stats bulk, all mod-management routes, backup-files list, download and delete, restore, mod-configs, `scripts/run`, `/command` result kinds. Derive the route list from the manifest so a new route without a test fails the run instead of passing silently. Fix the default `WRAPPER_DIR`.

## 5. `serverAccess` result type

### 5.1 What happens today

| Layer | Behaviour |
|---|---|
| `ServerInstance.sendCommand` (`server.ts:57-66`) | Returns `string \| null`. Never throws. Any HTTP error, timeout, DNS failure or 429 becomes `null` plus a `log.warn`. |
| `serverAccess.sendCommand` (`serverAccess.ts:544-552`) | Returns the wrapper's `result` verbatim. Throws on non-2xx, a 30 s timeout or a network failure. Bypasses the circuit breaker. |
| Wrapper `POST /instances/:id/command` | Returns `{result}`. |
| Wrapper `sendCommand` (`commands.ts:21-45`) | RCON success: the string (possibly `""`). RCON throws (timeout, refused): swallowed, falls to `screen`. `screen` result is always `null`, even when `execFile` failed. |

So `null` means one of four things: delivered through `screen` with no output channel, RCON failed and `screen` was tried, `screen` failed outright, or the bot could not reach the wrapper. `""` and `null` are also conflated by `if (!output)` (`sleepWatcher.ts:49,403`). `give()` (`rewards.ts:99-153`) reaches around the abstraction to separate the first from the last.

### 5.2 Proposal

```ts
type CommandOutcome =
  | { kind: "delivered";   output: string }   // RCON answered; output may be ""
  | { kind: "sent";        via: "screen" | "rcon-fallback" }  // sent-unverifiable: no output channel
  | { kind: "unreachable"; reason: "wrapper-down" | "timeout" | "breaker-open"
                                  | "rate-limited" | "http-error" | "screen-failed" | "rejected";
                           detail: string };
```

- **Wire:** `POST /command` responds `{ result, via: "rcon"|"screen", sent: boolean, rconError? }`. A failed `screen` send returns an error status instead of `200 {result:null}`. `result` stays for old bots. `rcon-command` goes to v2.
- **Bot:** `serverAccess.sendCommandOutcome(cfg, cmd): Promise<CommandOutcome>` never throws and classifies the failure. `ServerInstance.send(cmd)` returns the same union. `sendCommand(cmd): string | null` stays as a shim during migration and is deleted in the last domain phase. Writes go through the circuit breaker.
- **Old wrapper:** a wrapper without `rcon-command@v2` answers `{result}` only. The bot maps `string` to `delivered`, `null` to `sent`, and a thrown error to `unreachable`, which is today's behaviour minus the swallowing.

### 5.3 Callers affected, by domain

Migrate one domain per PR (section 7). "Needs" is what the caller must distinguish.

| Domain | Callers (file:line) | Needs | Change |
|---|---|---|---|
| Moderation and whitelist | `ban.ts:89`, `kick.ts:49`, `pardon.ts:40`, `whitelistAdd.ts:65`, `unwhitelist.ts:34` | `unreachable` aborts; `delivered` may inspect the output; `sent` = "applied, unverified" | Abort before recording state; surface the error |
| Schedulers | `tempBanScheduler.ts:103`, `restartScheduler.ts:112`, `pollScheduler.ts:202,209`, `milestoneWatcher.ts:145`, `advancements.ts:97`, `chatBridge.ts:404` | `tempBanScheduler`: never remove the record on `unreachable` (retry next tick). Others: log and skip | Outcome handling replaces the dead `catch` |
| Player queries | `server.ts:128-221` (`getSeed`, `getPlayerData`, `getPlayerCoords`, `getPlayerDimension`, `getLastDeathLocation`); consumers `waypoint.ts:68-100`, `slime.ts`, `netherportal.ts`, `chunkbase.ts` (in-game and slash), `deathpos.ts`, `deaths.ts:85,97`, `seed.ts` | Full union: parse on `delivered`, poll the log on `sent`, fail fast on `unreachable`. A parse failure is its own result, never `"overworld"` | Return results; stop the 900 ms poll after a transport failure; negative-cache the seed |
| Sleep and day cycle | `sleepWatcher.ts:44-52,401-412,441-442` | `sent` and `unreachable` both mean "unknown"; `unreachable` skips the follow-up title | Handle `""` separately from `null` |
| Reply and announce | all `/msg` and `/tellraw` in `logWatcher/commands/*`, `defineCommand.ts:156,170`, `eventTips.ts:174`, `featureNudges.ts:191`, `rewards.ts:193`, `report.ts`, `challenge.ts:254`, `poll.ts:316-330` | Ignore except `unreachable`, which skips the "recorded" steps (`markEventTipSent`, `recordSuggestion`, cooldown stamp) | One helper, `whisper()`/`announce()`, that wraps the outcome |
| Rewards | `rewards.ts:99-153` | `delivered`: run the `Gave` check. `sent`: success. `unreachable`: requeue | **Remove the `serverAccess` bypass**; update `pendingDelivery.test.ts` to mock `ServerInstance` |
| Web console | `web/backend/routes/console.ts:20,146` | `delivered` output, `sent` "sent, no console output on this server", `unreachable` 502 | Use `ServerInstance.send`; remove `?? ""` |
| Dead or buggy | `playerUtils.getListOutput` (`:27-47`, callers at `:105,:121` pass no server) | n/a | Delete or add a server parameter |

### 5.4 Other abstraction leaks

- Raw `serverAccess` imports beside `ServerInstance`: `rewards.ts:18`, `web/backend/routes/console.ts:20`, `admin/console.ts:18` (`tailLog`, deliberate), `control.ts:13` (`runScript`), `playerUtils.ts:2`.
- Three failure policies on one client: reads (breaker, 8 s, typed `RateLimitedError`), writes (no breaker, 30 s or 8 s, generic `Error`), and `sendCommand` (swallow). After the first `sendCommand` null, the `tailLog` fallback can throw `BreakerOpenError`.
- Duplicate hand-rolled retry in `getHealth` (`server.ts:79-94`) and `getList` (`:114-126`), each with `RETRY_DELAY_MS = 500`. `getList` returns `playerCount: "0"` on total failure, which reads as "empty server".
- `rcon-command` v1 has no result-kind field (`manifest.ts:151`), so the wire change needs a manifest bump and a `degrades` entry in `wrapperContract.ts`.

## 6. Config and admin editability

### 6.1 Pipeline

- `config.schema.json` is generated by `scripts/generate-schema.mjs` (ts-json-schema-generator, `additionalProperties: false`) from `RawBotConfig` in `src/schema/config.ts`, and committed. `npm run build` and `build:all` regenerate it; the Docker build does not (F12).
- Backend: `GET /api/config/schema` (sysadmin) and `GET /api/guilds/config-schema` (guild managers; returns `definitions.GuildConfig` plus all definitions). Frontend: `useConfig.ts`, `useGuildConfig.ts`, `ConfigView.vue`, `GuildConfigEditor.vue`, `SchemaField.vue`, `ArrayField.vue`, `MapField.vue`, `schemaField.ts`. The CLI wizard `scripts/setup.mjs` reads the same file.
- Validation is two-pass: structural through Ajv on the generated schema (`configSchemaCheck.ts`), then hand-written semantic checks (`configValidation.ts`). Unknown keys only warn.
- **Coverage:** a walk over the real schema with `classifyField` shows only `leaderboard.*` (a `Record<string, unknown>`) falling to the raw-JSON textarea. Every other node maps to a typed control, and `SchemaField.vue` has no hidden-field list. **No test asserts this**, so a new field with an unsupported shape would degrade silently. The editor also uses the raw key as the label, shows no defaults, and ignores `minimum`, `maximum` and `required` client-side.
- **Hand-maintained copies:** `config_structure.json` (stale, F35); the guild feature list in three files (F37); `SetupWizard.vue` and `useGuildSetup.ts` (hand-coded, F33).

### 6.2 What makes the mods tab work (the reference)

`ModsView.vue` with `useMods.ts` and `routes/mods.ts`:

- **Data flow.** The composable is stateless URL builders over `apiGet` and `apiSend`; the view owns the reactive state. The backend has TTL caches (`TTL_INSTALLED` 15 s), invalidates the affected keys after each mutation (`invalidateServer`), audits every write (`recordAdminAction`) and gates by capability per server (`mods:read`, `mods:write`, scope `server`, param `id`).
- **State.** Separate refs per concern (`loadingInstalled`, `checking`, `applyingAll`, `searching`, `loadingDetail`) and a per-row `busy` set, so one action disables only its own row. Every list has an explicit loading text and empty text.
- **Feedback.** One `flash()` toast (3.5 s ok, 6 s error) with specific messages ("Installed X (+N deps)", "Disabled X. Restart the server to apply."). `{ok:false, error}` results are surfaced as well as thrown errors.
- **Reload.** After a mutation only what changed is re-fetched. No optimistic update; the server is the truth.
- **Layout.** Stats row, two cards, pager, header actions. Write controls are hidden unless the user has `canWrite`, so read-only users still see the data.
- **Confirmation.** Only destructive removal asks.
- **Its own gaps:** `loadInstalled` and `checkNow` swallow errors; it uses `window.confirm` and hand-rolled CSS instead of `ViewHeader` and PrimeVue.

The closer reference for editing config is `ModConfigView.vue` with `useModConfigs.ts`: a per-field `pending` map, a `dirty` computed with a per-field marker, a "Save N change(s)" button, Discard, change-only writes with an ETag, a re-read after save, a stale banner, a write queue with a conflict picker (`ConflictPicker.vue`) and snapshot revert. Its own gaps: `openFile` and `loadFiles` silently clear `pending` (`useModConfigs.ts:200,219`), and no guard protects unsaved edits on a file or server switch.

### 6.3 Where the other admin areas fall short

| Area | Gaps against the reference |
|---|---|
| **Config editor** (`ConfigView.vue`, `useConfig.ts`) | No dirty state, no Discard, no leave guard. Save is always enabled; saving an unchanged form shows "Config saved" (`useConfig.ts:101-107`; `useGuildConfig.ts:73-79` handles this correctly). No `loading` ref, so the page is blank until the fetch returns. After a failed load `model` is null, the body claims "falling back to raw JSON mode" (`ConfigView.vue:62-64`) but raw mode is not on, Save stays enabled (it would PUT `config:null`), and there is no retry. A 409 is detected by substring-matching the message (`useConfig.ts:110-115`), because `apiSend` throws a plain `Error` with no status. The handler then reloads and overwrites the user's edits. Validation errors are a flat banner list, not tied to fields. Rollback lives in the Audit view, away from the editor. |
| **Guild editor** (`GuildConfigEditor.vue`, `useGuildConfig.ts`) | Same: no dirty tracking, Cancel discards silently, Save enabled during load and after a failed load, conflict reload discards edits (`useGuildConfig.ts:84-87`). The concurrency token is the whole-file hash, so editing guild A conflicts with any save to guild B or to a server entry. Reuses a stale `schema` across opens. |
| **Setup wizard** (`SetupWizard.vue`, `useGuildSetup.ts`) | Data-loss risks, F33. The conflict branch tests for `"409"` in a message that never contains it, so it is dead. |
| **Commands view** (`CommandsView.vue`, `useCommands.ts`) | Best dirty handling of the group (`dirty`, `pendingCount`, Discard, Reset, ConfirmDialog). But `save()` re-fetches the hash (F34), errors are 5 s toasts only, the load error has no retry, no leave guard. |
| **Backups** (`BackupsView.vue`) | Solid (loading, error, stale banner, typed-name confirm). Uses `window.prompt` where Commands uses PrimeVue's ConfirmDialog, and Mods uses `window.confirm`: three confirmation idioms. |
| **Roles and permissions** (`webui.grants`) | No dedicated UI. Grants are edited as raw config; `bot:config` can never be granted. |
| **Cross-cutting** | No `beforeunload` or router leave guard anywhere in the frontend. `api.ts:11-27` throws a bare `Error` with no status, so every composable string-matches; `ConfigWriteConflict` exists and is unused here. The `baseHash` check at `routes/config.ts:167` and `guildConfig.ts:136` is not atomic with `writeConfig`, so two concurrent PUTs can both pass (small window). The UI never says whether the bot has applied a change. It never reports bot-down (the heartbeat exists at `routes/monitoring.ts:62`) or that a server setting needs a restart. |

**Save and reload path today:** `PUT /api/config` compares `baseHash`, merges secret placeholders, validates, then `writeConfig` writes a `.tmp`, copies the old file to `.bak`, renames, snapshots history and audits. The bot picks the change up through `watchConfig` (300 ms debounce, `reloadConfig`, then `summarizeConfigChanges` and `reconcileServers`). There is no web-to-bot call and no acknowledgement. `src/bot/utils/applyConfig.ts` exists with no callers. Toasts promise that "the bot reloads config automatically" without any evidence.

### 6.4 Proposal

1. Schema generated at build time in the Docker builder (F12). A CI test walks the generated schema and asserts that every node has a non-fallback editor control, except an explicit allowlist, so "a config field missing from the editor" fails the build.
2. A shared `useEditableDocument` composable carrying the `ModConfigView` behaviour (dirty, per-field markers, discard, change-only save, ETag, re-read, leave guard), adopted by the config, guild, commands and wizard flows.
3. `apiSend` throws a typed `ApiError { status, code, body }`; delete all message matching.
4. A web-to-bot "applied" signal (config revision plus the bot heartbeat) so the UI can say applied, pending, bot down, or restart required.
5. Per-guild concurrency tokens (hash of the guild subtree) in place of the whole-file hash.
6. Schema annotations (`@title`, `@description`, `@default`, `@minimum`) so the editor shows labels, help, defaults and bounds.

## 7. Workplan

Each phase is one branch and one PR per affected repo (`refactor/w1-<nn>-<slug>`). Phases 01 to 04 touch only BOT and ship independently, so they go first. Version impact: breaking changes bump the repo's major version; BOT is 6.1.0, WRP 3.5.0, SETUP 4.0.0. Characterization tests land before any restructure of an untested module.

| Phase | Scope | Repos | Risk | Test strategy | Deploy order | Version |
|---|---|---|---|---|---|---|
| **w1-01** server resolution | Fix `getGuildServer` (section 8.2); optional `server:` on `/whitelisted`, `/stats`, `/top`, `/leaderboard`, `/playtime`, `/compare`; `/daily-admin` tenant check; delete dead checks and `getGuildServerId`; fix F03 (`timezone`, `featureNudges`) | BOT | Low | Unit tests for every resolution branch (DM, no default, stale default, single server, multi-guild); command tests per new option | BOT only | BOT minor (6.2.0) |
| **w1-02** in-game `!chunkbase` | Section 8.1; `!commands` lists every folder; handler tests | BOT | Low | Handler test with a fake server for both click formats; `chunkbaseUrl` test | BOT only | BOT patch or minor |
| **w1-03** analytics range | Section 8.3 | BOT | Low | New route tests (harness: `webBackend.test.ts`); core tests per section; frontend composable test | BOT only | BOT minor |
| **w1-04** `/players` | Section 8.4 | BOT | Low | Merge and sort tests; pagination test; locale parity | BOT only | BOT minor |
| **w1-05** contract coordination | Per-route response schemas in WRP, generated `openapi.json`, vendored and drift-checked in BOT, generated wire types replace the copies, route list derived from the manifest, e2e extended to full surface, gates fixed (F69, F70, F71), `WRAPPER_DIR` default | BOT, WRP, SETUP | Medium | The e2e itself is the test; manifest and openapi agreement tests | WRP, then BOT, then SETUP pointer | WRP minor, BOT minor, SETUP patch |
| **w1-06** `serverAccess` result type | Section 5, one domain per commit group: wire change (WRP `rcon-command@v2`, F26), bot types and shim, moderation and whitelist, schedulers (F01 first), player queries (restore the seed log poll), reply helpers, rewards (remove bypass), web console, delete shim | WRP, BOT | Medium to high (touches many callers) | Characterization tests for each domain first; outcome-matrix tests per caller; e2e covers the three outcomes | WRP first, BOT after, one release window | WRP minor, BOT minor |
| **w1-07** config versioning, migration, schema pipeline | Section 9; Docker schema generation (F12); editor-coverage test; `loadConfig` exhaustiveness test; delete `config_structure.json`; typed `ApiError`; `useEditableDocument` and per-guild tokens; applied-signal; `watchConfig` hardening (F31); dashboard reload (F09) | BOT | High (breaking config format, migration) | Migration fixtures F1 to F16 from git history; backup-before-write test; Docker build in CI; watcher test on Linux | BOT only; migration runs on first load | **BOT major (7.0.0)** |
| **w1-08** wrapper and scripts hardening | F04 to F06, F08, F13 to F17, F39 to F51, F63 to F66; characterization tests for `spawn.ts`, `mods.ts`, `restore.ts`, `scripts.ts`, `commands.ts`; `bats` tests for backup and restore with fake `tar` and `rsync` | WRP, SETUP | Medium to high (restore and backup are destructive) | Characterization first; restore tested only against scratch directories | SETUP scripts and WRP together, then BOT | WRP minor, SETUP minor |
| **w1-09** bot reliability and debt | F10, F27 to F30, F52 to F56, F58 to F62, dependency bumps (F57), locale literals (F61), god-module split of `serverAccess` | BOT | Medium | Characterization tests for the split; full suite | BOT only | BOT minor |
| **w1-10** mod update availability check | Section 10 | BOT, WRP | Medium | Contract test for the new route; job-state tests; UI test following mods tab patterns | WRP, then BOT | WRP minor, BOT minor |
| **w1-11** docs and release | Update stale docs, changelogs (reconstruct WRP 3.2 to 3.5), `wave1-summary.md`, cut versions | all | Low | Link check, `layout:check`, docs lint | Release order: WRP, SETUP, BOT | per phase |

The order differs from the suggested one in two places: the four user-visible bot fixes go first because they are independent and low-risk, and wrapper hardening gets its own phase before the mod check because restore and backup defects (F04 to F06) are a data-loss risk and should not wait for the last phase.

## 8. The four requested items

### 8.1 In-game `!chunkbase` does not work

Evidence: `src/bot/logWatcher/commands/info/chunkbase.ts:9-56`; dispatch in `RemoteLogWatcher.ts:79-106` and `defineCommand.ts:97-187`; `src/core/utils/minecraft/chunkbaseUrl.ts:19-30`.

Dispatch and registration are fine: the command is loaded from its filename, matches `!chunkbase`, is not disabled by default, and has no capability gate. Two causes are plausible, and the first is unique to this command.

1. **Click event format (F18, suspected).** The reply is the only `tellraw` in the codebase with a click event, written in the 1.21.5+ format (`click_event` with `url`). On 1.21.4 and older the server expects `clickEvent` with `value`, ignores the unknown key, and the player sees "[Click here]" that does nothing. The URL is never shown as text.
2. **Seed lookup (F19).** On a server whose wrapper has no RCON channel, `getSeed()` returns `null` and the player gets "Could not retrieve the world seed". If `!seed` also fails on the same server, this is the cause.

Minor: `!commands` and `!help` read only the `general/` folder, so `!chunkbase` is never listed. The cooldown is stamped before the handler runs, so a failed call blocks a retry for 10 s. Disabling `commands.chunkbase` for the slash command also disables the in-game command (`commandPolicy.ts:67`).

**Two checks settle it:** the server's Minecraft version, and whether `!seed` works on it.

**Fix (w1-02, with the seed part in w1-06):** build the click component by version (`clickEvent`/`value` below 1.21.5), always print the URL as plain text next to it, use the polling dimension helper, list all folders in `!commands`, stamp the cooldown only after a `delivered` or `sent` outcome, and add handler tests. The test gap today: `commands_admin.test.ts:175-180` only checks that `init()` does not throw; nothing covers the handler, `chunkbaseUrl` or the `tellraw` shape.

### 8.2 Server argument audit (every command)

Result of reading all 43 slash commands, the in-game commands (none take a server; they act on the server the chat line came from) and the shared resolver: **no slash command requires a server except `/daily-admin reset` and `move`**, and every command with an optional `server:` goes through `resolveServer()` (`src/bot/utils/guild/guildRouter.ts:174-192`). The defects are in the shared fallback and in a handful of commands.

| Defect | Evidence | Effect |
|---|---|---|
| DMs never resolve | `server.ts:308`; commands are registered globally with no contexts (`src/bot/index.ts:225`) | `/status`, `/daily` and others run in a DM fail with "No server configured for this guild" even with one server. A test (`server_and_utils.test.ts:101`) locks this in. |
| Last fallback is the first server globally | `server.ts:315` | With several guilds and no `defaultServer`, the pick may not be in the guild's allowed set, so `assertGuildMayTarget` throws, even when the guild has exactly one allowed server. |
| Stale `defaultServer` replaced silently | `server.ts:311-315` | A typo in config is hidden. |
| `/daily-admin reset` requires `server` | `dailyAdmin.ts:148` (`getString("server", true)`) | Violates "optional with guild default". Only `assertKnownServer`, no tenant check, so a guild-scoped admin can reset another tenant's records. `move` (`from`, `to`) has the same gap; `show` lists every server. |
| `/uptime` ignores `defaultServer` | `uptime.ts:33-49` | Without `server:` it shows an overview of all allowed servers. Intentional, but inconsistent; the comment at :43 is misleading (decision D6). |
| No `server:` option at all | `/whitelisted`, `/stats` (player, daily), `/top`, `/leaderboard`, `/playtime`, `/compare` | Always use the default; a multi-server guild cannot pick. |
| Duplicate resolvers | `config.ts:255` `getGuildServerId` (dead, unsafe); `whitelistApplications.ts:120-127` `defaultApplicationServer` (correct); `followUps.ts:321-326` (first server globally, hints only) | Three versions of the same rule. |
| Dead checks | nine `if (!server) throw` (F58) | Noise. |

`/map` reads a global URL and is not per-server (acceptable). `/whois` scans every server (admin-only, acceptable).

**Target resolution order:** explicit option → the guild's `defaultServer` if it names a running server → if `defaultServer` is set but unknown, an explicit config error → the guild's only allowed server → in a DM, the only configured server → otherwise an error that lists the choices. One function, used by `resolveServer`, `defaultApplicationServer` and `followUps`. Tenant check applies to every path, including `/daily-admin`.

Tests today: `guildRouter.test.ts` mocks `getGuildServer`, so the real chain is never tested through `resolveServer`; nothing covers DMs, a single allowed server without a default, a stale default, or `/daily-admin` isolation.

### 8.3 Analytics range filter

Only activity and command usage honour the range; the rest ignore it.

| Section | Endpoint | Range sent | Honoured | Data has timestamps | Fix |
|---|---|---|---|---|---|
| Uptime | `/api/servers/:id/analytics` | yes (shared request) | no, fixed 24 h, 7 d, 30 d windows (`uptimeTracker.ts:120-122`); the UI says so at `AnalyticsView.vue:67` | yes, `uptime_checks.t`, about 30 d kept | Add a custom-window calculation (`WHERE t >= ?`) next to the fixed windows |
| Activity and busiest hours | same | yes | yes, in memory (`analytics.ts:94-96`) | yes, `player_count_hours.h`, 14 d | Works. Push the filter into SQL instead of loading the whole table |
| Leaderboard | `/analytics/leaderboard?stat=` | no | no, all-time | stats files have no timestamps, but `snapshots` do (hourly for 26 h, then daily up to 32 d) | `getSnapshotClosestTo(id, now - hours)` as `baseline`, as in `leaderboardScheduler.ts:268-278`. Include the range in the `readThrough` key. Flag when history is shorter than the range, because the fallback is the oldest snapshot |
| Players | `/analytics/players` | no | no | partly: sessions have `joinedAt` and `leftAt`, but only the last 20 per player (`sessionStore.ts:24`) | Keep players with a session overlapping the window; clip playtime to it; label session counts as "in the last 20 sessions" |
| Command usage | `/api/analytics/commands?hours=` | yes | yes, but rounded to whole days (`analytics.ts:234`) | yes, 90 d | Hour precision in `usageByCommand` |

Also: `AnalyticsView.vue:295-308` re-runs only `load()` on a range change, and `select()` calls `loadBoard` without the range. The range is capped at 14 days for the activity series (`AnalyticsView.vue:244-253`), which would cap everything unless the cap is per section. Response types are hand-duplicated in `useAnalytics.ts:15-65`; there are no analytics contracts in `@mcbot/schema`. No tests exist for the route or composable.

**Fix (w1-03):** add `hours` to the leaderboard and players routes, pass the range from `useAnalytics.ts`, put the analytics DTOs into `@mcbot/schema`, make caps per section and show them in the UI, and add route tests.

### 8.4 `/players`: every player who ever played, with last activity

**Data sources and limits**

| Source | Gives | Limit |
|---|---|---|
| Stats UUIDs (`listStatsUuids`, `readAllStats`; `statUtils.ts:310-322`) | Every UUID that ever joined (most complete "ever played"), lifetime playtime (`findPlayTimeStat`) | No timestamp; the wrapper does not expose file mtime (`routes/instance/stats.ts:31`) |
| `loadKnownPlayers` (whitelist plus usercache; `whitelist.ts:95-125`) | UUID to name map | The wrapper drops `expiresOn` (`players.ts:52-64`); vanilla usercache is capped at about 1000 entries, so "ever" is best effort |
| Session store (`sessionStore.ts`, `kv_store["sessions"]`) | `lastSeen`, online now, sessions | Only since the bot began tracking; keyed by lowercased name; `lastSeen` is set on leave or close; no UUID; last 20 sessions per player |
| Snapshots | "stats changed since" | 32 days only |

**Design.** Union of stats UUIDs and known players, mapped UUID to name, joined to the session store by lowercased name for `lastSeen` and online state. A player with no session shows "before tracking" and their lifetime playtime. Sorted by last activity, online players first. Paginated at 20 per page with the existing helpers (`createPaginationButtons`, `handlePagination`; template `waypoints.ts:24-105`), optional `server:` through `resolveServer`, relative timestamps as `<t:…:R>`, `withErrorHandling`, EN and DE keys under a new `players.*` area, plus `docs/user/commands.md` and `docs/features.md`. A shared `formatLastSeen` helper replaces the six inline `<t:…:R>` builders. Optionally a filter `inactive:<days>`.

**Better data (decision D10):** expose `expiresOn` and the stats file mtime from the wrapper. `expiresOn - 30 days` approximates the last login for players the bot never saw, and mtime approximates the last stats flush. It needs a wrapper change and a contract update, so it fits w1-05 or later.

Command naming: there is no `/seen`, `/lastseen`, `/players` or `/online` today. Recommended name: `/players` with a `sort:` option (`last-seen`, `playtime`, `name`).

## 9. Live reload and config migration

### 9.1 Remaining startup snapshots

Already correct (resolve per event or tick): chat bridge guild lookup, joinLeave, deaths, advancements, serverEvents, notifyGuilds, channelPurge, downtimeMonitor, hostResourcesMonitor, consoleRelay, command policy, i18n, timezones, rate limiter and linked role.

| # | Location | Captured | Fix |
|---|---|---|---|
| 1 | `initMinecraftCommands.ts:100,213`; `chatBridge.ts:47-59` | `getServerIds()` result | Pass a provider (F27) |
| 2 | `tpsMonitor.ts:23-25` | threshold, poll interval | Read in the tick; self-rescheduling timeout |
| 3 | `leaderboardScheduler.ts:120-123` | global interval, post time, post day | `loadConfig()` inside `checkAndPost` |
| 4 | `milestoneWatcher.ts:175-183` | timer armed only if milestones exist | Always arm |
| 5 | `updateNotifier.ts:121-130` | timer armed only if enabled | Always arm |
| 6 | `initMinecraftCommands.ts:136,220,266` | `cfg.guilds` for status embed and application prompts | `GuildConfigSource` parameter |
| 7 | `initMinecraftCommands.ts:128,260` | `reconcileRestartSchedules(client, cfg)` | Covered by `doReconcile`; pass a provider anyway |
| 8 | `src/bot/index.ts:53,66,110,134,222,225,429` | `loadConfig()` for `initServers`, token, clientId | Token and clientId need a restart; log a clear notice when they change |
| 9 | `src/bot/index.ts:135-137` | reload before `clientReady` is dropped | Reconcile once at ready |
| 10 | `bot/index.ts:197`; `initMinecraftCommands.ts:186` | `commandEnabledAnywhere` evaluated once | Re-evaluate on reload |
| 11 | `server.ts` (`initServers`, `addServerInstance`) | `ServerConfig` at construction | Replace the instance, or read per call (F30) |
| 12 | `rateLimiter.ts:~90-128` | limiter shape | Deliberate; document |
| 13 | **Whole web process** (`src/web/backend/**`) | `loadConfig()` cache forever | F09: reload plus a server-registry reconcile |

Use `liveGuildConfigs()` and `resolveGuildConfigs()` (`src/bot/utils/guild/guildConfigs.ts:28,33`); no second provider pattern is introduced. A lint-style test greps `src/bot/logWatcher` for `loadConfig()` or `cfg.` captured outside a callback.

### 9.2 Versioning and migration mechanism

Today: no version field and no migration code. The only handling of old formats is detection plus an error (`REMOVED_LOCAL_SERVER_FIELDS` in `src/schema/config.ts:16`, `configValidation.ts:216-250`, `docs/admin/migrating-to-5.md`). The brief requires automatic migration, so:

- Add `configVersion: number` (first migrated version is 1; a missing field means 0).
- `src/core/configMigrations.ts`: an ordered array of `{ from, to, describe, migrate(raw) }`. Each migrator is pure and operates on parsed JSON.
- `loadConfig()` reads the raw file, runs pending migrators, and if anything changed: writes `config.json.bak-v<from>-<timestamp>` first, writes the migrated file atomically (temp then rename, reusing `writeConfig`), logs one line per applied migrator with the fields it changed, and then validates. A migration that fails leaves the original untouched and the bot refuses to start with the migrator's message.
- The dashboard `PUT` path stamps the current `configVersion`. A config with a version newer than the code is rejected with a clear message rather than loaded.
- The 5.0 local-fields gate becomes a migrator: it maps `serverDir`, `scriptDir`, `linuxUser`, `screenSession`, `useRcon`, `rconHost`, `rconPort`, `rconPassword` away, and where it cannot invent `apiUrl` and `apiKey` it stops with the existing migration message (a missing wrapper address cannot be guessed; decision D8).
- `config.schema.json` gains `configVersion`. The editor shows it read-only.

### 9.3 Migration fixtures (from git history)

| # | Commit | Date | Shape |
|---|---|---|---|
| F1 | dcb9373 / 45e575c / eb44b1b | 2025-06-13 | Flat single server: `token, clientId, linuxUser, screenSession, serverDir` |
| F2 | aa1e71a | 2025-10-07 | F1 plus top-level `commands` |
| F3 | 252e578 | 2026-04-12 | Flat plus RCON fields |
| F4 / F4b | 679e8c4 / 0704377 | 2026-04-12 | `servers{}`, `guilds{}`, TPS settings; then top-level `adminUsers` |
| F5 | 08d1619 | 2026-04-17 | TS rewrite: `scriptDir`; guild `statusEmbed`, `downtimeAlerts`, `channelPurge` |
| F6 | 1e3c3cd | 2026-04-18 | Remote instance entry (`apiUrl`, `apiKey`, `id`) beside local entries |
| F7 | 5e2bef2 | 2026-07-04 | Guild `adminUsers`, `allowedServers`, `chatBridge` array, `allowInsecureHttp` |
| F8 | a44c128 / 8ce8224 | 2026-07-05 | `presence`, `hostAlerts`, `waypoints`, `limits`, `updateNotifier`, `schedules`, `milestones`, `webui`; guild `language`, `console`, `whitelistApplications`, `commands`, `linkedRole`, `reports`, `deathCoords` |
| F9 | d703f30 / 03eb753 | 2026-07-12 | Last 4.x structure (`config_structure.json`, the file the docs still point at) |
| F10 | 331a7dc | 2026-07-16 | Last pre-5.0 commit |
| F11 | 2ec11bc (v5.0.0) | 2026-07-17 | Local fields removed; `apiUrl` and `apiKey` required; env `RCON_PASSWORD[_ID]` becomes `API_KEY[_ID]` |
| F12 to F16 | cf640af, 7854dc9, 837baee, ec4da3f, 3c3c4f7 | 2026-07-27 to 09-22 | Additive keys: ping settings, `timezone`/`featureNudges`, `webui.grants`, server `publicAddress`/`modpack`, leaderboard post time and day |

F1 to F10 are the pre-5.0 shapes that fail today with the migration error; F9 is the most likely real-world old config because the docs point at it. F7 and later differ only by optional keys. Fixtures are created with `git show <hash>:config_structure.json` (and `src/common/types/config.ts` at a44c128 for typed shapes) and committed under `tests/fixtures/config/`. A real-shaped copy of the maintainer's current config (secrets scrubbed) is added as one more fixture.

The SQLite database already has versioned migrations. Any new column needs a migration test against a copy of real-shaped data; none is planned in Wave 1.

## 10. Mod update availability check (design)

### 10.1 What exists

- Script: `SETUP src/scripts/update/check-updates.js`. Arguments: `[mcVersion] [--mcVersion=<ver>] [--json]`; without a version it uses `gameVersion` from `common/downloaded_versions.json`. Per mod slug it calls Modrinth (`GET /v2/project/{slug}`, then `GET /v2/project/{id}/version` filtered by `game_versions=[mcVersion]` and `loaders=[modLoader]`), takes the newest by `date_published`, and checks mods one at a time. `--json` prints `{ mcVersion, modLoader, results: [...] }`; each result has `slug` and `status` ∈ `up_to_date | update_available | no_versions | no_matching_version | invalid_entry | error`, with `currentVersionId`, `latestVersionId`, `latestVersionName`, `datePublished`, `downloadUrl` or `message`/`error`.
- Wrapper: `checkUpdates(mcVersion?)` in `src/instances/mods.ts:284-297` runs it through `runModScript` (120 s timeout), and `GET /instances/:id/mods/updates?mcVersion=` exposes it (`routes/instance/mods.ts:128`, version checked by `MC_VERSION_RE`; `ModUpdateCheck` in `contracts/wire.ts:209`; documented in `openapi.yaml:839`).
- Bot: `ModUpdateCheck` in `serverAccess.ts:934` and the frontend copy `api.ts`; the mods tab already shows "update available" for the **installed** game version.

The script is reused as it is. Nothing is reimplemented.

### 10.2 What is missing

The existing endpoint answers "can each mod be updated on the current game version". The feature asks "if I move to version X, which mods have a compatible release". The script already supports this through `mcVersion`; what is missing is the contract, progress, caching and UI.

### 10.3 Contract

Normalize in the wrapper (one place), not in the script:

| Script status | Contract `availability` |
|---|---|
| `up_to_date`, `update_available` | `available` |
| `no_versions`, `no_matching_version` | `unavailable` |
| `invalid_entry`, `error` | `unknown` (with `reason`) |

```
GET /instances/:id/mods/compat?mcVersion=1.21.5
-> 200 { mcVersion, modLoader, checkedAt, complete: boolean,
         summary: { available, unavailable, unknown, total },
         mods: [{ slug, name?, availability: "available"|"unavailable"|"unknown",
                  currentVersionId?, target?: { versionId, versionName, datePublished, downloadUrl? },
                  reason? }] }
```

New manifest feature `mod-compat@1` (`degrades`: the bot hides the control and falls back to the old `/mods/updates` for the installed version). The route is a new name; the existing `/mods/updates` stays unchanged.

### 10.4 Long-running checks

The script is sequential and a large modpack can exceed the 120 s timeout and the 8 s or 30 s client timeouts. Options: (a) one blocking request with a larger timeout, (b) start-then-poll, (c) stream partial results over SSE. **Recommendation: (b).**

- `POST /instances/:id/mods/compat {mcVersion}` returns `202 { jobId }`. `GET /instances/:id/mods/compat/:jobId` returns `{ state: "running"|"done"|"failed", progress: { done, total }, partial: mods[] }` and the final contract when done.
- To get live progress without changing the script's JSON contract, the wrapper runs the script once per slug, bounded to a small concurrency, which also removes the single 120 s ceiling. `check-updates.js` has no slug filter today (usage line 7: `[mcVersion] [--mcVersion=<ver>] [--json]`), so this needs one additive flag, `--only=<slug>`, in the existing argument parser. The default behaviour and JSON shape stay unchanged.
- One job per `(instance, mcVersion)` at a time (a mutex, which also covers the F42 race); a second request returns the running job.
- The bot proxies the same shape; the UI polls every 1 to 2 seconds and stops when the tab hides.

### 10.5 Caching

Key `(instance, mcVersion, installed-mod-set hash)`. TTL 6 hours (Modrinth data changes slowly); invalidated by any mod mutation (the wrapper already invalidates its mod caches in `runModScript`). The bot's route caches with `readThrough`. A `refresh=1` parameter bypasses the cache. A global rate limit on outgoing Modrinth calls is kept in the script's HTTP client (`lib`), with a User-Agent that names the project.

### 10.6 UI (inside the mods tab, following its patterns)

- A "Check for version" control in the mods header: a version select (installed version first, then versions from the Mojang manifest, filtered to the installed loader's supported range; a free text field as fallback) and a Check button. It follows `canWrite`/`mods:read` gating (checking needs read only).
- State handling as in `ModsView`: separate `checkingCompat` ref, progress text ("Checking 14 of 62"), explicit empty, error and stale states, a `flash()` toast on failure. Do not swallow the error (the existing `checkNow` does).
- Results appear as a column and a filter on the installed list: a badge per mod (available, unavailable, unknown with reason), counts in the stats row ("48 ready, 9 missing, 5 unknown"), and a filter chip to show only blockers. Clicking a mod opens its target release (name, date, link). No automatic apply: moving versions is a manual server operation, outside this feature.
- Capability and degrade: hidden when `mod-compat` is absent; the old per-installed-version check keeps working.
- Wave 2 may restyle it; it must be complete and usable in Wave 1.

## 11. Open decisions

Each has a recommendation. Reply with the numbers you accept or change.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Home of shared contract types (section 4.2) | **C**: WRP generates `openapi.json` from route schemas; BOT vendors it and generates wire types |
| D2 | Compatibility policy (section 4.3) | A one-minor window with manifest feature versions; lockstep only for unavoidable breaks; full gate on tags; contract jobs also test the submodule pin |
| D3 | Phase order (section 7) | As proposed: four bot fixes first, wrapper hardening before the mod check |
| D4 | Config version bump | Accept 7.0.0 for the migration phase (breaking: `configVersion` field and automatic rewrite) |
| D5 | Wire change to `POST /command` | Add `via`, `sent`, `rconError`; failed `screen` returns an error status; `rcon-command@v2`; keep `result` for old bots |
| D6 | `/uptime` with no `server:` | Show the default server's detail and add an `all` choice for the overview |
| D7 | Commands in DMs | Keep them working: resolve to the only configured server, otherwise ask for `server:`. Alternative: register guild-only. Recommend keeping DMs for read-only commands only |
| D8 | Pre-5.0 configs without `apiUrl` | The migrator stops with the existing message and a precise list of what to add; it does not guess a wrapper address |
| D9 | `/players` also lists players with no tracked session | Yes, as "before tracking" with lifetime playtime |
| D10 | Wrapper exposes `expiresOn` and stats mtime | Yes; additive fields on `/usercache` and `/stats`, in w1-05 |
| D11 | Mod check progress model (section 10.4) | Start-then-poll with per-slug runs and a small concurrency limit |
| D12 | Whether to run the destructive restore and rollback fixes in w1-08 or earlier | Earlier: F04 to F06 are data-loss defects. Recommend pulling them into their own small PR before w1-05 |
| D13 | `getSeed` for servers without RCON output | Restore the log-poll fallback for the `sent` case; do not add a wrapper `/seed` endpoint |
| D14 | Delete the stale `../minecraft-api-server` checkout | Yes, after confirming it holds no unpushed work |
| D15 | `.claude-flow/` tracked state files in WRP and SETUP | Untrack and gitignore |

Approval needed: the workplan (D3), D1, D2, D4, D5, D7, D12. The rest can follow the recommendation unless you object.

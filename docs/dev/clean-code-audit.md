# Clean code audit

Audit date: 2026-10-18. Audit only: no source file was changed. Findings are judged against `docs/dev/coding-guidelines.md` and `docs/dev/decisions.md`; anything those documents mandate is not reported.

## 1. Executive summary

The codebase is in good shape where its rules are enforced mechanically (no `console.*`, no raw embed colours, no shell interpolation, strict TypeScript, workspace boundaries). The violations that carry real cost cluster around five root causes, all of the form "one rule, several hand-written copies":

1. **Half-finished seams.** The wrapper HTTP client has no single fetch path, so the circuit breaker, 429 handling, timeouts and auth header differ per call site (CC-001). The store layer is half migrated to `kvMutate`, which leaves a lost-update race open in three stores (CC-004). Both are the same pattern: a fix was applied to some callers and the old path was left exported.
2. **Degrading by fabricating values.** `ServerInstance.getList()` returns "0 players" on failure, so every caller must work around it and at least one cannot (CC-002).
3. **Rules enumerated by hand in several places.** Which guild fields carry a server scope (tenant isolation) is listed three times (CC-003). The locale union, config field lists, wrapper header and route scaffolding follow the same shape (CC-007, CC-011, CC-012).
4. **Large units that mix concerns.** `/daily`'s `_execute` (about 230 lines), `ModsView.vue` (about 1,970 lines, three features), the mod-config PUT handler (about 110 lines), `handleInteraction` (about 170 lines).
5. **Frontend duplication that scoped styles hide.** The same card, chip, footer and tap rules are copied across views, the same API adapters across two views, and five error-text helpers exist (CC-009, CC-010, CC-022).

A second, deeper pass read all of `src/core/utils/**` line by line (CC-038 to CC-066). It found two High issues that are correctness or access-control problems rather than maintainability ones: a used link code can be replayed to rebind another player's Discord link (CC-038), and an explicit empty `allowedServers` list fails open in multi-guild setups (CC-039). It also confirmed the same root causes as the first pass at larger scale: time literals ignoring `MS`, hand-copied `loadConfig` fallbacks, swallowed errors in wrapper helpers, and duplicated parsers.

A third pass read the frontend composables, all of `src/bot`, `src/schema`, `core/db` and `core/types` in full (CC-067 to CC-099). It found two more High issues: command modules are imported with a raw path, which fails on Windows and would leave the bot with no commands (CC-067, reproduced), and `/console tail` sends up to 3,800 characters as message content against Discord's 2,000-character cap (CC-068). The Medium findings add several behaviour bugs (a permanent `/ban` leaving a timed ban armed, a sleep guard that never rejects, a scheduled-restart race, a legacy importer that retires files it did not import) and show three recurring root causes: stale-response handling that is hand-rolled in some composables and missing in others (CC-073), thresholds and lists that exist in several layers instead of `@mcbot/schema` (CC-081), and user-facing strings that bypass the locale tables (CC-079).

Counts: 10 High, 55 Medium, 34 Low (99 findings; CC-001 to CC-037 from the first pass, CC-038 to CC-066 from the `core/utils` pass, CC-067 to CC-099 from the frontend composables, `src/bot`, `src/schema` and `core/db` pass). Findings were produced by read-only slice reviews and then spot-checked by the lead reviewer with grep and direct reads (see section 4); they are not all independently re-read.

## 2. Scope and method

- **Weighting:** git churn (last 300 commits) and file size. Hotspots examined: `core/utils/server/**`, `core/config.ts`, `core/configValidation.ts`, `schema/config.ts`, `schema/contract.ts`, `web/backend/**` (routes first), the large Vue views and `PruneMap.vue`, `api.ts`, composables, `bot/index.ts`, `initMinecraftCommands.ts`, `daily.ts`, `statusEmbed.ts`, `whitelistApplications.ts`, and the core stores and db layer.
- **Excluded by request:** `tests/`, `dist/` output, all documentation. Also treated as excluded: generated `src/schema/wire/types.ts`, and locale tables as sources of findings.
- **Tools:** static reading plus grep and small scripts for usage counts, dead-export checks and CSS-body comparison. No linter, duplication detector or complexity tool was run for this audit; nothing was installed.
- **Note:** `ModsView.vue` was edited earlier in this session (summary strip, bulk selection, paging, pending bar). It is judged as it is now. Line numbers are as of audit time and may drift.

## 3. Findings

### High

#### [HIGH] CC-001: The wrapper has no single HTTP seam (principle: DRY, inconsistent patterns)
- **Location:** `core/utils/server/access/apiClient.ts` (`apiGetRaw` ~L99-129 vs `apiPost`/`apiPut`/`apiDelete` ~L150-215), `access/commands.ts` (`sendCommandOutcome` ~L56-113), `access/backups.ts` (~L129-168), `access/configFiles.ts` (`sendConfigWrite` ~L120-148), `logs.ts`, `manifest.ts`, `transportError.ts` (~L56).
- **Evidence:** Only `apiClient.ts` and `commands.ts` touch the circuit breaker, with different rules (`>=500` in one, `>=500 && !=502` in the other, never elsewhere). A down wrapper costs every POST/PUT/DELETE its full timeout (30 s default, 630 s for restore) while GETs fail fast. `apiGetRaw` throws `RateLimitedError` on 429 but `apiPost` throws a generic `ApiError`, so `classifyTransportError` carries a special case to paper over it. `x-api-key` is built by hand at 11 sites (verified by grep). Wrapper error-body extraction exists twice with different caps (300 vs 200), and timeout detection is implemented four ways; `commands.ts` ignores the `TIMEOUT_CODES` set, so a headers timeout is "wrapper down" there and "timeout" elsewhere.
- **Remediation:** one internal `wrapperFetch(cfg, route, {method, body, timeoutMs, headers})` owning auth header, timeout, breaker accounting, 429 mapping and `ApiError` creation. Make the four `api*` functions and the raw-fetch sites thin wrappers; keep per-route status handling (412, 502 to `ScreenFailed`) at the call sites. Decide the 502 breaker rule once. Export one `wrapperErrorMessage(body, cap)` and one `isTimeoutError`. Risk: changing breaker behaviour for mutating calls changes failure latency; add tests for the breaker-open path first.
- **Confidence:** verified.

#### [HIGH] CC-002: `getList()` fabricates "0 players" on failure (principle: swallowed errors, misleading result)
- **Location:** `core/utils/server/server.ts` `getList` ~L190-202 (fallback `{playerCount:"0", maxPlayers:"?", players:[]}`, verified). Callers: `bot/commands/info/status.ts`, `deaths.ts`, `monitors/downtimeMonitor.ts` (`countPlayers`), `schedulers/statusEmbed.ts`, `playerUtils.ts`, `playerCountHistory.ts`, `web/backend/status/status.ts`.
- **Evidence:** the doc comment says the goal is to distinguish a blip from "server empty", but the last fallback returns exactly the indistinguishable value. `playerCountHistory` admits it and gates every sample on a prior `getHealth()` so it does not record fake zeros. `downtimeMonitor.countPlayers` has a `catch` that can never fire, so a downtime alert can report 0 players during a wrapper blip. Each new caller has to rediscover the health pre-check.
- **Remediation:** return `QueryResult<ServerListResult>` (the type exists) or rethrow after the retry, and let callers choose. Put the health pre-check in one `listIfQueryable()` helper.
- **Confidence:** verified.

#### [HIGH] CC-003: "Which guild fields carry a server scope" is listed three times (principle: DRY, change-safety)
- **Location:** `core/configValidation.ts` `checkGuildServerRefs` ~L369-378 and `checkTenantIsolation` ~L435-442; `core/utils/server/guildTargets.ts` `referencedServerIds` ~L19-42 (with its own `scopeToList` and a second chat-bridge normaliser that duplicates `bridgesOf`).
- **Evidence:** all three name the same scope fields (notifications, leaderboard, tpsAlerts, downtimeAlerts, reports, chatBridge, defaultServer). Tenant isolation depends on this list. Adding a server-scoped feature and missing one copy yields a missing unknown-server warning, a false leak warning, or a runtime allowed-set that omits the new feature's server. The first two copies already disagree on `allowedServers`.
- **Remediation:** one exported `guildServerScopes(guild)` returning `{field, ids}[]` next to `scopeToList`, used by all three; share one `bridgesOf`.
- **Confidence:** strongly supported (read by the reviewer, not independently re-read).

#### [HIGH] CC-004: Lost-update race still open in the session, challenge and watch stores (principle: inconsistent fix across call sites)
- **Location:** `core/utils/stores/sessionStore.ts`, `challengeStore.ts`, `watchStore.ts` (whole-document `load…` then `save…`). Writers: `bot/logWatcher/watchers/log/joinLeave.ts` (`recordSession`), `log/serverEvents.ts`, `monitors/downtimeMonitor.ts`, `log/advancements.ts`, `commands/admin/challenge.ts`, `commands/general/watch.ts`, `utils/hints/followUps.ts`.
- **Evidence:** callers do load, mutate the whole copy, save. `challenge.ts` and `watch.ts` call `saveChallengeStore`/`saveWatchStore` directly (verified). Two joins or a join and a leave in a burst overwrite each other. `kvMutate` exists for this, and `noteStore`, `pollStore`, `waypointStore`, daily and whitelist applications already use it, so the codebase has two patterns for one problem. This is guideline 8's lost-update race, reintroduced.
- **Remediation:** add `updateSessionStore(fn)`, `updateChallengeStore(fn)`, `updateWatchStore(fn)` (thin `kvMutate` wrappers with the existing normalisers), move the seven writers over, and stop exporting the whole-store save functions. Read-only callers (whois, profile, analytics) can keep `load…`.
- **Confidence:** verified for the shape; strongly supported that it loses data under bursts.

#### [HIGH] CC-005: Pending-reward queue is hand-manipulated at six sites; `/daily` `_execute` is a ~230-line function (principle: DRY, SRP)
- **Location:** `bot/commands/connection/daily/daily.ts` `_execute` ~L81-312; `bot/logWatcher/watchers/log/advancements.ts` ~L106-113; `core/utils/minecraft/rewards.ts` `deliverPendingRewards`; `core/utils/stores/dailyStore.ts` `updatePendingRewards`/`getServerPending`.
- **Evidence:** the sequence "get per-server map, `??= []`, push, cap check, filter by (discordId, queuedAt), take or requeue-ahead" is written out three times in `daily.ts` and again in the other two files, with lowercasing of the key done by hand each time. Rollback by `(discordId, queuedAt)` identity is a hidden contract between two places in `daily.ts`. `_execute` also holds roll logic, streak math, persistence, offline queueing, online delivery and three embed variants; `buildQueuedEmbed` argument lists are duplicated; `isLinked` plus `getLinkedAccount` do two reads for one answer.
- **Remediation:** add `enqueuePending`, `removePending`, `takePending`, `requeuePending` to `dailyStore` and use them at all sites. Extract a pure `rollClaim(pool, userData, now)` and a `claimDaily(server, user)` service returning a discriminated outcome; the command maps outcomes to embeds. Risk: this is the reward economy, so characterise current behaviour with tests before extracting.
- **Confidence:** strongly supported.

#### [HIGH] CC-006: Live save and queued save keep the same rules in two places (principle: DRY, SRP, long function)
- **Location:** `web/backend/routes/modConfigs.ts` `queueFromCache` ~L144-204 and the PUT handler ~L367-475; the revert handler ~L477-538.
- **Evidence:** both paths do the etag compare, `holdsSecrets`/`mayTouchSecretFiles`, the `parseConfig` editable gate and the edit-to-`BadRequest` mapping. The secret-file check appears at five places and the stale-etag 409 text is copied three times. The code comment itself cites AUD-013, a past case where the two paths drifted. A new rule (size cap, another protected class) must be added to both, and the PUT handler also mixes transport, validation, queueing, audit, splice, write and cache invalidation.
- **Remediation:** extract `assertWritable(current, edits, etag, maySecret)` returning the spliced text and throwing typed errors, used by PUT and `queueFromCache`. Extract `loadConfigFile(req, server, fileId)` for GET, PUT and revert. Define the stale-etag message once.
- **Confidence:** strongly supported.

### Medium

#### [MEDIUM] CC-007: Route scaffolding is copy-pasted across the web backend (principle: DRY, inconsistent error handling)
- **Location:** `web/backend/routes/mods.ts` six mutation handlers (~L318-483, about 25 lines each, differing only in verb, core call and detail); `requireServer` redefined in `backups.ts`, `console.ts`, `modConfigs.ts`, `mods.ts`, `prune.ts`, `servers.ts`, `upgrades.ts` (plus a void variant in `rewards.ts`, inline copies in `monitoring.ts` and `analytics.ts`); six different `OPERATION_FAILED` constants; `sessionFromRequest(req)!` at 31 sites in 12 files; `new HttpError(502` at 36 sites in 7 files; about 20 `recordAdminAction(` sites.
- **Evidence (counts verified by grep):** `servers.ts` says its `requireServer` is "the one place the no such server contract lives" while seven other copies exist. The six `OPERATION_FAILED` texts differ, and three send operators to "bot logs" although these routes run in the web process. `BadGateway`/`ApiErrorCode.BadGateway` exist in `errors.ts` but only `discordRest.ts` uses them, so the 36 sites carry no stable `code`. The log tail returns 500 where every other site returns 502. `busyKind` and the 423-to-409 mapping are duplicated between `upgrades.ts` and `prune.ts`, and `prune.ts` imports `busyKind` from a sibling route file. Update and update-all share one audit action string.
- **Remediation:** one shared `requireServer`, one `OPERATION_FAILED`, an `auditedAction(req, …)` helper, a `wrapperCall(label, ctx, fn)` helper that logs and throws `BadGateway`, and a `mutateMod(verb, run)` factory for the six mod handlers (about 120 lines removed). Move `busyKind` out of a route file.
- **Confidence:** verified.

#### [MEDIUM] CC-008: `ModsView.vue` is a three-feature god component (principle: SRP)
- **Location:** `web/frontend/src/views/ModsView.vue` (about 1,970 lines: template ~780, script ~830, CSS ~360).
- **Evidence:** it holds three separable features: the installed list (filter, sort, paging, selection, bulk actions, row actions), the upgrade check (about 20 computed values, URL-route sync, clipboard), and the Modrinth catalog (search, debounce, race guard, paging, version picker, install). It also contains two paging implementations (offset-based and page-number-based) and two near-identical pager blocks, a progress table and a result table that repeat the same cells, a pointless `resultColumns = checkColumns` alias, and magic values (`"en"` hard-coded for number formatting while dates use the user's locale). The recent additions grew it by about 300 lines.
- **Remediation:** split along the existing section comments: `InstalledModsPanel`, `ModCompatCheck`, `ModCatalog`, plus `useModSelection`, `useModSearch`, a shared `PagerNav` and a `ModCell`. `ModsView` keeps the header, the pending bar and wiring. Component boundaries are a judgment call.
- **Confidence:** verified for the structure.

#### [MEDIUM] CC-009: Prune and upgrade API adapters are hand-built in two views (principle: DRY, layer leak)
- **Location:** `views/PruneView.vue` ~L412-438, `views/UpgradeView.vue` ~L201-246; inline `apiGet`/`apiSend` in `StatusView.vue` and `App.vue`.
- **Evidence (verified):** `/upgrade/support` and `/prune/support` are spelled in both views. The map body is typed `PruneMap` in one view and `PruneMapBody` in the other, so the types already drifted. `UpgradeView` re-spells `/mods/compat*` although `useMods` already wraps it. A route rename needs edits in both views and nothing catches a miss.
- **Remediation:** `usePruneApi(server)` and `useUpgradeApi(server)` factories next to `usePrune`/`useServerUpgrade`; `UpgradeView` reuses `useMods().compat*`.
- **Confidence:** verified.

#### [MEDIUM] CC-010: Card, chip, footer and tap CSS is copied across views (principle: DRY)
- **Location:** `.card` (verified in `AuditView`, `BackupsView`, `ModsView`, variant in `StatusView`), `.card-head`, `.chip`, `.foot`, `.foot-count`, `.note`, `.stack-gap`, scoped `.sr-only` copies (`ModsView`, `BackupsView`, `ResponsiveTable`, `StatusChip`), and `.tap` copied into 17 SFCs with no global definition (verified).
- **Evidence:** 49 of 50 SFCs use scoped styles, so none of it is shared; a global `.sr-only` already exists in `style.css` with a different implementation than the copies, and some scoped `.dim` rules override the global one with a different token. A restyle (card border, chip height) needs three to four edits per selector, and drift has started.
- **Remediation:** move `.card`, `.card-head`, `.chip`, `.foot`, `.foot-count`, `.note`, `.stack-gap`, `.tap` into `style.css` or small components; delete the scoped `.sr-only`/`.dim` copies. Leave the diverged `.metric` variants alone until there is a design decision.
- **Confidence:** verified.

#### [MEDIUM] CC-011: Raw and resolved config types repeat each other and have drifted (principle: DRY, unsafe casts)
- **Location:** `schema/config.ts` `RawServerConfig` vs `ServerConfig`, `RawBotConfig` vs `BotConfig`; `core/config.ts` `resolveServerConfig` ~L90-118 and the field-by-field spread in `loadConfig` ~L268-296; `configDiff.ts` and `configGroups.ts` each carry their own key list.
- **Evidence:** adding an optional config field means editing both interfaces, the spread, `configDiff` and `configGroups`; a missed spread line silently drops the field from `BotConfig`. Drift exists: `milestones` is `PositiveNumber[]` in the raw type and `number[]` in `BotConfig` (verified), and `PositiveNumber = number` enforces nothing. `raw.apiUrl!`/`raw.apiKey!` are safe only because validation ran earlier, with no type-level proof. Defaults (15, 60_000, "weekly") are inline literals.
- **Remediation:** derive `BotConfig`/`ServerConfig` from the raw types (`Required<Pick<…>> & Omit<…>`), use `{...raw, servers, guilds, language, defaults}`, name the defaults as `CONFIG_DEFAULTS`, drop or enforce `PositiveNumber`.
- **Confidence:** verified (duplication, drift); strongly supported (silent-drop risk).

#### [MEDIUM] CC-012: The locale union "en" | "de" is repeated by hand (principle: duplicated value across a boundary, guideline 10)
- **Location:** `core/config.ts` ~L276, `core/configValidation.ts` ~L279/283, `schema/config.ts` (two union literals), `core/i18n.ts`, `backup.ts`, `glossary.ts` (`GlossaryLanguage`).
- **Evidence:** no `LANGUAGES` const exists, so adding a locale means editing about eight places; the validator's message hard-codes "(en, de)". `config.ts` silently coerces an unknown value to "en".
- **Remediation:** `LANGUAGES` const tuple, derived `Language` type and `isLanguage()` in `@mcbot/schema`, used everywhere above.
- **Confidence:** verified by the reviewer's grep.

#### [MEDIUM] CC-013: Bot modules open-code persistence against `kv`, bypassing the owner-store rule (principle: SRP, guideline 8)
- **Location:** `bot/interactions/whitelistApplications.ts` (~L98-134, including its trim policy), `log/consoleRelay.ts`, `monitors/milestoneWatcher.ts`, `monitors/updateNotifier.ts`, `schedulers/leaderboardScheduler.ts`, `schedulers/statusEmbed.ts`, `schedulers/channelPurge.ts`.
- **Evidence:** the key `"statusMessages"` is read and written by `statusEmbed.ts` and read by `channelPurge.ts` with a copied type (verified). A key or shape change needs both. Every store in `core/utils/stores/` hides its key; these do not. `loadState`/`saveState` in `statusEmbed.ts` and `loadStore` in `whitelistApplications.ts` are `async` with synchronous bodies.
- **Remediation:** move each into `core/utils/stores/<name>Store.ts` with typed load/update functions; both status-embed users share one store. `whitelistApplications` is the largest win (store, trim policy and types leave a 559-line Discord I/O file).
- **Confidence:** verified.

#### [MEDIUM] CC-014: Query results are cast in seven places despite guideline 9 (principle: type safety, consistency)
- **Location:** `core/utils/stores/linkUtils.ts` (~L140, L224, L240), `uptimeTracker.ts` (~L112, L131), `core/utils/minecraft/snapshotUtils.ts` (~L98), `core/utils/config/configHistory.ts` (~L90), `core/db/importLegacy.ts` (~L90, which also interpolates a table name into SQL).
- **Evidence:** `.get(...) as {…} | undefined` is the pattern `core/db/rows.ts` documents as the only audited cast; the grep confirms several. A renamed column compiles and returns `undefined`. `getLinkedAccount` is on the hot path of `/daily` and the nudges.
- **Remediation:** convert to `mapRow` with explicit `col.*`; add an ESLint `no-restricted-syntax` rule or a `layout:check` grep so it stays fixed; confirm `table` in `importLegacy` is only ever a literal from a const list.
- **Confidence:** verified.

#### [MEDIUM] CC-015: The per-guild alert broadcast loop is copied five or more times (principle: DRY)
- **Location:** `monitors/tpsMonitor.ts`, `downtimeMonitor.ts`, `hostResourcesMonitor.ts`, `upgradeMonitor.ts`, `report.ts`, `schedulers/leaderboardScheduler.ts`, `log/consoleRelay.ts`.
- **Evidence:** each repeats guilds, pick channel block, `serverInScope`, fetch channel, `"send" in channel` guard (12 occurrences in `src/bot`), locale wrap, mention, send, catch and log. `notifyGuilds.ts` states a "single implementation" goal but `broadcastNotification` covers only one config shape (six callers). "Channel is gone" detection is also duplicated (`statusEmbed.ts` and `chatBridge.ts`).
- **Remediation:** `sendToGuildChannels(client, guildConfigs, {pick, serverId, build, mention})` and `fetchSendable(client, channelId)` next to `broadcastNotification`; one shared Discord-error-code helper.
- **Confidence:** verified for the pattern; strongly supported that the blocks differ only in config key and mention policy.

#### [MEDIUM] CC-016: `bot/index.ts` `handleInteraction` is a ~170-line inline dispatcher (principle: SRP, KISS, consistency)
- **Location:** `bot/index.ts` ~L327-494.
- **Evidence:** `guildRouter`, `playerUtils` and three interaction modules are imported statically at the top and again dynamically per interaction; three copy-pasted try/catch blocks differ only in log tag; autocomplete hard-codes option names and a `commandName === "uptime"` special case, so a new command's autocomplete means editing the global dispatcher; the admin check is repeated in three files while `middleware.ts` has a private `invokerIsAdmin`; slash and in-game command loading repeat manifest building and skip logic, and only the in-game loader detects duplicate names.
- **Remediation:** export `invokerIsAdmin`, make imports static, loop over the three handlers, move autocomplete to a per-command registry, extract `dispatchSlash(interaction)`, share a `discoverModules(dir, validate)` helper.
- **Confidence:** strongly supported.

#### [MEDIUM] CC-017: Reconcile has inconsistent failure semantics and a key-order-sensitive comparison (principle: error handling, long function)
- **Location:** `bot/logWatcher/initMinecraftCommands.ts` `doReconcile` ~L342-450 and `initMinecraftCommands` ~L156-299.
- **Evidence:** when wiring an added server fails (~L384-392) the code logs but still returns the id in `added` and leaves an unwired instance registered, so the reload log says it was added; the `differing` path handles the same failure correctly. `JSON.stringify(inst.config) !== JSON.stringify(configured[id])` is key-order sensitive, so a reorder-only edit tears down and rewires a live server. Four consecutive try/catch blocks with the same warn pattern. Local `24 * 60 * 60 * 1000` literals although `core/utils/duration.ts` exports `MS.day`.
- **Remediation:** report add failures separately and unregister the half-created instance; compare with the existing deep-equal or `configDiff`; add a `safe(label, fn)` helper; use `MS.*`.
- **Confidence:** verified for the add-failure semantics (read in full by the reviewer); strongly supported for the rewire churn.

#### [MEDIUM] CC-018: Whitelist approval trusts the stored server id (principle: inconsistent pattern, guideline 7)
- **Location:** `bot/interactions/whitelistApplications.ts` `handleDecisionButton` ~L486 (`getServerInstance(app.serverId)`, verified) vs `handleModalSubmit` ~L337-349, which re-validates against the visible set.
- **Evidence:** guideline 7 names the resolver as the tenant-isolation enforcement point. Submission honours guild visibility; approval does not, so if visibility is narrowed after submission an admin could still whitelist on a now-hidden server. Not exploited; depends on the guild-scope model.
- **Remediation:** re-check `visibleServerIds(guildId)` at approval or add a guild-scoped resolver by id in `guildRouter`.
- **Confidence:** assumption-dependent.

#### [MEDIUM] CC-019: The note that justifies unchecked response casts is wrong (principle: misleading documentation, unsafe casts)
- **Location:** `core/utils/server/access/apiClient.ts` header (~L6-11) and the `res.json() as Promise<T>` sites; `access/manifest.ts` `verifyWrapperContract`.
- **Evidence:** the comment says a changed wrapper "would fail the version gate, not silently mis-shape a response". `verifyWrapperContract` only logs (documented "never throws") and runs once at startup; nothing gates a response. It also points to `MIN_WRAPPER_VERSION`, which `wrapperContract.ts` calls only a fallback floor. Readers will believe the casts are checked.
- **Remediation:** rewrite the note to state the real trade-off; for shapes that feed branching keep narrowing as `parseWrapperHealth` does, optionally add `apiGetChecked(cfg, route, guard)` for stats and list.
- **Confidence:** verified.

#### [MEDIUM] CC-020: Cache invalidation is inconsistent between config writes, reverts and mod mutations (principle: inconsistent pattern)
- **Location:** `web/backend/routes/modConfigs.ts` read, write and revert key handling (~L230, 261-265, 463-466, 515-516); `routes/mods.ts` `invalidateServer` ~L164-167.
- **Evidence:** write invalidates both the file and the index; revert invalidates only the file and does so before `revertConfigFile` succeeds. Mod mutations invalidate only the TTL entries, not the `readThrough("modsInstalled")` last-known copy, so a wrapper failure right after a mutation can serve the pre-mutation list as "stale". Keys are built by hand in three places.
- **Remediation:** `bustConfigFile(id, fileId)` and `bustMods(id)` helpers that do both `forget` and `invalidate`, with key builders defined once.
- **Confidence:** strongly supported (the stale-list behaviour is inferred from the cache code).

#### [MEDIUM] CC-021: Five query-int clamps and five boolean-flag conventions (principle: DRY, inconsistent patterns)
- **Location:** `routes/mods.ts` `clampInt`, `monitoring.ts` `clampCount`, `analytics.ts` `parseHours`/`clampHours` (all verified), inline in `backups.ts` and `servers.ts`; flags at `mods.ts` (`=== "true"`, `!== "false"`), `servers.ts` (`"1" || "true"`), `modConfigs.ts` (`=== "1"`).
- **Evidence:** zero is handled differently (`clampInt` accepts offset 0; `parseInt(..) || fallback` turns `lines=0` into 50); `dryRun=1` and `dryRun=true` work while `refresh=1` is silently ignored. The next route author copies one at random.
- **Remediation:** `routes/query.ts` with `clampIntParam(raw, {def, min, max})` and `flagParam(raw, default)`; optionally `Type.Boolean()` in the schemas.
- **Confidence:** verified.

#### [MEDIUM] CC-022: UI feedback and error-text helpers are re-implemented per file (principle: DRY, magic numbers)
- **Location:** about 22 `toast.add({…, life})` sites in 13 files; `messageOf` copied into `useModCompat.ts`, `usePrune.ts`, `useServerUpgrade.ts` (verified); `ModsView` `errorText`; inline variants in `useInstalledMods.ts` and `ModConfigView.vue`, despite `utils/errorMessage.ts`.
- **Evidence:** success lifetimes are 3000, 4000, 5000, 6000 and 8000 ms and error lifetimes 6000, 7000 and 8000 ms with no pattern. The same failure shows as "404: msg" in the Mods catalog and a bare "msg" elsewhere.
- **Remediation:** a `useNotify()` with `ok`, `warn`, `fail` and one lifetime table; `errorMessage(err, fallback?)` plus `apiErrorText(err)` in `utils/errorMessage.ts`; delete local copies. Convert incrementally.
- **Confidence:** verified.

#### [MEDIUM] CC-023: Retry-once loop duplicated, and `supportsTps` is a dead flag (principle: DRY, dead code)
- **Location:** `core/utils/server/server.ts` `getHealth` ~L155-170 and `getList` ~L190-202 (each declares `RETRY_DELAY_MS = 500`); `get supportsTps()` ~L340 (always returns `true`, verified) read by `status.ts`, `tps.ts`, `tpsMonitor.ts`, `statusEmbed.ts`.
- **Evidence:** four callers keep an unreachable else path. Seven dynamic `await import("./serverAccess.js")` calls in `ServerInstance` hide a dependency; the reason (cycle or `vi.mock`) is undocumented.
- **Remediation:** `retryOnce(fn, delayMs)` with one constant; delete `supportsTps` and its four dead branches; use static imports or comment the real reason for the dynamic ones.
- **Confidence:** verified for `supportsTps` and the duplication; assumption-dependent for the dynamic-import reason.

#### [MEDIUM] CC-024: `/api/commands` puts domain logic in the route (principle: SRP, testability)
- **Location:** `web/backend/routes/config.ts` ~L91-162 (about 70 lines), plus the repeated "write config, audit if changed, return `{ok, changed, warnings}`" tail in PUT ~L174-250 and rollback ~L253-320.
- **Evidence:** per-scope policy resolution and usage aggregation live inline, so they cannot be unit-tested without Fastify; the file uses `err instanceof Error ? … : "…"` where every other route uses `errMsg`.
- **Remediation:** move payload building to `core/utils/commands/` (`buildCommandsView`), extract `applyConfigWrite(candidate, session, note)` for PUT and rollback.
- **Confidence:** strongly supported.

#### [MEDIUM] CC-025: Chunk-region size 32 and its bit tricks are scattered through the prune map code (principle: magic values, DRY)
- **Location:** `PruneMap.vue` (about eight places), `pruneMapRender.ts`, `pruneCamera.ts`, `pruneSelection.ts` (`slot & 31`, `slot >> 5`, `32`); no `REGION_SIZE` constant exists in `schema` or `core`.
- **Evidence:** about 40 occurrences; `MAX_ZOOM = 32` in `pruneCamera.ts` is an unrelated 32 next to them.
- **Remediation:** export `REGION_CHUNKS`, `REGION_SHIFT`, `REGION_MASK` from one module; put them in `@mcbot/schema` if the backend scanner shares the value (guideline 10).
- **Confidence:** verified.

### Low

#### [LOW] CC-026: Dead and test-only exports (principle: YAGNI, dead code)
- **Location:** unreferenced: `parseErrorList` (`utils/errorMessage.ts`), `COLOR_KEYS` (`useEmbedColors.ts`), `VariablesMap` (`schema/config.ts`, re-exported in `core/types/index.ts`), `contractHasBlockingGaps` (`wrapperContract.ts`), `saveWaypointStore`. Reported by the slice reviewers as test-only or unreferenced and not individually re-checked: `saveNotesStore`, `savePollStore`, `savePendingRewards`, `loadLinkCodes`/`saveLinkCodes`, `loadAudit`, `msUntilMidnight`, `getPlayerCount`, `parseListOutput`, `addFieldsBulk`, `paginateLines`, `stopWatchingConfig`, `clearProjectIconCache`, `getBreakerState`, `statusLabel`, `playersLabel`, `tierLabel`, `describeStatus`, and unneeded `export` on `clientSecret`, `oauthClientId`, `redirectUri`, `manageableGuildIds`, `revalidateOpenStreams`, `ConfigKeyPath`, `MC_VERSION_PATTERN`. `PAGE_SIZE = 50` is declared in both `useBackups.ts` and `BackupsView.vue` (verified) and must change together.
- **Evidence:** the unused `save…` functions of `kvMutate`-based stores invite reintroducing CC-004. `contractHasBlockingGaps` has a 25-line explanation of "blocking" behaviour that does not exist.
- **Remediation:** delete zero-reference items; for test-only ones delete the export with its test; export `PAGE_SIZE` from `useBackups`. Re-verify each name before deleting (dynamic use).
- **Confidence:** verified for the named unreferenced items; strongly supported for the rest.

#### [LOW] CC-027: Stale comments and guards describing removed behaviour (principle: misleading documentation)
- **Location:** `access/scripts.ts` and `capabilityProbe.ts` (local mode, removed in 5.0.0), `host.ts` ("wrapper >= 1.2.0"), dead `if (!cfg.apiUrl)` guards and `cfg.apiUrl!` while `apiUrl` is a required `string`; `web/backend/server.ts` route map (omits mods, upgrades, prune, rewards, analytics, guildConfig, console policy) and swapped registration comments; headers still citing the removed `requireAdminSession` (`routes/config.ts`, `servers.ts`, `routes/auth.ts`, verified).
- **Evidence:** readers look for a gate that no longer exists and miss six route modules.
- **Remediation:** delete or fix the comments and dead guards; drop the stale route map or generate it from `app.printRoutes()`.
- **Confidence:** verified.

#### [LOW] CC-028: Versioned-store boilerplate is copied seven times (principle: DRY)
- **Location:** `isV1Store` guards in `challengeStore`, `noteStore`, `pollStore`, `sessionStore`, `tempBanStore`, `watchStore`, `waypointStore`.
- **Remediation:** a `versionedStore(key, validate, empty)` factory, or at least one shared `isVersionedStore(raw, containerKey)` guard.
- **Confidence:** strongly supported.

#### [LOW] CC-029: Module-level mutable map shared across modules (principle: hidden global state)
- **Location:** `access/manifest.ts` `advertisedScriptTimeouts` (written there, read in `scripts.ts`); `parseScriptTimeouts` in `wrapperContract.ts`.
- **Evidence:** populated only when the manifest is fetched; keys are `apiUrl#id`, so a re-pointed server leaves an orphan entry. `parseScriptTimeouts` drops any action not in the fallback table, so a new wrapper action gets the default timeout even if the wrapper advertises a longer one, contradicting the "never give up before it does" comment.
- **Remediation:** wrap in `getAdvertisedScriptTimeouts(cfg)`/`forget…` and let advertised keys through (bounds are already clamped).
- **Confidence:** strongly supported.

#### [LOW] CC-030: Wrapper feature names are plain strings (principle: stringly-typed contract, guideline 10)
- **Location:** `wrapperContract.ts` `EXPECTED_WRAPPER_FEATURES: Record<string, …>`, `manifest.ts` `wrapperFeatureVersion(feature: string)` (a bare `catch { return 0 }`).
- **Evidence:** a typo returns 0, which reads as "wrapper lacks the feature" and quietly disables it.
- **Remediation:** `as const` keys with a derived `WrapperFeatureName`; log at debug when the manifest is unavailable.
- **Confidence:** strongly supported.

#### [LOW] CC-031: Env-var name derivation duplicated and a doc comment on the wrong function (principle: DRY, misleading comment)
- **Location:** `core/config.ts` ~L120-136 (`applyEnvOverrides` undocumented, `envSuffix` double documented), `configValidation.ts` ~L250 (inline copy of the same transform).
- **Evidence:** the validator's error text names the env var an operator must set; if `envSuffix` changes, the message names a variable the loader does not read.
- **Remediation:** export `apiKeyEnvVar(id)` and use it in both; move the JSDoc back.
- **Confidence:** verified.

#### [LOW] CC-032: `statusEmbed.ts` mixes presence logic and derives severity from a colour (principle: SRP, type safety)
- **Location:** `bot/logWatcher/watchers/schedulers/statusEmbed.ts` (`updateBotPresence` ~L552-628 with module state; `severityOf` ~L322; channel `as TextChannel` casts ~L134-139; `buildServerField` ~100 lines).
- **Evidence:** `SEVERITY_ORDER.indexOf(color)` with `Math.max(0, -1)` makes an unknown colour read as "Online"; if palette values change, severity silently misorders. Constants used before declaration; presence default strings are bare literals.
- **Remediation:** move presence to its own module; have `describeHealth` return a numeric severity; use `isTextBased()`/`ChannelType` guards.
- **Confidence:** verified.

#### [LOW] CC-033: Support probes and response shaping repeated in backend routes (principle: DRY, magic values)
- **Location:** `compatSupported`/`upgradeSupported`/`pruneSupported` in `mods.ts`, `upgrades.ts`, `prune.ts` (the 501 handling is inline in two and wrapped in `requireSupport` in one); `slice(-4000)` for script output in `servers.ts` and `backups.ts`; `FILE_ID_RE` in `backups.ts` and `modConfigs.ts` (verified); repeated id regexes in `schemas.ts`; handler-local TTL literals.
- **Remediation:** one `capabilityProbe(name, supportsFn)`; a `scriptResultBody(result)` helper; shared id pattern constants; hoist TTLs.
- **Confidence:** verified.

#### [LOW] CC-034: Non-null session assertions and repeated double-casts (principle: unsafe casts)
- **Location:** `sessionFromRequest(req)!` (31 sites, see CC-007), `req.body.edits as ConfigEdit[]` in `modConfigs.ts`; `type: null as unknown as PropType<unknown>` in `ArrayField.vue`, `MapEntry.vue`, `MapField.vue`, `SchemaField.vue`; `as unknown as` in `useSchemaRefs.ts` and `useEditableDocument.ts`.
- **Evidence:** the `!` is safe only because `capabilityGate` runs first; a route registered in another scope turns it into a 500 `TypeError`.
- **Remediation:** `requireSession(req): Session` that throws `Unauthorized`; one shared `anyValueProp` constant (or `defineModel<unknown>` after a `<script setup>` move); fix the two generic casts at their source.
- **Confidence:** strongly supported.

#### [LOW] CC-035: Mod search swallows lookup failures silently (principle: swallowed errors)
- **Location:** `web/backend/routes/mods.ts` search ~L522-575 and catalog ~L577-613, `withIcons` `.catch(() => new Map())`, release versions `.catch(() => [])`.
- **Evidence:** a failed "installed" lookup silently drops the loader and game-version filter and returns unrestricted results with no log line. Degrading is the documented intent; recording it is missing.
- **Remediation:** `installedOrNull(id, cfg)` that logs at debug or warn; move param normalisation next to `searchProjects`.
- **Confidence:** strongly supported.

#### [LOW] CC-036: `PruneMap.vue` keeps drawing, gestures and keyboard in one closure (principle: SRP, long function)
- **Location:** `web/frontend/src/components/PruneMap.vue` (script ~780 lines; `drawOverlay` ~120 lines, `onKey` ~60 lines).
- **Evidence:** the pure parts already live in `pruneCamera`, `pruneTiles`, `pruneSelection`, `pruneMapRender`, so the pattern exists; the remainder is not unit-testable.
- **Remediation:** extract `drawOverlay`/`drawChunkMarks` into a pure render module and the pointer/keyboard handlers into `usePruneMapInput`. Lower priority than CC-007 to CC-010.
- **Confidence:** strongly supported.

#### [LOW] CC-037: Options API and `<script setup>` mixed for the same job (principle: consistency)
- **Location:** 23 SFCs use `defineComponent` (for example `App`, `BackupsView`, `RewardsView`, `ConfigView`, `StatusView`, `SchemaField`), while `ModsView`, `PruneView`, `UpgradeView`, `PruneMap` use `<script setup>`.
- **Evidence:** `BackupsView.setup()` spreads composable returns into the options object, which defeats inference and needs `this.can`, `this.toast` and casts in `data()`.
- **Remediation:** use `<script setup>` for new and touched views and migrate when a file is next edited. No bulk rewrite.
- **Confidence:** verified (counts); strongly supported (cost).

### Deeper pass: `src/core/utils/**` (CC-038 to CC-066)

This pass read every file under `core/utils/` (`commands`, `config`, `configfmt`, `minecraft`, `server`, `stores`, `wrapper` and the top-level utilities). Findings already covered above are cited, not repeated.

#### High

##### [HIGH] CC-038: A used link code can be replayed to rebind another player's Discord link (principle: correctness, data integrity)
- **Location:** `core/utils/stores/linkUtils.ts` `confirmLinkCode` L214-253 (`confirmed` is read at L222 but never tested; the upsert at L245-248 is `ON CONFLICT(discord_id) DO UPDATE SET mc_name = excluded.mc_name`); caller `bot/logWatcher/commands/connection/link.ts` L28-65.
- **Evidence (read by the lead reviewer):** the code is typed in game chat as `!link CODE`, so other players can see it. After a successful link the row stays with `confirmed = 1` until its 5-minute expiry; `issueLinkCode` prunes it only when the same Discord user runs `/link` again. In that window another player running `!link CODE` with an unlinked name passes the expiry and name-taken checks and reaches the upsert, which silently replaces the first player's Minecraft name on the victim's Discord account. The only throttle is a 3 s per-username cooldown. Effects: daily rewards and streak go to the wrong player, and the linked role syncs to the wrong person. Not executed.
- **Remediation:** return `unknown-code` (or a new `already-used`) when `entry.confirmed === 1`, or delete the row on success. Drop the silent `DO UPDATE` rebind or make it explicit. Add a regression test that confirms the same code twice.
- **Confidence:** verified by reading the code; exploitability strongly supported, not run.

##### [HIGH] CC-039: An explicit empty `allowedServers` list fails open (principle: unsafe default, change-safety)
- **Location:** `core/utils/server/guildTargets.ts` `allowedServerIdsIn` ~L74-82.
- **Evidence (read by the lead reviewer):** `guild.allowedServers ? new Set(...) : referencedServerIds(guild)` treats `[]` as truthy and builds an empty set; `if (allowed.size === 0) return null` then means "unrestricted" (the legacy path for guilds that reference nothing). An operator who writes `allowedServers: []` to deny a guild gets the opposite in a multi-guild deployment, as long as the guild has no `defaultServer` (which is added to the set before the check). The `configValidation` warning at ~L443 is skipped because `[]` is truthy. No test covers an empty list.
- **Remediation:** distinguish unset from explicit empty: return an empty set (deny) for `[]`, or reject it in validation. Add a regression test. This belongs with CC-003, which already centralises the scope logic.
- **Confidence:** verified by reading; not executed.

#### Medium

##### [MEDIUM] CC-040: The Minecraft version parser cannot read year-based versions (principle: parsing fragility)
- **Location:** `core/utils/minecraft/versionName.ts` `MC_VERSION` (~L44) and `parseVersionName`; consumers `bot/commands/info/{info,status}.ts` and `server.ts` `getMinecraftVersion`.
- **Evidence (regex read by the lead reviewer):** the pattern requires a leading `1.` (`/\b(1\.\d{1,2}(?:\.\d{1,2})?)\b/`). The code base itself documents Minecraft 26.3 (`serverLine.ts`). A "26.1" string yields no version, and "26.1.2" matches `1.2`, so `/status` and `/info` drop or misreport the version, and `clickFormatForVersion` always falls back to "both". The existing test covers only 1.x strings. Behaviour derived from the regex, not run.
- **Remediation:** accept both schemes (for example `\d{1,2}\.\d{1,2}(?:\.\d{1,2})?` with a suitable anchor), and add 26.x test cases.
- **Confidence:** verified (regex); strongly supported for the visible effect.

##### [MEDIUM] CC-041: A connect timeout is reported as "refused", which health maps to Offline (principle: misleading semantics, correctness)
- **Location:** `core/utils/server/serverPing.ts` timeout handler ~L275-283 (`kind: "refused", reason: "connect timed out"`) and the close-before-connect branch; consumed in `access/health.ts` ~L173-180.
- **Evidence (read by the lead reviewer):** the type documents `refused` as the strongest evidence that nothing is running, but a filtered port, slow host or full accept queue also times out before connecting. Only ECONNREFUSED, EHOSTUNREACH and ENETUNREACH are real refusals. A pre-connect timeout therefore becomes a definitive Offline state, which feeds status and downtime alerts. The `error` kind already maps to Unknown.
- **Remediation:** return `kind: "error"` for a timeout before connect and for a close before connect; keep `refused` for the errno set. Add a test.
- **Confidence:** verified for the mapping; strongly supported that it is user-visible.

##### [MEDIUM] CC-042: `deliverPendingRewards` loses queued rewards if anything throws after the take (principle: error handling, change-safety)
- **Location:** `core/utils/minecraft/rewards.ts` `deliverPendingRewards` ~L166-219.
- **Evidence (read by the lead reviewer):** entries are removed from the store first, then given in a loop; the re-queue of `remaining` runs only after the loop, with no `try/finally`. If `give` throws or the process stops mid-loop, every entry not yet attempted is gone, not only the failed one. Only the "delivered but unconfirmed" case is handled. Whether `server.send` can throw was not fully traced. Extends CC-005.
- **Remediation:** wrap the loop in `try/finally` that re-queues `remaining` plus all entries not yet attempted, or make `give` documented never-throwing.
- **Confidence:** verified for the structure; strongly supported for the loss.

##### [MEDIUM] CC-043: Queued-edit preview and flush write the same gate twice and can disagree (principle: DRY, change-safety)
- **Location:** `core/utils/wrapper/queueFlush.ts` `flushQueuedEdits` ~L83-121 vs `previewQueuedEdits` ~L175-185.
- **Evidence:** the flush skips a file when `current.file.editable === false` or `parseConfig(...).warning`; the preview omits that check, so `ready` can count edits the flush will skip, although the doc comment promises they cannot disagree. A bare `catch {}` in the preview files parse exceptions under "unreadable". Each file is parsed twice in the flush. This is a third place for the guard sequence in CC-006.
- **Remediation:** extract one `planFile(server, fileId, queued)` returning `unreadable | readOnly | ready(plan, etag)`, used by both.
- **Confidence:** verified by the slice reviewer (not independently re-read).

##### [MEDIUM] CC-044: `deriveEnvironment` mislabels server-unsupported mods as "optional" (principle: correctness, misleading comment)
- **Location:** `core/utils/modrinth.ts` `deriveEnvironment` ~L44-55.
- **Evidence (read by the lead reviewer):** (client `optional`, server `unsupported`) matches none of the explicit branches and falls through to `"optional"`, which the doc comment calls "safe to install", although the mod does nothing on a server. `hideClientOnly` filters only `"client"`, so these hits survive the default filter. Missing data also falls through to `"optional"`.
- **Remediation:** `server_side === "unsupported"` with a non-unsupported client maps to `"client"`; missing data maps to `"unknown"`; add table-driven tests.
- **Confidence:** verified (code); whether Modrinth has such mods was not checked.

##### [MEDIUM] CC-045: YAML multi-line plain scalars: an edit silently changes the value (principle: correctness, splice)
- **Location:** `core/utils/configfmt/yaml.ts` `parseValue` ~L30-87 and the `parse` loop ~L110-182; reparse guard in `configfmt/index.ts` `applyConfigEdits` ~L138-161.
- **Evidence:** a plain scalar continued on indented lines exposes only its first line as the value; editing replaces only that line, so the continuation is still folded onto the new value. The reparse guard passes because the parser never sees the continuation either. A continuation line containing `word: x` matches the key pattern and becomes a phantom editable node. The header comment lists multi-line quoted scalars as unsupported but says nothing about plain ones. Code reading only, not executed.
- **Remediation:** treat lines indented deeper than the key after a plain or quoted value as continuation; mark the node read-only or skip it; add a folded-value test.
- **Confidence:** strongly supported.

##### [MEDIUM] CC-046: `entityDataPattern` strips `.` from player names, so Bedrock players never match (principle: parsing fragility, inconsistent name handling)
- **Location:** `core/utils/minecraft/consoleResponse.ts` `entityDataPattern` ~L48-51 (read by the lead reviewer); caller `server.ts` ~L309.
- **Evidence:** the name is reduced to `[A-Za-z0-9_]`, but `sanitize.ts` `MC_NAME_REGEX` and the guidelines use `[\w.]`. For `.Steve` the pattern becomes `^Steve has the following entity data` and never matches `.Steve has …`, so coordinates and dimension lookups fail for Floodgate players. `playerUtils.parseNextLinesPlayers` encodes a third name class without `.`.
- **Remediation:** gate on `isValidMcName` and escape regex metacharacters instead of deleting characters; share one name pattern constant.
- **Confidence:** strongly supported.

##### [MEDIUM] CC-047: Whitelist caches re-implement `cache.ts` without its protections, and `forceReload` is dead (principle: inconsistent pattern, boolean flag)
- **Location:** `core/utils/minecraft/whitelist.ts` ~L19-103 (`loadKnownPlayers`, forceReload branch ~L83-88).
- **Evidence:** `statUtils.ts` uses `cached()` (in-flight dedup and a generation guard so a read started before an invalidation cannot write stale data back); `whitelist.ts` has two hand-rolled maps with neither, so concurrent misses duplicate wrapper calls and an invalidation during a read is overwritten. The `forceReload` branch is unreachable for `loadKnownPlayers`: the five call sites I found all pass `false`. The signature puts a defaulted flag before a required parameter.
- **Remediation:** wrap both reads in `cached()` and use `invalidate`; change to `loadKnownPlayers(server)` and a separate reload entry point; delete the dead branch.
- **Confidence:** verified.

##### [MEDIUM] CC-048: Wrapper access repeats the "404 means null" idiom and the feature-support check (principle: DRY, inconsistent patterns)
- **Location:** 404-to-null at nine sites: `access/upgrade.ts` (`getUpgrade`, `getCurrentUpgrade`), `modCompat.ts` (`getModCompat`), `prune.ts` (`getPruneScan`, `getPruneMap`, `getPruneChunk`, `getPruneTile`, `cancelPruneScan`), `stats.ts` (`readStats`, `readAllStats`). Support checks: `upgrade.ts` `supportsUpgrade`/`supportsLifecycleEvents`, `prune.ts` `supportsPrune`, `modCompat.ts` `supportsModCompat`, versus the cached `wrapperFeatureVersion` in `manifest.ts`.
- **Evidence:** each site repeats `apiGetRaw`, `404 → null`, `readApiJson`, with the route string built twice; `getPruneTile` caps the error body at 200 while `ApiError` caps at 300; `cancelPruneScan` uses a try/catch for the same rule. The four `supports*` functions call `getRemoteManifest` directly (an uncached fetch with an 8 s timeout), so callers each added their own cache (`routes/upgrades.ts`, `routes/prune.ts`, `routes/mods.ts`, a `supportCache` in `upgradeMonitor.ts`) with separate TTL constants. Extends CC-001 and CC-033.
- **Remediation:** add `apiGetOrNull<T>(cfg, route, timeoutMs?)` to `apiClient`; build `featureAtLeast(cfg, name, minVersion)` on the cached `wrapperFeatureVersion`, define the `supports*` functions through it, and keep exactly one cache layer.
- **Confidence:** verified by the slice reviewer.

##### [MEDIUM] CC-049: Uptime retention is count-based while the guarantee is time-based, and stats load the whole table (principle: change-safety, efficiency)
- **Location:** `core/utils/stores/uptimeTracker.ts` `MAX_ENTRIES = 43_200` (~L15), `recordCheck` ~L30-45, `getUptimeStats` ~L137-215, `uptimeSince`, `lastOnlineStreakStart`; interval in `downtimeMonitor.ts` (`CHECK_INTERVAL_MS`).
- **Evidence:** the comment states a 30-day requirement, the code encodes "one check per minute"; changing the interval or adding a second `recordCheck` caller silently shrinks or stretches the window, the regression the comment says already happened once. `getUptimeStats` selects up to 43,200 rows into JS on every call and recomputes the current streak that `lastOnlineStreakStart` already computes in SQL; callers are `/status`, `/uptime` and two dashboard routes (every dashboard poll).
- **Remediation:** delete by time (`t < now - 30 d`) with a row cap only as a safety net; use `uptimeSince` for the 24 h/7 d/30 d totals and load only the last 24 h of rows for the sparkline.
- **Confidence:** verified by the slice reviewer.

##### [MEDIUM] CC-050: Time constants ignore `MS`, and the streak grace rule is written twice (principle: magic values, DRY)
- **Location:** `rewards.ts` (`DAILY_COOLDOWN_MS = 24*60*60*1000`; `2 * DAILY_COOLDOWN_MS` in `liveStreak` ~L54 and `calcStreak` ~L67), `snapshotUtils.ts`, `playerRoster.ts`, `commandUsage.ts`, `featureNudges.ts`, `deferredIntents.ts`, `lastKnown.ts`, `suggestionLedger.ts`, `uptimeTracker.ts`, `playerCountHistory.ts`, `linkUtils.ts`, `rateLimiter.ts`, `relativeTime.ts` (own `MINUTE_MS`/`HOUR_MS`/`DAY_MS`), `configHistory.ts`, `atomicWrite.ts`, `modrinth.ts`; `duration.ts` itself keeps its unit list in three places (`UNITS`, the `SEGMENT` regex, and the table in `formatDuration`), and has two renderers (`formatDuration`, `formatSpan`) that print the same span differently.
- **Evidence:** `MS` exists in `duration.ts`. `liveStreak`'s comment says it must break "the same rule `calcStreak` breaks it by", yet the 2x rule is two separate expressions, so changing one makes `/streak` show a streak the next claim resets. `featureNudges` has a second default cooldown literal (48 h) in `nudgeSettings` besides `NUDGE_COOLDOWN_MS`. Adding a duration unit needs three edits. A ban of "31d" renders "1mo 13h" via `formatDuration` while about ten embeds use `formatSpan`.
- **Remediation:** `STREAK_GRACE_MS` shared by both streak functions (with `DAILY_COOLDOWN_MS = MS.day`); use `MS.*` everywhere; derive the `SEGMENT` regex and format table from one unit list; unify the two duration renderers with a style option and an `isFinite` guard.
- **Confidence:** verified (counts and the two streak expressions).

##### [MEDIUM] CC-051: The config-format adapters repeat the same scanners and literal logic, and have already drifted (principle: DRY)
- **Location:** `core/utils/configfmt/toml.ts` (five quote-aware scanners: `splitKeyPath`, `headerBody`, `splitTrailingComment`, the `parseArray` split loop, `bracketDelta`); the `literal()` prologue in `colonText.ts`, `ini.ts`, `forgeCfg.ts`, `yaml.ts`, `toml.ts`; the comment-block prologue in `formats.ts`, `ini.ts`, `forgeCfg.ts`, `toml.ts`, `yaml.ts`.
- **Evidence:** each scanner re-implements the in-quote/escape state machine with slightly different escape handling, and span and comment detection (which splice correctness rests on) depend on all five agreeing. The boolean, number and "cannot contain a line break" branches are copied across adapters; the "layout the editor cannot rewrite safely" message is spelled in three places. The drift is already visible (see CC-057).
- **Remediation:** one `scanOutsideQuotes(text, visit)` iterator in `lines.ts`/`toml.ts`; one `scalarLiteral(value, kind, node, opts)` and shared `ConfigEditError` message constants; a `CommentBlock.addLine` that strips the marker.
- **Confidence:** verified by the slice reviewer.

##### [MEDIUM] CC-052: The config-change summary omits live top-level keys (principle: change-safety)
- **Location:** `core/utils/config/configDiff.ts` `TOP_LEVEL_KEYS` ~L21-32 (read by the lead reviewer); keys defined in `schema/config.ts` (`timezone`, `schedules`).
- **Evidence:** the hand list has ten keys and no `timezone` or `schedules`, which `timezones.ts` reads, so a `/config reload` that changes them gets no summary line. The three `as unknown as Record` casts and their long justification (~L83-120) exist only because of the hand-picked list. `configDiff` also compares blocks with a key-order-sensitive `JSON.stringify` (`stable`) while `guildConfigHash.ts` has an order-independent `canonical`, so a reordered block is "changed" in one and identical in the other.
- **Remediation:** diff all top-level keys except `servers` and `guilds` with an explicit exclude list (which removes the casts); export one `stableStringify` and use it in both.
- **Confidence:** verified (the list); strongly supported (the order difference).

##### [MEDIUM] CC-053: The Modrinth client duplicates the shared HTTP helper and its constants (principle: DRY, inconsistent error handling)
- **Location:** `core/utils/modrinth.ts` `getJson` ~L147-170 and inline `err instanceof Error ? … : String(err)` (~L155, 167, 396) vs `http.ts` `fetchJson` ~L61-95; `minecraft/modUtils.ts` ~L42 and ~L119 (a second Modrinth base URL and User-Agent); icon handling at ~L187 and ~L321 vs `cdnIcon` ~L367-375.
- **Evidence:** `http.ts` states it replaced exactly this hand-written fetch sequence, and `mojang.ts`, `modUtils.ts` and `updateNotifier.ts` use it; `modrinth.ts` is the holdout. The inline ternary drops `err.cause`, where undici puts the real reason, so errors read "Modrinth unreachable: fetch failed". Two base URLs and two User-Agents must change together (Modrinth can block by User-Agent). The bulk path restricts icon URLs to the Modrinth CDN, the search-hit and detail paths pass any upstream string. `modUtils` also sends every slug in one query string without batching (URL-length limit assumed, not reproduced).
- **Remediation:** rebuild `getJson` on `fetchJson` with a small failure-to-`ModrinthError` map; use `errMsg`; share the base URL and User-Agent constants; use `cdnIcon` on all paths; chunk slugs.
- **Confidence:** verified (duplication); assumption-dependent (URL limit).

##### [MEDIUM] CC-054: Best-effort `catch` blocks hide failures, and two fail open (principle: swallowed errors, inconsistent patterns)
- **Location:** `server/access/stats.ts` `deleteStatsFile` ~L83-91; `access/mods.ts` `readModSlugs` ~L27-40; `minecraft/statUtils.ts` `loadAllStatsUncached` ~L286-291; `commands/commandUsage.ts` read queries ~L97-144; `commands/commandPolicy.ts` ~L60-65 and ~L83-88; `minecraft/featureNudges.ts` `nudgeSettings` ~L76-85; `config/timezones.ts` ~L52-73; `i18n.ts` ~L69-76; `stores/waypointStore.ts` `waypointCap`.
- **Evidence:** the comments justify the catches for "older wrappers", but they also hide timeouts, 5xx, auth failures and breaker-open, and leave no log line. `deleteStatsFile` failures become `{deleted: 0}` plus an audit line "0 stats files deleted" after N sequential 8 s timeouts. `loadAllStatsUncached` then fans out per-uuid requests against a wrapper that is already failing. `commandUsage` read failures show as "no usage" with only a debug log. The `loadConfig()` try/catch is copied with opposite defaults: `commandPolicy` fails open (any `adminOnly: true` or `enabled: false` override is silently dropped on error, with no log), `nudgeSettings` fails closed.
- **Remediation:** catch only the specific "not supported" error (`ApiError` 404/405) and log or rethrow the rest; one `tryLoadConfig()` helper that logs once, with the fail direction decided per caller (policy should fail closed outside tests and the schema generator).
- **Confidence:** verified for the code shape; strongly supported for the effects.

##### [MEDIUM] CC-055: Per-player maps are keyed by raw player names on plain objects (principle: correctness, hidden-state safety)
- **Location:** `core/utils/stores/sessionStore.ts` `openSession` ~L89-92 (`players[key] ??= {...}`), `getServerSessions`; `dailyStore.getServerPending`; `suggestionLedger.ts` (prefixed keys, partly safe) and `tempBanStore` (prefixed, safe).
- **Evidence:** a valid offline-mode name such as `__proto__` makes `players["__proto__"]` return `Object.prototype`; `??=` does not assign, so `entry.name = player` sets `Object.prototype.name` process-wide and the next line throws. A player named `constructor` yields the `Object` function and a `TypeError` in strict ESM on assignment. This happens inside the load/save cycle of CC-004. Not run; whether `joinLeave.ts` passes unvalidated names was not confirmed.
- **Remediation:** key these maps with `Object.create(null)` or a `Map`, or prefix the key as `suggestionLedger` does; alternatively reject those names at the store boundary.
- **Confidence:** strongly supported (JavaScript semantics).

#### Low

##### [LOW] CC-056: `writeConfig` re-implements the atomic write (principle: DRY, SRP)
- **Location:** `core/utils/config/configService.ts` `writeConfig` ~L138-160 vs `atomicWrite.ts` ~L59-72.
- **Evidence:** both do sweep, temp sibling, exclusive write with the existing mode, rename and `rm` on failure; a policy change (fsync, Windows rename retry, `.bak` handling) has to be made twice. The `.bak` is copied from a second read after `previous` was already read (a small TOCTOU gap, so the `.bak` can differ from the history snapshot).
- **Remediation:** add an async `writeFileAtomic` (with an optional pre-rename hook) to `atomicWrite.ts`; write the `.bak` from `previous`.
- **Confidence:** verified by the slice reviewer.

##### [LOW] CC-057: Edit validation is uneven across the config formats (principle: inconsistent pattern, correctness)
- **Location:** integer enforcement only in `configfmt/forgeCfg.ts` `literal` ~L143-148 (not in `toml.ts`, `ini.ts`, `yaml.ts`, `colonText.ts`, `checkValueKind` in `index.ts`); `formats.ts` `jsonFormat.parse` ~L226-240 does not call `markDuplicates` (the other six adapters do).
- **Evidence:** writing `1.5` into an integer setting is accepted in four formats because the reparse yields the same number; numbers beyond 2^53 lose precision with no `isSafeInteger` guard. With duplicate JSON keys, an edit changes the first occurrence while most consumers use the last, and the post-edit check passes because it finds the first node.
- **Remediation:** record an int hint at parse time and enforce it in the shared literal helper (CC-051); reject unsafe integers; apply `markDuplicates` in the JSON adapter.
- **Confidence:** verified (integers); strongly supported (JSON duplicates).

##### [LOW] CC-058: Wrapper timeout ceilings are inline literals (principle: magic values)
- **Location:** `access/mods.ts` (130_000 three times, 610_000), `access/prune.ts` (60_000, 100_000, 30_000), `backups.ts` (named constants), `apiClient.ts`, `manifest.ts` (8_000, 30_000).
- **Evidence:** the "wrapper limit plus margin" rule is stated in prose only for restore and the tile read; if the wrapper changes a limit nothing points at these numbers.
- **Remediation:** one documented `WRAPPER_TIMEOUTS_MS` table used by all three files.
- **Confidence:** verified.

##### [LOW] CC-059: Small coupling and duplication in the `server/` helpers (principle: SRP, guideline 10)
- **Location:** `access/hostResources.ts` (~L19-57 redefines `DiskUsage`, `ProcessUsage`, `MachineUsage` that exist in the wire types; takes a whole `ServerInstance` only to read `server.config`; validates `disks` but passes `process` and `machine` through unchecked); `runtimeHeartbeat.ts` (`STALE_AFTER_MS` documented as 2.5 intervals but a separate literal; `startRuntimeHeartbeat` does not retain its interval handle, so a second call leaks one; `noteConfigApplied` silently does nothing before start); `capabilities.ts` (`capabilitySummary` omits `restore`, `upgrade` and `prune`; `capabilityCommandSkips` hard-codes command names and English reasons; header points to the wrong file); `configAccessError.ts` (two status concepts, the wrapper's status and the route's HTTP status, kept in parallel tables; the "1 MB" limit in message text; `rate-limited` produced in two places); `capabilities.ts` and `guildTargets.ts` import `t` through the self-package alias while the rest of core uses the relative path; `guildTargets.ts` reads global `loadConfig()` while its header says it has no such dependency.
- **Remediation:** alias the wire types and take `cfg` instead of the instance; derive `STALE_AFTER_MS` from the interval and guard double start; generate the capability summary from `ServerCapabilities` keys; put the HTTP status on the error or export one table; define the size limit once; use the relative import in core.
- **Confidence:** verified for the specifics listed; strongly supported for the coupling.

##### [LOW] CC-060: `sanitizeForConsole` is unused in production and its escaping is wrong; raw console strings bypass sanitising (principle: dead code, unsafe helper, guideline 6)
- **Location:** `core/utils/sanitize.ts` `sanitizeForConsole` ~L35-44 (production references: none, only a comment in `routes/console.ts`; one test file imports it); raw `server.send` templates in `minecraft/rewards.ts` `give` ~L128-130, `serverMessages.ts`, `whitelistAdd.ts`, `unwhitelist.ts`, `sleepWatcher.ts`.
- **Evidence:** it escapes `"` but not `\`, so `a\"b` becomes `a\\"b`, which re-opens the quote, and it slices after escaping so a cut can end on a lone backslash. The guidelines tell authors to go through it. `serverMessages.ts` claims to be the single way the bot talks to players but sanitises nothing; `give` interpolates `amount` without a number check and `player` without `isValidMcName` (item data is admin-authored, so the risk is low).
- **Remediation:** delete `sanitizeForConsole` (or fix both problems) and point the guideline at `stripControlChars`/`sanitizeForComponent`; add a `consoleCommand()` builder in `serverMessages.ts` that applies name and number validation, and route `give`, title and whitelist through it.
- **Confidence:** verified (no production caller; escaping read); strongly supported (the rest).

##### [LOW] CC-061: More dead and test-only code, adding to CC-026 (principle: YAGNI)
- **Location:** `minecraft/playerUtils.ts` (the screen-log parsing block: `stripLogPrefix`, `stripTags`, `parseListOutput`, `findLastPlayerLine`, `parseCounts`, `parseInlinePlayers`, `parseNextLinesPlayers`, about 125 of 206 lines, referenced only by tests; the doc comments on `getPlayerCount`/`getOnlinePlayers` say "falls back to log parsing", which is false); `stores/linkUtils.ts` `saveLinkedAccounts` (no production caller; a whole-table DELETE and re-INSERT that races the atomic operations, so more than dead code); `stores/dailyStore.ts` `saveClaimedStore`; `stores/uptimeTracker.ts` `flushUptimeHistory` (a documented no-op still wired into `bot/index.ts` shutdown and `installProcessGuards`, verified); `stores/playerCountHistory._resetSamplerStateForTesting` and several unreferenced exported constants; `access/stats.ts` `readLevelName`; `access/upgrade.ts` `supportsLifecycleEvents`/`readLifecycleEvents` (barrel plus one export test); `access/logs.ts` `logStreamUrl`; `i18n.ts` `plural()` (no caller) and a second plural mechanism in `t()`; `configService.validateCandidate` (pass-through); `eventTips.ts` `EventTip.surface` field and several unneeded exports.
- **Evidence:** reference counts from the slice reviewers' scripts and greps; the `flushUptimeHistory` wiring and the `saveLinkedAccounts` test-only use were re-checked by the lead reviewer.
- **Remediation:** delete zero-reference items (with their tests); remove `flushUptimeHistory` from the shutdown path in the same change; fix the two false comments.
- **Confidence:** verified for the named items checked; strongly supported for the rest.

##### [LOW] CC-062: Stale or history-narrating comments (principle: misleading documentation)
- **Location:** `stores/playerCountHistory.ts` header (describes a JSON file; it is a SQL table), `dailyStore.ts` (`claimedDaily.json`), `uptimeTracker.ts` (`uptimeHistory.json`, a dangling JSDoc above `buildSparkline`); `minecraft/modUtils.ts` header and "no timeout before" notes (local mode removed in 5.0.0, see CC-027), `rewards.ts` and `eventTips.ts` ("the first version of this…"); `access/mods.ts` dangling comment block, `circuitBreaker.ts` stacked JSDoc; `access/backups.ts` error labels `POST /backups/restore` and `DELETE /backups/files` do not match the real routes, so `ApiError.route` in logs is misleading; `stores/linkUtils.ts` is a store named `utils`.
- **Remediation:** rewrite to current behaviour, pass the real route into `ApiError`, rename `linkUtils.ts` to `linkStore.ts` when next touched.
- **Confidence:** verified.

##### [LOW] CC-063: `nextTimeOfDayEpoch` is an hour off around DST transitions (principle: correctness)
- **Location:** `core/utils/time.ts` `nextTimeOfDayEpoch` ~L135-150 with `getTzOffsetMs` ~L89-105; callers `restartScheduler.ts` and `leaderboardScheduler.ts`.
- **Evidence:** the offset is sampled at the naive UTC instant rather than at the result. The slice reviewer ran a probe: 04:00 America/Denver on 2026-03-08 (spring-forward) produced 11:00Z, which is 05:00 local. Times within the offset of a transition are an hour off, twice a year, in any zone. Callers' tests were not checked for this case.
- **Remediation:** recompute the offset at the first result and re-derive once; add a transition-day test.
- **Confidence:** verified by the reviewer's probe (not re-run by the lead reviewer).

##### [LOW] CC-064: Smaller robustness items (principle: error handling, resource safety)
- **Location and evidence:**
  - `sseLineStream.ts` ~L175-195: if `onData` throws, the catch reports a stream error and reconnects without aborting the old connection, so a second connection opens; the frame buffer has no size cap (CRLF framing would grow it); `_stopped` duplicates `_state`; fetch errors use `String(err)` and lose the cause.
  - `logger.ts` ~L91-95: object arguments go through `JSON.stringify`, so an `Error` prints as `{}` and a circular object throws inside the logger; module-level state plus an import-time `initFileLogging()` side effect (mkdir and a stream under `process.cwd()/logs`) make every importing test touch the real logs directory.
  - `relativeTime.ts` `relativeAge` ~L77-91: `Math.round` makes 59.5-60 min print "60 min ago", contradicting its own stated ladder rule.
  - `commands/commandManifest.ts`: the pending list never shrinks, so a second flush (for example a reload path, see CC-017) would keep removed commands; read side casts unvalidated JSON.
  - `wrapper/queueFlush.ts` ~L144-150: `recordAdminAction` is awaited unguarded after the write, so a throw skips the remaining files and the final cache `forget` (depends on whether the audit write can throw).
  - `stores/playerCountHistory.startPlayerCountSampler`: the timer is discarded by the caller and not `unref`'d, and a slow `getHealth` can overlap ticks.
  - `jsonStore.ts`: `loadJson` returns the cached object by reference, so a mutating caller corrupts the cache until the mtime changes (callers not audited); a `.bak` recovery is not cached, so a corrupt main file logs and re-reads on every call.
- **Remediation:** per item as stated (try/catch around `onData` plus abort on every exit path; `errMsg` and a circular-safe formatter; `Math.floor`; replace-per-kind or clear after flush; guard the audit call; retain and `unref` the timer; document or freeze cached values).
- **Confidence:** strongly supported (read, not executed), except the `jsonStore` caller risk, which is assumption-dependent.

##### [LOW] CC-065: Small duplications in the Minecraft helpers (principle: DRY)
- **Location:** `minecraft/statUtils.ts` (six identical `flat.find(key)?.value ?? 0` bodies in `LEADERBOARD_STATS`; `buildLeaderboard` hard-codes `statKey !== "deaths"` instead of a definition field next to `sortAscending`; leaderboard labels and `toLocaleString()` are English-only in a bilingual UI; `humanizeKey` vs `itemNames.itemDisplayName`, two title-casing helpers that differ on namespace stripping); `streakLeaderboard.ts` (same medals array and row format as `buildLeaderboard`); `eventTips.ts` vs `featureNudges.ts` (the same ledger give-up gate and best-effort whisper wrapper written twice, with two separate max-mention knobs, and event tips ignore the `featureNudges.enabled` switch, which may or may not be intended).
- **Remediation:** `statByKey`/`sumCategory` helpers; an `includeZero` definition field; one `formatRankLine`; locale keys for labels; one `humanizeId`; one `ledgerAllows` and `whisperAndRecord`.
- **Confidence:** verified (duplication); strongly supported (i18n).

##### [LOW] CC-066: Store-layer leftovers beyond CC-004, CC-013, CC-014 and CC-028 (principle: inconsistent patterns, layering)
- **Location:** read-modify-write written four ways (`kvMutate` in `noteStore`/`pollStore`/`waypointStore`; raw `kvUpdate` with an inline guard in `tempBanStore`, `suggestionLedger`, `dailyStore` (`updateClaimedStore` and `updatePendingRewards` are textual copies of `kvMutate`); hand-rolled `withTransaction` + `kvGet` + `kvSet` in `watchStore.takeMatchingWatches`; unguarded `kvUpdate`/`kvGet` in `serverControlRecord`), about 11 near-identical shape guards in total; sparkline glyph tables and bucket scaling duplicated in `playerCountHistory.ts` and `uptimeTracker.ts` with different rounding; `stores/rewardsConfig.ts` copies `jsonStore.isEnoent`, hard-codes `${file}.bak`, and applies reward pool defaults twice; domain and presentation code (`buildActivitySparkline`, `busiestHours`, `buildSparkline`, waypoint validators and cap) inside store files.
- **Evidence:** a change to the backup naming in `jsonStore` leaves stale `.bak` files after deleting an override, and `loadJson` could resurrect them.
- **Remediation:** use `kvMutate` everywhere with one shared `isVersionedDoc` guard (extends CC-028); export `isEnoent` and a `removeJson(file)` from `jsonStore`; one `renderSparkline` in a presentation helper.
- **Confidence:** verified.

### Third pass: frontend composables, `src/bot`, `src/schema`, `core/db` (CC-067 to CC-099)

This pass read in full: every frontend composable and `web/frontend/src/utils`, all of `src/bot` (commands, `logWatcher/watchers`, `logWatcher/commands`, `interactions`, `utils`, `index.ts`), all of `src/schema` except the generated `wire/types.ts`, `core/db`, `core/types` and the root `core/` files. Findings already listed above are cited, not repeated.

#### High

##### [HIGH] CC-067: Command modules are imported with a raw path, which fails on Windows (principle: correctness, cross-platform requirement)
- **Location:** `bot/index.ts` `loadCommands` ~L236, `bot/logWatcher/initMinecraftCommands.ts` ~L194, `bot/logWatcher/commands/general/commands.ts` ~L27 (`await import(path.resolve(file))`); no `pathToFileURL` exists anywhere in `src` or `scripts`.
- **Evidence (reproduced by the lead reviewer on this Windows machine, Node 24.14.1):** `import("C:/…")` and `import(path.resolve(…))` both throw `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Each load sits in a per-file try/catch that only logs "Failed to load", so the bot would start on Windows with no slash commands and no in-game `!` commands. The project requires everything to work on Linux and Windows.
- **Remediation:** one `importCommandModule(file)` helper in `utils/commands/loadCommandFiles.ts` that does `import(pathToFileURL(path.resolve(file)).href)`, used at all three sites (this also removes the duplicated loaders from CC-016). Make a command-load failure count visible at startup (for example fail when zero commands load).
- **Confidence:** verified (reproduced).

##### [HIGH] CC-068: `/console tail` sends up to 3,800 characters as message content, which Discord caps at 2,000 (principle: correctness, misleading constant)
- **Location:** `bot/commands/admin/console.ts` `MAX_TAIL_CHARS = 3_800` ~L28-29 and the `editReply({ content })` at ~L87-94 (read by the lead reviewer).
- **Evidence:** the comment cites the 4,096 embed-description cap, but the text goes out as plain `content` plus a code fence. `consoleRelay.ts` budgets the same kind of message under 2,000. Any tail over about 1,950 characters is rejected by Discord, and the default 25 lines at about 100 characters each already exceeds that. Not run against Discord.
- **Remediation:** clip to about 1,900 characters or send an embed and use `EMBED_LIMITS.description`.
- **Confidence:** strongly supported (code read plus the known Discord limit).

#### Medium

##### [MEDIUM] CC-069: Both sleep-watcher guards are ineffective (principle: correctness, misleading comment)
- **Location:** `bot/logWatcher/watchers/log/sleepWatcher.ts` `isNight` ~L398-407 and `isPlayerSleeping` ~L42-53 (read by the lead reviewer); `sendTitleToAwake` doc ~L411-418.
- **Evidence:** `isNight` returns `tick >= 12542 || tick <= 23459`, which every tick satisfies, so the daytime check never rejects (it needs `&&`; the "wraps around midnight" comment is wrong for these constants). `isPlayerSleeping` matches `/(\d+)s/` against the whole RCON reply, which begins with the player name: for a valid name like `xX_99s_Xx` the reply "xX_99s_Xx has the following entity data: 0s" captures `99` and the awake player is treated as in bed. The doc claims a fallback to `@a` that does not exist.
- **Remediation:** use `&&`; anchor the regex to the value after the colon (`/:\s*(\d+)s\s*$/`); delete or implement the fallback claim.
- **Confidence:** verified.

##### [MEDIUM] CC-070: A scheduled-restart re-arm can overwrite a config reload, and "restart complete" is announced after a failed restart (principle: change-safety, swallowed error)
- **Location:** `bot/logWatcher/watchers/schedulers/restartScheduler.ts` `performRestart` ~L155-177, `armServer` ~L218-229, `reconcileRestartSchedules` ~L243-263.
- **Evidence (read by the lead reviewer):** the timer's `.finally` calls `armServer(client, serverId, schedule)` with the `schedule` captured at arm time, so a `/config reload` that re-armed a new schedule while the script ran is clobbered by the old one. A non-zero exit or exception only logs, and execution falls through to the `schedule.done` broadcast, so guilds are told the restart finished when it failed.
- **Remediation:** in the `.finally`, re-read the current schedule and re-arm only if it still exists; return a success flag from the script step and broadcast a failure notice (or none) otherwise.
- **Confidence:** verified for the failure broadcast; the re-arm race is by reading the sequence.

##### [MEDIUM] CC-071: A permanent `/ban` leaves an earlier timed ban armed (principle: correctness, inconsistent state handling)
- **Location:** `bot/commands/moderation/ban.ts` ~L93-111 (read by the lead reviewer); contrast `moderation/pardon.ts` ~L49-50.
- **Evidence:** only the `expiresAt !== null` branch touches the temp-ban store. `/ban Steve duration:1h` followed by `/ban Steve` leaves the timer and the stored entry in place, so after an hour `expireTempBan` sends `/pardon Steve` and the permanent ban is lifted. The entry also re-arms after a restart. `pardon` already does the cleanup this path lacks.
- **Remediation:** in the permanent branch call `cancelTempBanTimer(server.id, player)` and `await removeTempBan(server.id, player)`.
- **Confidence:** verified.

##### [MEDIUM] CC-072: Whitelist approve and deny act on the server before claiming the decision (principle: correctness, act-then-record race)
- **Location:** `bot/interactions/whitelistApplications.ts` `handleDecisionButton` ~L473-530 and `handleModalSubmit` ~L362-413 (adds to CC-018 and CC-013).
- **Evidence:** the application is read as pending, `performWhitelistAdd` runs (a Mojang lookup plus a console add), and only then does `updateStore` check the status is still pending. Admin A approves and the add starts; admin B denies and is recorded as denied; A sees "stale" but the player is already whitelisted and the audit says denied. Two approvals run the add twice. In the modal path the queue message with live Approve/Deny buttons is posted before the transactional re-check, so a concurrent second submit leaves an orphan message pointing at an application that was never stored. Not executed.
- **Remediation:** move the application to a transient "deciding" state inside `updateStore` first, and let only the winner perform the add (rolling back on failure); for the modal, insert the pending row first and delete it if posting fails, or delete the posted message when `!accepted`.
- **Confidence:** strongly supported.

##### [MEDIUM] CC-073: Fetching composables lack latest-wins guards, and stale responses overwrite newer state (principle: inconsistent pattern, correctness)
- **Location:** `useEditableDocument.load` ~L168-180 (verified: no token; serves Config, Commands, Rewards and Guild config), `useAnalytics.load`/`loadBoard`, `useInstalledMods.load`, `useModConfigs.loadFile`, `useServerStatus.refresh`, `useGuildSetup.loadChannelsRoles` ~L322-345 (verified: sets `channelsForGuild = guildId.value` after the await), `usePrune.inspect` ~L290-304 (verified: the stale check compares `cx`/`cz` but not `dimension`); guards exist only in `useBackups`, `useConsole`, `useServerUpgrade`, `useModCompat`, `usePrune` (scan) and a few others, each hand-rolled.
- **Evidence (failing inputs from the slice reviewers):** in the rewards editor, `open("smp")` then `open("")` can leave the smp pool adopted under the global scope; in `ModsView`, click Reload and then switch server, and the old server's installed list resolves last and replaces the new one; in the mod config editor, clicking file A then file B quickly shows whichever response lands last; in the setup wizard, picking guild A, Next, Back, guild B, Next while A's request is slow leaves A's channels cached as B's, and the wizard then writes A's channel ids into B's config; in the chunk inspector, inspecting (overworld, 5, 5) then (nether, 5, 5) lets the first response replace the second. `useGuilds.load` returns early while another load is in flight, so a second `await load()` resolves before data exists. The state shapes also differ per composable (string error, `LoadFailure` kind, `{message, status}`).
- **Remediation:** one shared `useLoader(fetcher)` or `latest()` helper with a generation guard returning `{data, loading, loaded, error, failure, load}`, replacing the hand-rolled counters; at minimum guard `useEditableDocument`, `useInstalledMods`, `useModConfigs.loadFile`, the wizard and the inspector.
- **Confidence:** verified for the missing guards; the user-visible outcomes are strongly supported (not run).

##### [MEDIUM] CC-074: Frontend polling can leak an interval, and the job-polling skeleton is copied three times with different failure policies (principle: timers without cleanup, DRY)
- **Location:** `views/StatusView.vue` ~L334-340 (verified) and `views/OverviewView.vue` ~L276-282 (`async mounted(){ await this.refreshAll(); this.timer = setInterval(…) }`); job polling in `useModCompat.ts`, `usePrune.ts`, `useServerUpgrade.ts` (each with its own `PageVisibility`, `browserVisibility`, `messageOf`, generation counter, `schedule`/`tick`, `dispose`).
- **Evidence:** if the route changes while the first refresh is pending, `unmounted` runs with no timer, then `mounted` resumes and installs an interval that is never cleared and keeps polling for the life of the tab. The four hand-rolled pollers have no in-flight guard. On a failed poll `useModCompat` and `usePrune` abandon the job while the wrapper job may still run, whereas `useServerUpgrade` reschedules forever with no cap or backoff, so a persistent 404 or 401 never stops. Also `StatusView.loadIntents` does an N+1 fetch of `/pending-actions` per server on every 5 s poll, errors swallowed, able to overlap itself.
- **Remediation:** a `usePolling(fn, ms)` composable (starts before the first await, tracks an unmounted flag, skips ticks while one is in flight, clears on unmount); extract `utils/pageVisibility.ts` and a `usePolledJob({intervalMs, poll, onDone, onError, retry})` with one failure policy (retry a few times, then stop with an error).
- **Confidence:** verified for the interval leak; strongly supported for the rest.

##### [MEDIUM] CC-075: Bot watcher intervals can overlap, and per-server state survives server removal (principle: inconsistent patterns, hidden mutable state)
- **Location:** intervals: `downtimeMonitor.ts` (60 s), `hostResourcesMonitor.ts`, `leaderboardScheduler.ts`, `upgradeMonitor.ts` (15 s), `statusEmbed.ts` (`void runStatusPass(…)` with no `.catch`), versus `tpsMonitor.ts`, which re-arms from `.finally`. State: `downtimeMonitor.serverStates`, `tpsMonitor.warned`/`levels`, `hostResourcesMonitor.alertState`, `serverEvents.startTimes`, `sleepWatcher.lastTriggerTime`, `consoleRelay.buffers`, `upgradeMonitor.tracked`/`supportCache`, `statusEmbed.channelRefCache`; `unwireServer` (`initMinecraftCommands.ts` ~L144-154) stops only the watcher and the TPS handle.
- **Evidence:** a tick that outlasts its interval (several servers timing out in turn) overlaps the next and double-counts `consecutiveFailures`/`consecutiveUnreachable`, misfiring the 3 and 5 "minute" thresholds. A removed and later re-added server id inherits the old state: the first online tick finds `wasDown` and posts "recovered after N days" and fires `/watch` DMs; `suppressUntil` and TPS `levels` also survive. `tpsMonitor`'s `schedule()` calls `loadConfig()` inside `.finally`, so a throw there stops the loop silently.
- **Remediation:** one `startPoller(name, fn, ms)` helper (self re-arming, `.catch`/log, optional `unref`, returns `{stop}`); a `forgetServer(id)` in each module called from `unwireServer`, or one per-server registry.
- **Confidence:** verified for the missing eviction and the pattern; the double-count under slow ticks is by reading.

##### [MEDIUM] CC-076: `SelectionModel.apply` contradicts its contract and can silently discard history and operations (principle: misleading comment, correctness)
- **Location:** `web/frontend/src/composables/pruneSelection.ts` `apply` ~L73-85 (read by the lead reviewer), `compact`, `paint`, `refresh`; caller `PruneView.onSelect` ~L569-572.
- **Evidence:** the doc says "Returns false, changing nothing", but `apply` calls `compact()` first, which clears undo and redo and rewrites the commands; if the cap is still exceeded it returns false with history already destroyed, and the caller syncs the selection regardless. `compact` rebuilds from bit sets and `paint` materialises only the regions currently reported, so operations over regions not currently loaded are dropped, which defeats `refresh()`. Cost grows with operations (up to 2,500) times regions on every undo (scale not measured).
- **Remediation:** compute the compacted size first and commit only if it fits; preserve or document the loss for unloaded regions; index regions once per paint pass.
- **Confidence:** verified for the doc/behaviour mismatch; strongly supported for the lost operations.

##### [MEDIUM] CC-077: The admin predicate is assembled by hand in six places, and the import cycle behind it is hidden by a `Symbol` hack (principle: DRY, layering)
- **Location:** `isServerAdmin(id, getMemberRoleIds(i), guildId)` at `bot/index.ts` ~L443, `interactions/confirmActions.ts` ~L134, `interactions/whitelistApplications.ts` ~L453, `utils/hints/followUps.ts` ~L338, plus the private `invokerIsAdmin` in `commands/middleware.ts` ~L65 and `isAdminPlayer` in `logWatcher/commands/general/waypoint.ts` ~L41-46 (which duplicates `defineCommand.ts` ~L183-186).
- **Evidence:** `utils/guild/guildRouter.ts` imports `commands/middleware.ts`, which imports `guildRouter` and `utils/hints/followUps.ts`, which imports both, so `utils` depends on `commands`. `adminGate()` with `Symbol.for("mcbot.adminGate")` (`middleware.ts` ~L77-84) exists only so a module-level const is not read while the cycle loads. `requireServerAdmin` checks admin and `withErrorHandling` checks the same gate again. A change to admin semantics must be made in six places.
- **Remediation:** a leaf module (for example `utils/guild/permissions.ts`) holding `isServerAdmin`, `getMemberRoleIds` and `isInvokerAdmin(interaction)`, imported by middleware, `guildRouter`, interactions, `index.ts` and `followUps`; then drop `adminGate`. Add `isLinkedPlayerAdmin(mcName)` for the in-game side.
- **Confidence:** verified.

##### [MEDIUM] CC-078: Command boilerplate that must change together is copied across the bot (principle: DRY, change-safety)
- **Location:** the `recordAdminAction({by: interaction.user.tag, byId: interaction.user.id, guildId: …})` envelope in 14 places (`challenge.ts` x2, `config.ts`, `console.ts`, `dailyAdmin.ts` x2, `note.ts` x2, `poll.ts` x2, `ban.ts`, `kick.ts`, `pardon.ts`, plus a local `audit()` in `control.ts`); player-name validation in ten commands (`note`, `whois`, `watch`, `profile`, `ban`, `kick`, `pardon`, `sessions`, `unwhitelist`, `whitelistAdd`); the paginated reply in seven commands (`help`, `waypoints`, `mods`, `whitelisted`, `players`, `compare`, `stats`; `compare.ts` is a verbatim copy of `stats.ts`'s `replyPaged`); `stats/top.ts` and `stats/leaderboard.ts` (identical except `setName`, confirmed by the lead reviewer); the "servers this guild may target" filter hand-copied in `index.ts` autocomplete, `poll.ts`, `uptime.ts`, `statusEmbed.ts` although `visibleServerIdsForGuild`/`filterTargetableServerIds` exist.
- **Evidence:** `byId: interaction.user.id` appears 15 times under `bot/`; note and config disagree on `server: null` vs omitted. Name validation differs by command (ban, kick, pardon, watch, profile trim the input; note, whois, sessions, unwhitelist do not; `unwhitelist` resolves the server before validating). The two inline visibility copies lack the operator exemption, so an operator gets a full list from `/daily-admin show` but a filtered one from `/uptime server:all`, `/poll servers:all` and autocomplete although `resolveServer` allows any server.
- **Remediation:** an `auditAdminAction(interaction, {action, server?, detail?})` helper; `requireMcName(interaction, option)`; `replyPaged` and `pageBy` in `embedUtils.ts`; one `buildLeaderboardData(name)` in `shared/`; use the shared visibility helpers.
- **Confidence:** verified.

##### [MEDIUM] CC-079: User-facing English (and German) strings bypass the locale tables (principle: inconsistent pattern with the bilingual rule)
- **Location:** frontend: `useConfirmAction.ts` ~L87 (`options.cancelLabel ?? "Cancel"`, verified), `useTypedConfirm.ts`, `useEditableDocument.ts` (six `saveError` strings), `useModCompat.ts` (`summaryText` and error text), `usePrune.ts`, `useServerUpgrade.ts`, `useInvite.ts`, `useMyGuilds.ts`, `useInstalledMods.ts`, `configTree.ts`, `format.ts` `tierLabel`; bot: `sleepWatcher.ts` (about 45 hard-coded German messages), `statusEmbed.ts`, `tpsMonitor.ts` ("1 min", "5 min"), `joinLeave.ts` emoji, in-game `link.ts`, `playerhead.ts`, `general/commands.ts`, `chunkbase.ts`, `netherportal.ts`, `seed.ts`, `waypoints.ts`, `defineCommand.ts` ("Please wait Ns"); commands: `reminder.ts` suffix, `/config show` labels, leaderboard stat labels and `toLocaleString()` in `statUtils.ts`.
- **Evidence:** `TypedConfirmDialog.vue` already falls back to `t('ui.confirm.cancel')`, but because `useConfirmAction` always sets a truthy "Cancel", German users see English "Cancel" on every confirm that does not pass `cancelLabel` (only three callers do). The strings are invisible to `i18n:check`, so German guilds get mixed-language output from the same command family.
- **Remediation:** move them to `t()` keys with en and de entries (leave `rejectLabel` undefined by default); let composables return error kinds or keys where practical; document `sleepWatcher` as intentional if it is.
- **Confidence:** verified for `useConfirmAction` and the cited strings.

##### [MEDIUM] CC-080: Contracts that disagree with their consumers (principle: contract vs consumer)
- **Location:** `schema/contract.ts` `ConfigWriteConflict` ~L198-203 (read by the lead reviewer: `{error: "conflict", message, currentHash}`) vs the backend `HttpError.body` shape `{error: <message>, code: "CONFLICT", currentHash}` in `web/backend/errors.ts` ~L31-39 and `routes/config.ts` ~L189-195; `ServerStatus.online` (legacy flag with no frontend reader); the wire player-list shape declared three times (`core/types/minecraft/minecraft.ts`, an inline type in `access/health.ts`, and the generated `Wire["PlayerList"]`) and parsed five times (`downtimeMonitor`, `statusEmbed`, `web/backend/status/status.ts`, `playerCountHistory`, plus `getList`) with different NaN handling; two unrelated `BackupDirInfo` types (core `latestMtime: Date`, wire `latestMtimeMs: number`).
- **Evidence:** a consumer written against `ConfigWriteConflict` would branch on a field that does not exist (the type is only re-exported by `frontend/api.ts`). There is no shared `ApiErrorBody` type in `schema/apiErrors.ts`. The `"?"` max-players sentinel is detected by `NaN` in each parser.
- **Remediation:** replace `ConfigWriteConflict` with `ApiErrorBody` plus an extension in `apiErrors.ts` (or delete it); delete `ServerStatus.online`; alias `PlayerList` in `wire/index.ts` and add one `parsePlayerCounts()`; rename the core `BackupDirInfo`.
- **Confidence:** verified for the type mismatch (the backend body shape comes from the slice reviewer's reading); strongly supported for the rest.

##### [MEDIUM] CC-081: Values duplicated across layers instead of living in `@mcbot/schema` (principle: guideline 10)
- **Location:** TPS cutoffs in four places (`tps.ts` 18/15, `tpsMonitor.ts` configurable threshold default 15 and `SEVERE_TPS = 10`, `web/frontend/src/utils/format.ts` `tpsRole` 18/12 (read), `serverAlerts.ts` 15 (read)); disk cutoff 90/75 in `format.ts` and `serverAlerts.ts`; analytics retention (`schema/analytics.ts` `ANALYTICS_CAP_HOURS` vs `playerCountHistory.RETENTION_HOURS`, `commandUsage.USAGE_RETENTION_DAYS`, `snapshotUtils.MAX_AGE_MS`); upgrade and prune phase and reason lists (`upgradeMonitor.ts`, `useServerUpgrade.ts`, `UpgradeRun.vue`); the snowflake regex (`humaniseIds.ts`, `scripts/setup.mjs` although `schema/discord.ts` says "one definition"); two different constants named `ALL_SERVERS` (`"*"` in `schema/capabilities.ts`, `"all"` in `bot/utils/guild/serverOptions.ts`); the action-to-capability rule in `StatusView.vue` and `routes/servers.ts`; `MS` (pure arithmetic) sits in `core/utils/duration.ts`, which `schema` cannot import, so `DAY_MS`/`HOUR_MS` are redeclared in about ten more files.
- **Evidence:** an operator who sets `tpsWarningThreshold` to 12 still sees `/tps` go yellow below 18 while alerts stay quiet; at TPS 16 the dashboard chip is Degraded but no alert fires, at TPS 14 both do. If a store's retention is raised the dashboard clamps to the old ceiling; if lowered it promises history that is gone. A phase added on one side makes Discord and the dashboard disagree silently. This is the root cause behind CC-050.
- **Remediation:** one const table for TPS and disk levels (and the configured TPS threshold) in `@mcbot/schema`; import the retention caps from the schema in the stores; export the phase and reason tuples with type guards from `schema/upgradePhases.ts`; export `isSnowflake`; rename the bot's `ALL_SERVERS`; add `capabilityForServerAction`; move `MS` into `@mcbot/schema` and re-export it from `core/utils/duration.ts`.
- **Confidence:** verified for the TPS and disk values read by the lead reviewer; the rest verified by the slice reviewers.

##### [MEDIUM] CC-082: The legacy importer retires files it did not import (principle: data-loss risk, misleading comment)
- **Location:** `core/db/importLegacy.ts` `importLegacyJson` (the `COMMIT` then `retireLegacy` after every block, ~L124-358; first block read by the lead reviewer); warning ~L73.
- **Evidence:** when the target table is already non-empty the block skips the insert but still renames the file to `.imported`. The L73 warning says the table "stays empty until the operator restores or removes it", which is false because the bot keeps writing rows meanwhile. Failing sequence: legacy `linkedAccounts.json` is corrupt and skipped; a user runs `/link`, which writes a row; the operator repairs the file and restarts; `tableEmpty` is false, the import is skipped, and the repaired file is renamed with no log line, so the old links are lost to the live database. The same transaction block is repeated seven times, its bare `db.exec("ROLLBACK")` is unguarded (unlike `withTransaction`), and the blocks count differently (the audit log counts skipped rows, the whitelist block counts successes).
- **Remediation:** retire only after a real import, or log a warning and leave the file in place when the table is non-empty; extract `importOnce(db, file, table, fn)` that owns the transaction, rollback and retire decision.
- **Confidence:** strongly supported (the retire-regardless structure is verified by reading; the loss sequence was not run).

##### [MEDIUM] CC-083: Config-schema validation renders errors to text and then regex-matches the text back (principle: coupling, fragility)
- **Location:** `core/configSchemaCheck.ts` ~L98-133, ~L173-180; `core/configValidation.ts` ~L160, ~L163, ~L557.
- **Evidence:** `checkAgainstSchema` returns formatted lines, and `configValidation` demotes some by matching patterns such as `/\.notifications\.events\.\d+: must be one of/` and `/^ {2}- guilds\.[^.]+\.language: must be one of/`. A wording change in `formatError` or `formatInstancePath` silently turns a forward-compat warning into a blocking startup error. The JSDoc already disagrees with the output (`events[0]` vs `events.0`). `anyOf`/`oneOf` lines are dropped, leaving contradictory "must be string" and "must be array" lines for union fields (`ServerScope`, `trustProxy`).
- **Remediation:** return `{path, keyword, params, line}` objects and filter on keyword and path; emit one line for unions ("must be string or array"); fix the JSDoc.
- **Confidence:** verified for the coupling; strongly supported for the union noise.

##### [MEDIUM] CC-084: The console deny-list can be bypassed with `return run` and with a literal `run` token (principle: change-safety; security note)
- **Location:** `schema/consoleCommands.ts` `consoleCommandVerbs` ~L57-72 (read by the lead reviewer).
- **Evidence:** it unwraps only `execute … run`, and it splits at the first `run` word. `return run op Steve` (Minecraft 1.20 and later) yields the single verb `return`, so `op` is never seen; `execute as run run op me` splits at the first `run` (a player or score named `run`) and checks `run`. The documentation already says the list guards against mistakes, not a determined holder of `server:console`, which is why this is Medium and not High. Not run against a server.
- **Remediation:** treat `return run` like `execute … run`; scan every `run` token rather than the first, or deny `execute` and `return` outright when the list is non-empty.
- **Confidence:** strongly supported (the parser read; command syntax from the slice reviewer).

##### [MEDIUM] CC-085: The leaderboard scheduler mixes locales, spams warnings and swallows errors (principle: inconsistent pattern, swallowed error)
- **Location:** `bot/logWatcher/watchers/schedulers/leaderboardScheduler.ts` ~L132-135, ~L159-165, ~L236-262, ~L264-346; `core/utils/minecraft/statUtils.ts` ~L197; `streakLeaderboard.ts` ~L69-74.
- **Evidence:** every other broadcaster builds inside `runWithGuildLocale(guildId, …)`; here `buildLeaderboard` and `buildStreakLeaderboard` call `t("leaderboard.title")` with no guild id, so a German guild on an English default gets a German footer under an English title. The failure branch advances the schedule "so a broken channel doesn't cause retry spam", but the two `continue` paths for "channel not found" and "no server instance" do not, so each logs a warning every 5 minutes forever. The 10 s and 30 s initial timers use `.catch(() => {})` and bare literals, so failures there are invisible. `checkAndPost` is about 175 lines.
- **Remediation:** wrap the per-guild block in `runWithGuildLocale`; route every non-success exit through one "advance and log once" helper; log in the initial timers; split `checkAndPost` into `isDue`, `resolveServers`, `buildEmbeds`, `postGuild`.
- **Confidence:** verified for the code shape; the locale effect is strongly supported.

##### [MEDIUM] CC-086: Death and advancement parsing drops or truncates real messages (principle: parsing fragility)
- **Location:** `bot/logWatcher/watchers/log/deaths.ts` `DEATH_PHRASES` ~L30-61; `advancements.ts` ~L31-33 and ~L133.
- **Evidence:** the phrase table lacks several vanilla messages (the reviewer lists "froze to death", "was struck by lightning", "went up in flames", "was burnt to a crisp", "discovered the floor was lava", "was roasted in dragon's breath", and the 1.21 mace "was smashed"), so no embed, tip or coordinate DM is sent for them; matching is by prefix, so each new Mojang message needs a manual edit. `ADV_REGEX` uses a lazy `\[(.+?)\]`, so a datapack advancement "Why [It] Happened" is captured as "Why [It" and a challenge comparison never matches, so no reward is paid; `isChallenge` is derived from `match[0].includes(...)`.
- **Remediation:** add the missing phrases (check against the current `en_us.json`) and add a test that iterates every vanilla `death.*` key; use `\[(.+)\]\s*$` with the verb phrase in its own capture group.
- **Confidence:** strongly supported (the phrase list is from the reviewer's memory of the language file; the regex behaviour is verified by reading).

##### [MEDIUM] CC-087: Join, death, advancement and sleep handlers do Discord, RCON and DM I/O inline and stall the per-server dispatch queue (principle: SRP, inconsistent fix)
- **Location:** `log/deaths.ts` ~L143-193, `joinLeave.ts` ~L85-98, `advancements.ts` ~L129-160, `serverEvents.ts`, `sleepWatcher.ts` ~L443-490; queue in `RemoteLogWatcher.ts` ~L79-100; the local fix in `chatBridge.ts` ~L206-221 and ~L304-307.
- **Evidence:** `RemoteLogWatcher._enqueue` runs handlers one at a time. `chatBridge` already fixed the resulting chat lag with `enqueueSend`, but the other handlers still `await` sequential `channels.fetch` and `send` per guild plus `getList`, `deliverEventTip` and `user.send`. One death on a three-guild setup runs about eight awaited network calls while chat from that server queues behind it; the sleep handler is up to four sequential RCON round trips.
- **Remediation:** lift `enqueueSend` into a shared per-channel send queue and let `broadcastNotification` use it, or dispatch the tail work fire-and-forget as `scheduleNudge` does.
- **Confidence:** strongly supported (the paths are verified; the latency effect is inferred).

##### [MEDIUM] CC-088: `/streak` mixes a live streak with a stale bonus streak (principle: correctness)
- **Location:** `bot/commands/connection/daily/streak.ts` ~L43-67 (the raw `bonusStreak` read by the lead reviewer), ~L87-91.
- **Evidence:** `currentStreak` goes through `liveStreak()` and shows 0 once the two-cooldown window has passed, while `bonusStreak` is read raw, so a lapsed user sees "Current 0 days" next to a progress bar and milestone track at, for example, 5/7; the next claim resets it to 1.
- **Remediation:** add a `liveBonusStreak` next to `liveStreak` in `rewards.ts` (sharing the `STREAK_GRACE_MS` from CC-050), or show 0 when the streak is broken.
- **Confidence:** verified for the raw read; the displayed result follows from `liveStreak`'s behaviour as described by the reviewer.

#### Low

##### [LOW] CC-089: Smaller defects in the prune pure modules (principle: correctness, DRY)
- **Location:** `composables/pruneTiles.ts` ~L88-94, ~L98-106, ~L126-135; `pruneSelection.ts` (`regionKey`, `key.split(",").map(Number) as [number, number]`, inline `{x1,z1,x2,z2}` three times); `pruneCamera.ts` `regionBoundsToChunks`; `PruneView.selectedCount` ~L610-622.
- **Evidence:** the tile `.finally` deletes the in-flight key of a newer generation, so after `reset()` a second fetch of the same region starts, the second `done.set` overwrites the first without `close()` (an `ImageBitmap` leak) and `loading` undercounts; the option doc says tiles "furthest from what is wanted" are released but `release()` evicts oldest-inserted entries. Two files encode the "rx,rz" format independently; `PruneView.selectedCount` hand-iterates the bits with `map.regions.find` per region (O(n squared)) instead of using the model. `SelectionModel.count`/`regionBits` are test-only.
- **Remediation:** delete `inFlight` and pump only when the generation matches; fix the eviction comment or sort by priority; export one `regionKey`/`parseRegionKey` and one `Rect`; use the model in `selectedCount`; delete unused members. The magic 32 is CC-025.
- **Confidence:** verified by the slice reviewer.

##### [LOW] CC-090: Frontend composable duplication and layering (principle: DRY, layering)
- **Location:** the `loading/loaded/error/failure` quintet in `useAudit`, `useConfigHistory`, `useServerStatus`, `useAnalytics` (three sections), `useMyGuilds`, `useGuilds`; two unrelated `LoadFailure` types (`useInstalledMods.ts` and `utils/loadFailure.ts`) and two `FailureCopy` types (`loadFailure.ts`, `discordFailure.ts`); `useEditableDocument.ts` importing `EditConflict` from `useModConfigs.ts`; the `registerDirtySource` plus `getCurrentInstance()` unmount pairing in three composables; three `localStorage` try/catch wrappers (`useDensity`, `useSeenFeatures`, `useServerUpgrade`); the "save then success toast" wrapper in `useEmbedColors`, `useGuildConfig`, `useConfig`; `/api/setup/guilds`, `/api/guilds` and `/api/setup/servers` each fetched twice (wizard vs `useGuilds`/`useMyGuilds`/`useSchemaRefs`), with servers loaders that swallow everything as `[]`; `ConfigView` renders its own config-status chip instead of `ConfigStatusChip`; `useGuildSetup` and `PruneView` build REST adapters inline.
- **Evidence:** the same-named types make imports ambiguous; a 500 from the servers loaders is indistinguishable from "no servers" and hides the sysadmin picker; the generic editor core depends on a feature composable for a type.
- **Remediation:** one `useLoader`/`useLoad` helper (CC-073), one `safeStorage` helper, move `EditConflict` into the editor core, let `registerDirtySource` register its own cleanup, reuse `useGuilds`/`useMyGuilds` in the wizard, swallow only 403 in the servers loaders, rename the duplicate types, reuse `ConfigStatusChip`.
- **Confidence:** verified by the slice reviewers.

##### [LOW] CC-091: Frontend robustness items (principle: error handling)
- **Location:** `utils/minecraftItems.ts` `loadItemCatalog` ~L30-39; `useServerStatus.botAlive` default; `utils/errorMessage.ts`; `useConsole.send` ~L168-193; `useCommands.currentBlock` ~L219-229 and `save` ~L144-154; `useAnalytics.load` ~L111-160; `useCapabilities.canAnywhere`.
- **Evidence:** `loading ??= import(…)` caches a rejected promise (read by the lead reviewer), so after one chunk-load failure every later call returns the same rejection until a page reload and the reward item search stays dead. `botAlive` defaults to `true` and stays so when the first fetch fails. `errorMessage` returns "[object Object]" for plain-object throws. After the await, `useConsole.send` pushes the command echo into whatever console is current and clears text typed meanwhile. `useCommands.currentBlock` uses `??=` during read paths that run from templates (mutation in render), and `save` silently skips edits for a guild or server with no entry while the success toast still fires (depends on whether such scopes can be listed). `useAnalytics.load` keeps the previous server's `caps` when a request fails and has a dead `hours = 24 * 14` default.
- **Remediation:** clear `loading` in a `.catch`; default `botAlive` to unknown; handle plain objects in `errorMessage`; re-check the server and generation after the await; read without creating blocks; reset `caps` at the start of a load.
- **Confidence:** verified for `loadItemCatalog`; strongly supported for the others.

##### [LOW] CC-092: Database lifecycle problems (principle: error handling, inconsistent flags)
- **Location:** `core/db/index.ts` ~L51-85, ~L70 (read), ~L124-126; `core/db/driver.ts` ~L71-78; `bot/index.ts` shutdown ~L522-533.
- **Evidence:** `process.env.MCBOT_VACUUM_ON_START` is checked for truthiness, so `MCBOT_VACUUM_ON_START=0` or `=false` triggers an exclusive-lock VACUUM (other flags compare to `"1"`). `closeDb()` is just `closeDbForTesting()`; the dashboard calls it, but the bot's `shutdown()` never closes the database although the doc says it "checkpoints the WAL". If `runMigrations` or `importLegacyJson` throws, `_db` stays null and the opened handle leaks, and a retry opens a second connection. `driver.ts` wraps every constructor failure (unwritable directory, "file is not a database", a bad `MCBOT_DB_PATH`) as "better-sqlite3 failed to load, run npm rebuild".
- **Remediation:** compare the flag to `"1"`; add a real `closeDb()` and call it in bot shutdown; close the handle on init failure; apply the rebuild hint only to module-load errors.
- **Confidence:** verified for the VACUUM flag; strongly supported for the rest.

##### [LOW] CC-093: The migration checksum covers SQL comments (principle: change-safety, misleading doc)
- **Location:** `core/db/migrations.ts` `checksum` ~L233-247 (read by the lead reviewer).
- **Evidence:** only whitespace is collapsed before hashing, so comment text is part of the hash; migrations 1 to 6 carry long `--` comments. Fixing a typo in one changes the hash and every existing database then refuses to start with "Migration N has changed". The doc says reflowing is safe but is silent about comments.
- **Remediation:** strip `--` line comments before hashing (none occur inside string literals today), or hash the statements.
- **Confidence:** strongly supported (not run).

##### [LOW] CC-094: A dead top-level config key, and generated descriptions that leak developer text (principle: dead code, misleading documentation)
- **Location:** `schema/config.ts` `leaderboard` ~L748 and ~L831, passed through at `core/config.ts` ~L278; stacked JSDocs at `HostAlertsConfig` ~L663-683, dangling blocks ~L91-95 and ~L506, a stale path ~L412 (`common/utils/commandPolicy.ts`), developer identifiers in operator-facing text (`DEFAULT_NOTIFICATION_EVENTS`, `LEADERBOARD_STATS`, a `guildTimeZone` path, "see milestoneWatcher").
- **Evidence:** the lead reviewer found no reader of a top-level `config.leaderboard` (every use is `gcfg.leaderboard`), yet it is in `config.schema.json`, so the editor offers an inert setting. Stacked JSDocs mean `diskWarnPercent` and `backupMaxAgeHours` have no `description` in the generated schema; the identifiers and path appear in descriptions that the dashboard editor shows.
- **Remediation:** remove the key from `RawBotConfig`, `BotConfig`, `config.ts` and the schema (warn on it as unknown); merge stacked JSDocs; rewrite descriptions in operator terms; fix the path.
- **Confidence:** verified (grep for readers); descriptions verified by the slice reviewer.

##### [LOW] CC-095: Duplicated logic and test-only exports in `schema` (principle: DRY, dead code)
- **Location:** `schema/serverActions.ts` `isActionApplicable` ~L99-100 vs `serverState.ts` `stateIsUp` (~L150-152), and `SERVER_OPERATOR_ACTIONS` as a hand copy of `SERVER_SCRIPT_ACTIONS` minus `status`; `schema/status.ts` `labelKey: string` (the frontend needs `as GlossaryKey`) and test-only `statusRoleGlossaryKey`; test-only exports `hasCapability`, `grantedServerIds`, `hasWildcardGrant`, `glossaryText`, `statusColor`, `statusShape`, and `namespacedId` (zero references); `web/backend/auth/capabilities.ts` `sessionHolds` re-implementing `hasCapability`; `dailyRewards.ts` ~L120 dead `.trim()`; `capabilities.ts` doc omitting `mods:read`/`mods:write`; `core/types/index.ts` saying "No types are defined here" while re-exporting a runtime value; `schema/index.ts` header listing 3 of about 20 modules (52 barrel imports vs 109 deep imports across the repo).
- **Evidence:** `serverState.ts` states "a future state joins the up set once, here", yet `isActionApplicable` hand-builds `Online || Unresponsive`.
- **Remediation:** use `stateIsUp`; derive the operator list with a filter; type `labelKey`; have `sessionHolds` call `hasCapability`; delete unused exports with their tests; fix the stale headers and docs.
- **Confidence:** verified by the slice reviewer.

##### [LOW] CC-096: Remaining watcher defects and duplicates (principle: error isolation, DRY)
- **Location:** `monitors/milestoneWatcher.ts` ~L83-119; `monitors/downtimeMonitor.ts` ~L290-291 and the outage-state reset written three times (`getState`, `holdAlerts`, `suppressAlerts`); `monitors/upgradeMonitor.ts` ~L207-218; `log/chatBridge.ts` ~L296-302; `log/consoleRelay.ts` ~L91-176; `DAY_CODES` in `leaderboardScheduler.ts` and `restartScheduler.ts`; `PLAYER_NAME` in `notifyGuilds.ts` vs a hand-rolled killer-name pattern in `deaths.ts` ~L123; time literals in about 22 watcher sites, with `pollScheduler.ts` ~L42 redeclaring `MAX_TIMEOUT_MS` that `longTimer.ts` exports.
- **Evidence:** the milestone pass records `statState[uuid] = crossed` before the cap, so crossings beyond the per-pass cap are marked announced and never posted, and an empty stats map after a wrapper hiccup seeds an empty baseline so veterans announce on the next good pass (the empty-map path is assumption-dependent). An unguarded `await recordCheck(...)` throw skips the whole offline/online alert branch every tick. After a failed `existing.edit` (deleted message) the upgrade monitor keeps the stale `Message` and warns on every update, unlike `statusEmbed` and `chatBridge`, which evict and recreate. `registerChatBridge` runs `reportBridgeProblems` and `prewarmBridgeWebhooks` per server, so a bad bridge config logs N times at startup. `consoleRelay` runs three regex replaces and buffering for every log line forever even when no relay is enabled, and `flush` has no re-entrancy guard. Several exports are unused or test-only (`UPGRADE_PHASES`, `PRUNE_PHASES`, `DEFAULT_DISK_WARN_PERCENT`, `loadConsoleRelayState`/`saveConsoleRelayState`, `hostResourcesMonitor.broadcast`, and others), and some doc comments are misplaced (`dailyReminderScheduler`, `joinLeave`) or say "hourly" for a 5-minute interval.
- **Remediation:** record only what was announced and do not seed from an empty map; wrap `recordCheck` in try/catch with a warning; evict on an unknown-message error; call the bridge checks once; cache an "any relay enabled" flag and add an in-flight guard; add a `resetOutage(state)` helper; move `DAY_CODES`/`parseScheduleTime` to `core/utils/time.ts` and `PLAYER_NAME` next to `isValidMcName`; use `MS.*`; delete unused exports and fix the comments.
- **Confidence:** verified by the slice reviewer; not re-read by the lead reviewer.

##### [LOW] CC-097: Smaller defects and leftovers in the bot commands (principle: swallowed error, inconsistent pattern)
- **Location:** `connection/unlink.ts` ~L15; `connection/daily/reminder.ts`; `general/poll.ts` ~L182-183 and ~L236-301; `general/help.ts` ~L64-92; `server/control.ts` (~L229, ~L284, ~L340-447); `admin/config.ts` ~L139-158; `admin/dailyAdmin.ts`; `stats/players.ts`; `general/map.ts`; `info/uptime.ts`; `backup.ts` `formatSize`; `sessions.ts`; plus `moderation/clear.ts`.
- **Evidence:** `/unlink` reports a database failure as "you are not linked" (`.catch(() => false)`) and skips the role sync, with no log. `/poll create` checks the one-open-poll rule on a store loaded before an `await` and the push does not re-check, so two admins creating at once open two polls. `/help` shows each subcommand as "(optional)" and never lists their options (about 14 commands). `control.ts` bypasses `resolveServer` on the confirm button (`getServerInstance(serverId)` from the custom id, so the guild's allowed set is not re-checked at press time), packs four flows into one `execute`, uses two different confirmation conventions (button vs a typed `confirm:true` for the destructive prune), defines its own `codeBlock` and a timeout race that never clears its timer. `/config show` keeps its own feature list that omits `console` and mixes `t()` labels with raw English. `/daily-admin` validates the server twice and loads the store before it is needed. `/players` casts the `sort` option to `RosterSort`; `/map` casts for a legacy `url` key. `/backup` and `/status` format sizes differently (`formatSize` vs `formatBytes`), `/sessions` uses `formatDuration` where `/profile` uses `formatSpan`, and error handling differs for the same failure (some commands log and throw a friendly error, others let a raw I/O message reach the user). Several headers narrate history. Security note, one line: `moderation/clear.ts` relies only on `setDefaultMemberPermissions(ManageMessages)`, so a guild admin can widen it in Integrations settings (may be intended).
- **Remediation:** drop the `.catch` and let `withErrorHandling` report; re-check inside the `updatePollStore` callback; render subcommands as `/cmd sub` with their options; widen the interaction type so buttons can call `assertMayTargetServerId`; split `control.execute`; derive the `/config show` list from a shared guild-feature table; delete the redundant server validation; use one size and duration formatter; use a load-or-friendly-error helper.
- **Confidence:** verified by the slice reviewer; not re-read by the lead reviewer.

##### [LOW] CC-098: Smaller defects in `bot/index.ts`, interactions and in-game commands (principle: error handling, DRY)
- **Location:** `bot/index.ts` ~L454-493, ~L92-112, ~L522-541; `utils/hints/followUps.ts` ~L185-195 and ~L295; `logWatcher/commands/connection/link.ts` ~L9-65; `utils/embeds/embedUtils.ts`, `utils/discordTime.ts`, `utils/guild/guildConfigs.ts`, `interactions/confirm.ts`, `statEmbeds.ts`.
- **Evidence:** the dispatcher's catch calls `replyError` outside `runWithGuildLocale` (error title in the global language, description in the guild's), never uses `errorContentOf`, and has `recordCommandUsage` inside the same try, so a successful command can show an error reply if usage recording throws. The "watch this server" hint does `loadWatchStore`, `push`, `saveWatchStore` without the `/watch` rules (the cap of 10 can be exceeded, and duplicates are only checked at offer time), which is the CC-004 pattern. `!link` keeps its own unbounded `linkAttempts` map although `defineCommand` has a `cooldown` with a sweep, and delivers outcomes through `client.users.cache.get`, so after a restart the in-game player gets no feedback. `shutdown` can run twice on a double SIGINT and never stops the Discord client; `updateNotifier` is dynamically imported twice. `statEmbeds.ts` ~L55 tests `/(_time|Time)$/` against an already lowercased key, so the `Time` alternative never matches. Custom ids join `serverId` and `userId` with ":" and parse by splitting, and I found no validation forbidding ":" in server ids or checking the 100-character limit (assumption-dependent). `addFieldsBulk` is test-only, `relativeTimestamp` is an alias of `formatLastSeen` used for non-"last seen" purposes, `createPlayerEmbed(player, options, asThumbnail = false)` is a boolean flag, `GuildConfigSource` has one production arm, and `CONFIRM_TTL_MS`/`PAGINATION_TIMEOUT_MS` bypass `MS`.
- **Remediation:** build the error content with `errorContentOf` inside `runWithGuildLocale` and move `recordCommandUsage` out of the try; add `addWatch(userId, watch)` (cap, duplicate check, transactional) to `watchStore`; use `cooldown` and `users.fetch` in `!link`; guard `shutdown`; fix the regex; validate server ids; remove the test-only and alias surface.
- **Confidence:** verified by the slice reviewer; not re-read by the lead reviewer.

##### [LOW] CC-099: "Reload config and reconcile" exists three times, and one copy is dead (principle: DRY, dead code)
- **Location:** `bot/utils/applyConfig.ts` (`applyConfig`), `bot/index.ts` `applyConfigReload` ~L143-172, `bot/commands/admin/config.ts` ~L45-62; pointer in `core/utils/config/configService.ts` ~L10.
- **Evidence:** `applyConfig(` has no caller in `src` (grep by the slice reviewer; tests not read), although its header claims to be the path `/config reload` uses; that command re-implements the sequence (`reloadConfig`, `beginConfigApply`, `reconcileServers`, `reportApplied(changed)`), and `applyConfig`'s return type drops `replaced`. The logging differs between `index.ts` and `config.ts`, and `beginConfigApply()([])` at `index.ts` ~L110 is an unexplained curried call.
- **Remediation:** delete `applyConfig.ts` or make it the single implementation (returning the full `ReconcileResult`) used by both callers; fix the pointer.
- **Confidence:** strongly supported.

## 4. Coverage and limitations

**Inspected in full by a slice reviewer:** `core/utils/server/{serverAccess,wrapperContract,server,transportError,queryResult}.ts`, `access/{apiClient,manifest,health,scripts,commands,host,capabilityProbe,configFiles}.ts`, `core/config.ts`, `core/configValidation.ts`, `schema/{contract,index}.ts`; `web/backend/routes/{mods,modConfigs,config,schemas,servers}.ts`, `server.ts`, `errors.ts`, `csrf.ts`, `auth/capabilities.ts`, `routes/scriptFailure.ts`; the `ModsView.vue` script, `utils/errorMessage.ts`; `bot/logWatcher/initMinecraftCommands.ts`, `commands/connection/daily/daily.ts`, `schedulers/statusEmbed.ts`, `interactions/whitelistApplications.ts`, `bot/index.ts`, `core/db/kv.ts`.

**Partially inspected:** `routes/{prune,upgrades,backups,console}.ts`; `BackupsView`, `PruneView`, `UpgradeView`, `StatusView`, `ModConfigView` (targeted ranges); `schema/config.ts` (outline); `access/{backups,prune,stats}.ts`; core stores (`session`, `challenge`, `watch`, `link`, `daily`).

**Read in full in the deeper pass (CC-038 to CC-066):** every file under `src/core/utils/**` (`commands`, `config`, `configfmt`, `minecraft`, `server`, `stores`, `wrapper`, and the top-level utilities), by four slice reviewers. Two of the four runs were interrupted by a rate limit and resumed from their transcripts, and their final reports came back with few new tool calls, so the reads that produced them happened before the interruption; I could not independently confirm each file was read end to end beyond the file lists they reported. The reviewers also ran a dead-export counting script (one first version was broken and rerun) and two `node -e` probes (a DST offset check and a `hour12` check). The lead reviewer re-checked by direct read or grep: CC-038 (`confirmLinkCode` ignores `confirmed`), CC-039 (`allowedServerIdsIn`), CC-040 (version regex), CC-041 (pre-connect timeout mapped to `refused`), CC-042 (take-before-give in `deliverPendingRewards`), CC-044 (`deriveEnvironment` fallthrough), CC-046 (`entityDataPattern`), CC-047 (`loadKnownPlayers` callers all pass `false`), CC-052 (`TOP_LEVEL_KEYS` content), CC-060 (`sanitizeForConsole` has no production caller), CC-061 (`flushUptimeHistory` wiring, `saveLinkedAccounts` test-only use). The remaining deeper-pass findings rest on the reviewers' reading and were not re-read.

**Read in full in the third pass (CC-067 to CC-099):** all 38 frontend composables and `web/frontend/src/utils`, `main.ts`; all of `src/bot` (`commands` 50 files, `logWatcher/watchers` 24 files, `logWatcher/commands`, `interactions`, `utils`, `index.ts`); all of `src/schema` except the generated `wire/types.ts` (the OpenAPI copy was only skimmed); `core/db` (6 files), `core/types` (14 files), `core/configMigrations.ts` and `core/configSchemaCheck.ts`. Six reviewers ran as separate agents and each reported its file list. The lead reviewer re-checked by direct read, grep or a reproduction: CC-067 (the Windows import failure was reproduced with Node 24.14.1), CC-068, CC-069, CC-070, CC-071, CC-073 (the `useEditableDocument`, `useGuildSetup` and `usePrune.inspect` code), CC-074 (`StatusView`), CC-076, CC-079 (`useConfirmAction`), CC-081 (the TPS cutoffs), CC-082, CC-084, CC-091 (`loadItemCatalog`), CC-092 (the VACUUM flag), CC-093, CC-094 (no reader of a top-level `config.leaderboard`), the `/top` vs `/leaderboard` duplication in CC-078, and that `useTypedConfirm()` has no production caller. The remaining third-pass findings rest on the slice reviewers' reading and were not re-read.

**Scanned only (grep/CSS-diff/function-length scans):** `PruneMap.vue`, `SchemaField.vue`, `AppShell.vue`, `SetupWizard.vue`, `ConfigView`, `CommandsView`, `RewardsView`, `AnalyticsView`, and the other frontend views and `components/` (looked at only where a composable finding touched them), `routes/{monitoring,analytics,auth,rewards,guildConfig,setup}.ts`.

**Not inspected:** `core/shell/` (not present at the path the reviewer expected), `scripts/` (apart from two greps), `src/web/frontend/src/components/**` and `views/**` beyond the lines the findings touch, the `tsconfig*.json` files, the generated `schema/wire/openapi.json`. Absence of findings in these areas is not evidence of cleanliness.

**Checks run:** grep and small scripts for usage counts, dead-export checks across `src` and `tests`, CSS-body comparison. The lead reviewer independently re-verified by grep: the 11 `x-api-key` sites, `supportsTps` (always `true`), `contractHasBlockingGaps` and `VariablesMap` (no callers), the `getList` fallback, the `milestones` type drift, `.tap` in 17 SFCs and absent from `style.css`, three `messageOf` copies, two `PAGE_SIZE` declarations, `parseErrorList` and `COLOR_KEYS` (no references), four `.card` definitions, the duplicated upgrade/prune endpoints, the rule-9 casts, the whitelist `getServerInstance` call, the shared `"statusMessages"` key, the `save…Store` call sites in `challenge.ts` and `watch.ts`, eight `requireServer` definitions, six `OPERATION_FAILED` constants, 36 `HttpError(502` sites, 31 `sessionFromRequest(req)!` sites, the two `FILE_ID_RE`, the four clamp helpers and the `requireAdminSession` comment references. The third-pass reviewers also ran a dead-export counting script; one reviewer reported an earlier broken version and its rerun. **Not run:** linters, duplication or complexity tools, tests (no installs were approved or needed; this was a static audit). Behavioural claims (CC-002 downtime count, CC-004 lost sessions, CC-017 add-failure result, CC-020 stale list) come from reading the code, not from reproducing them.

**Assumptions that could change conclusions:** "dead" exports were checked by static reference across `src` and `tests`; dynamic or reflective use was not ruled out for every name. Severity assumes the dashboard and the bot are in active use, as the git history suggests.

## 5. Conclusion

The highest-leverage work is three seams: one wrapper fetch path (CC-001, which also absorbs CC-019), `kvMutate` for the remaining whole-document stores (CC-004, with CC-026 and CC-028 removing the invitation to regress), and one shared helper set for backend routes (CC-007, CC-006, CC-020, CC-021). `getList` semantics (CC-002) and the guild scope list (CC-003) are small changes with outsized safety benefit. On the frontend, the `ModsView` split (CC-008) and the shared CSS and feedback helpers (CC-009, CC-010, CC-022) pay off most. Two items from the `core/utils` pass should be handled before any refactoring: the link-code replay (CC-038) and the empty `allowedServers` fail-open (CC-039) are behaviour bugs, each fixable in a few lines with a regression test. After them, the shared helper seams that recur across the pass are `tryLoadConfig`, `MS` for every duration, and one quote-aware scanner for the config adapters (CC-054, CC-050, CC-051). `core/utils/**`, the frontend composables, `src/bot`, `src/schema` and `core/db` are now covered by full reads. Three more items should go ahead of any refactoring: the Windows command import (CC-067), the `/console tail` length (CC-068) and the permanent-ban/temp-ban interaction (CC-071), each a small fix with a test. The shared helper seams that recur across all three passes are a latest-wins loader and one polling helper in the frontend (CC-073, CC-074), one `tryLoadConfig` and `MS` everywhere (CC-054, CC-050, CC-081), and one admin-permission leaf module in the bot (CC-077). The principal remaining limitation is the frontend views and components, which were looked at only where a finding touched them.

## 6. Planned feature: cross-server chat relay

Not an audit finding. A feature extension, planned while the findings above are being fixed. Full plan: `docs/dev/cross-server-relay.md`.

- A message in one guild's chat-bridge channel is relayed to the other guilds' bridge channels that share the same Minecraft server and the same opt-in `relayGroup`.
- Sender name: the linked Minecraft name, otherwise a censored Discord display name. No avatar, no Discord id, mentions and emoji rewritten to plain text, attachments replaced by placeholders.
- Consent: a pinned notice per channel and a per-user opt-out. Edit and delete sync uses an in-memory map only.
- Built after this wave merges, because it touches `chatBridge.ts` and the shared per-channel send queue.

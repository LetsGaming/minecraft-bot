# Wave 1 summary

What Wave 1 changed, what it left open, how it was verified and how to ship it. The findings (F01 to F73) are in [wave1-audit.md](wave1-audit.md); this page records the outcome. Where this page and the code disagree, the code is right.

Repos: BOT (this repo), WRP (`minecraft-server-api`, the wrapper), SETUP (`minecraft-server-setup`, which pins WRP as a submodule). Each repo's `CHANGELOG.md` `[Unreleased]` section is the detailed, user-facing list.

## What changed, per phase

Phase names follow the audit's workplan; the split phases (`07a/07b`, `09a/09b`) are what the branches were actually merged as. The mapping of the closed findings is from the branch history and changelogs, not a line-by-line re-audit.

| Phase | Repos | Closed | What it did |
|---|---|---|---|
| w1-01 server resolution | BOT | F03, F07, F58, F59 | One shared resolution rule (`core/utils/server/guildTargets.ts`), `server:` option on `/whitelisted /stats /top /leaderboard /playtime /compare`, `/daily-admin` tenant check, `timezone` and `featureNudges` no longer dropped, dead checks and `getGuildServerId` removed. |
| w1-02 in-game `!chunkbase` | BOT | F18, F19 (partly with w1-06), F20 | Click event follows the server's Minecraft version and the URL is printed, `!commands` lists every folder, seed log poll restored. |
| w1-03 analytics range | BOT | F38 | Every Analytics panel honours the range, clamped to retention, typed in `@mcbot/schema`. |
| w1-04 `/players` | BOT | (request item 8.4) | New roster command and `playerRoster.ts`. |
| w1-05 contract coordination | BOT, WRP, SETUP | F11, F12, F68 (WRP side), F69, F70, F71 | Per-route response schemas in WRP, generated `openapi.json` (replaces `openapi.yaml`), vendored and drift-checked in BOT (`wire:sync`, `wire:check`), e2e covers the whole surface from the manifest, contract CI against the pinned submodule commit, Dockerfile generates the schema, `stats-bulk` expected. |
| w1-06 command outcomes | BOT, WRP | F01, F02, F19, F20, F21, F22, F23, F24, F25, F26 | `CommandOutcome` and `ServerInstance.send`, `rcon-command` v2 and 502 in WRP, moderation and whitelist abort when the server was not reached, schedulers retry, tips and cooldowns recorded only on delivery, `QueryResult` for player queries, reward bypass and the `sendCommand` shim removed, writes through the circuit breaker. |
| w1-07a/b config pipeline | BOT | F09, F31, F32 (partly), F33, F34, F35, F36 (partly), F37 | `configVersion` and automatic migration with backup, `config_structure.json` removed, schema bounds, typed `ApiError`, `useEditableDocument` with per-field conflict choice, per-guild hash, applied-status chip, dashboard config reload, `watchConfig` on the directory, wizard no longer drops sub-keys. |
| w1-08 wrapper and scripts hardening | WRP, SETUP | F04, F05, F06, F08, F13 to F17, F39 to F51, F63 (partly), F64 to F66, F67 (partly), F72 | Restore and rollback validate, stage and refuse while online; backup verification, umask 077, per-instance locks, tier-aware cleanup; download verification; sudo child env; 32 character key; slug rules; log line and SSE fixes; webhook `curl` bounds; mod scripts serialized; config PUT body limit; `orphanedDependencies` dropped. |
| w1-09a bot reliability | BOT, WRP | F10, F27 to F30, F52 to F56, F57 | Live config for the chat bridge, TPS, schedules and timers, instance rebuild on changed settings, script timeouts from the manifest, `trustProxy`, OAuth state cookie, `sessionEpoch`, icon proxy caps, process guards, dependency bumps. |
| w1-09b split and i18n | BOT | F60, F61 (mostly), F62 (`serverAccess` only) | `serverAccess.ts` is a barrel over `access/*`, hard-coded English moved to `t()` with German text, `i18n:check` fails on new literals. |
| w1-10 mod version check | BOT, WRP, SETUP | (request item 10) | `mod-compat` job in WRP, `check-updates.js --only`, dashboard panel and guard limits in BOT. |
| w1-12 mod config editor | BOT, WRP | F08 follow-up | Nested and non-TOML config adapters (Xaero text, Forge `.cfg`, YAML, INI), grouped file list, honest read-only handling. |
| w1-11 docs | all | F68, F35 | This sweep: stale docs fixed, changelogs consolidated, this page. |

## Deferred or only partly done

- **F61 residual English.** The literal lint covers only the roots in `LINT_ROOTS` (`scripts/lib/i18nLiteralLint.mjs`) and Discord reply sinks. Text outside those (dashboard strings, in-game whispers, log lines, some helpers) was not audited and can still be English. The allowlist (`scripts/i18n-literal-allowlist.json`) holds the accepted exceptions.
- **F40 download hardening** covers mod and vanilla server jars (sha512 and sha1, temp file then rename). Other downloads in the setup suite (loader installers, modpack archives) were not changed.
- **F63 parsers.** The Node update scripts share `lib/` helpers now, but the shell `variables.txt` loader, the Node loaders and the wrapper's `parseVars.ts` are still three parsers and one of them still `source`s the file.
- **F67.** `.claude-flow/` is untracked, but SETUP still tracks `variables.json`.
- **F32.** Validation errors are shown per section, not per leaf field, and the raw `ConfigView` still has gaps compared with the mods tab.
- **F42.** Mutating mod scripts are serialized per instance in WRP, but check runs bypass that mutex by design (read only), and the scripts themselves take no file lock.
- **Guard limits.** The compat admission caps and the dashboard rate limits were tuned by judgement, not measurement, and live in process memory; a restart clears them. The cross-file key search in mod configs was not built (the filter searches names and the open file only).
- **F62** is done for `serverAccess` only. `scripts/setup.mjs`, `statusEmbed.ts` and the oversized route functions are unchanged.
- **Cleanup not done:** deleting the stale `../minecraft-api-server` checkout (a manual step, decision D14), and the vitest-family `npm audit` advisories (dev only, need a vitest major).
- **Small leftovers found in this sweep (not fixed, docs only phase):** `scripts/e2e-dashboard-reports.mjs` still defaults `WRAPPER_DIR` to `../api-wrapper`; WRP `variables.example.txt` still says an empty `API_SERVER_KEY` disables authentication; SETUP example variables still list `server_stop` and `storage_warning` webhook events that are never sent.

## Verification status

Run by the implementing agents on a Windows host: BOT `npm test`, `typecheck`, `lint`, `layout:check`, `schema:check`, `i18n:check`, `wire:check`; WRP `npm test`, `typecheck`, `lint`, `build`; `e2e:contract` against a built WRP where wrapper-facing code changed. For this docs phase only `i18n:check`, `layout:check`, `lint` and a link and path check over all three doc trees were run; the code was not re-tested.

Not run, and why:

- **Docker:** not installed. The Dockerfile schema generation, compose changes and the image build are unverified.
- **shellcheck:** not installed. Bash changes were reviewed by reading and covered by the shell characterization tests under SETUP `tests/shell`.
- **sudo, screen, systemd, inotify, `flock`:** not available on Windows. Their behaviour (the sudoers `node` grant and the `restore.sh --file` wildcard rule, `screen` fallback, `--install-units`, directory watching of a renamed `config.json`, lock fallback from `flock` to `mkdir`) was verified by reading and with simulated tests only. The e2e routes that spawn `sudo -n` check the failure shape locally and need `E2E_REQUIRE_SUDO=1` in CI to prove success.
- **Script routes:** 9 wrapper routes that run suite scripts are verified only in CI, not on this host.
- A real Discord gateway and a real Minecraft server were not used.

## Merge and deploy order

1. **WRP** first. It ships the new routes and shapes; the compatibility policy is that the wrapper goes before its clients.
2. **SETUP** second: bump the WRP submodule pointer to the merged WRP commit (see SETUP `docs/wrapper-submodule.md`), then merge the script changes. SETUP's wrapper contract workflow tests the pinned commit against the bot.
3. **BOT** last. Its contract CI checks out WRP's default branch and the pinned commit, so it is red until the first two have landed.

Release notes for operators, in this order: update the wrapper and setup suite on each Minecraft host (keys of at least 32 characters, `node` sudoers grant), then the bot, then check the startup report. Existing servers need a restart only for the script changes; the first bot start migrates `config.json` and keeps a backup.

## Compatibility notes

- **Bot older, wrapper new:** breaks where the wrapper changed a shape on purpose: `POST /command` now answers 502 when nothing delivered it and a different body shape, rate limit and compat overload answer 429, and the key length is enforced. Update the bot after the wrapper; do not run an old bot against a new wrapper for long.
- **Bot new, wrapper old:** works with degraded features, reported at startup: `rcon-command` v1 (a failed send cannot be detected), no `stats-bulk` (per-player reads), no `mod-compat` (panel hidden), no config index (old limits), no `scriptTimeoutsMs` (built-in table).
- **Config:** a migrated `config.json` still loads in 6.x, which warns about the unknown `configVersion`. Rolling back means copying the `.bak-v*` file over it.
- **Wire types** are generated from WRP's `openapi.json`; a wrapper route change needs `wire:sync` in the bot in the same release train.

## Remaining debt

Everything under "Deferred" above, plus: test gaps listed in F73 that Wave 1 did not close outside the touched areas, Linux-only behaviour that is simulated rather than run in CI, the oversized `scripts/setup.mjs` and `statusEmbed.ts`, and the hand-written `parseManifest` that must be kept in step with the manifest by hand.

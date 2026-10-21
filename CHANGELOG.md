# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **The Config page is easier to read.** It shows one group at a time in a single column and, by default, only the settings you have set in `config.json`; the rest sit behind "Show N more, at default", and a "Show all settings" switch reveals everything. A summary line says how many settings are configured (`ConfigView.vue`, `ConfiguredFields.vue`).
- **Per-guild settings moved out of Config.** Edit a guild on its own page, `#/guilds/<guild id>`, with tabs for General, Chat bridge, Leaderboard, Alerts and status, Support and access, and Commands. It replaces the old dialog and keeps its own save (`GuildConfigEditor.vue`). Raw JSON still shows the whole `guilds` block, and "Advanced JSON config" on the Guilds page now opens it.
- Fields are lighter: the config key is a small copy chip, long help is one line with More, empty inputs show the default that applies (or "Not set"), and a dot before the label marks a change or an error. The colored left edges on changed, error and section rows are gone.
- **The Daily rewards page is rebuilt.** Three tabs (Item pool, Streak milestones, Bonus chance) under an always-visible "What players get" strip: the chance of each rarity as a bar and a **Preview a claim** that rolls one from the draft with the bot's own draw. The pool is a compact table you can filter, sort and page; streak days are a timeline with a panel (a sheet on phones) for the selected day; removing something offers **Undo**, "Start from the defaults" asks first, and the edit bar counts what you changed ("2 added, 1 removed") and lets you review it (`RewardsView.vue`, `components/rewards/`).
- **A server's daily rewards are now exceptions to the shared pool, not a copy of it.** The server page shows the shared entries marked "Changed here", "Only here", "Not used here" or "Kept from shared", so a new item added to the shared pool reaches every server that did not opt out. A server file (`dailyRewards_<serverId>.json`) now lists `add`, `remove` and `set` per entry, `removeDays` and a `bonusChance` (`src/schema/rewardPatch.ts`, `rewardsConfig.ts`).
- **Reward entries have ids.** The same item may be listed several times with different amounts and weights; an optional `id` on each entry tells them apart and is what a server's exceptions point at. The dashboard saves one on every entry.
- **Old per-server files are converted on the first start**, by the bot and the dashboard. Each is rewritten as exceptions only after the result is proven to give the same rewards, and the original stays next to it as `<file>.pre-exceptions.bak`. A server file that was an exact copy of the shared pool now follows it, and its file is removed. A file with its own problems is left alone and keeps working. `npm run rewards:migrate -- --dry-run` shows what would happen first (`core/rewardsMigration.ts`, `scripts/migrate-rewards.mjs`).

### Added

- **Saving the shared reward pool shows what it does to each server.** A dialog lists, per server, the entries it would remove, change or add, and lets you keep an entry as it is on a server or leave a new one out of it; those choices are written into the servers' files first and the shared pool last, and nothing is saved if a server's file cannot take its change (`SharedImpactDialog.vue`, `rewardsSave.ts`, `POST /api/rewards/impact`).
- **Keep as it is on this server.** A server can hold its own copy of a shared entry, so later edits to the shared one no longer reach it, and follow the shared entry again later.
- **A lucky bonus (the extra draw from `bonusChance`) now stands out in the `/daily` embed.** It gets its own full-width "Lucky bonus" field with the item and its rarity, the embed turns the success colour (a streak milestone keeps its milestone colour), and the footer says "Lucky draw: you got an extra reward!". The queued embed for an offline claim shows the same field (`dailyEmbeds.ts`, `en.ts`, `de.ts`; the old `daily.randomBonus` text is replaced by `daily.luckyField` and `daily.luckyFooter`).

### Fixed

- **`/daily` no longer refuses an offline claim because of unrelated queued items.** The cap of 3 waiting rewards counted every entry queued for the player, including items still owed from an online claim that could not all be handed over and challenge bonuses that failed to deliver. Only offline daily claims use up a slot now (`dailyClaim.ts`, `dailyStore.ts`).
- **The Daily rewards editor no longer reports unsaved changes after you only click into a chance or weight field.** Leaving a field without typing used to rewrite that item's weight from its rounded display value (for example 10 became 10.002) and light up the save bar (`useDailyRewards.ts`).

## [8.3.0] — 2026-10-20

- Internal updates and minor improvements.

## [8.2.0] — 2026-10-20

### Added

- The Docker web profile works straight from the config template: the dashboard is enabled by default and shows its setup page until the OAuth secrets are set.
- **Cross-server chat relay.** Chat bridges that name the same `relayGroup` and are bound to the same Minecraft server forward their Discord chat to each other, as `Name [Label]` with no Discord avatar, Discord ID or pings (linked members show their Minecraft head).
- **`/bridge optout` and `/bridge optin`.** A member keeps their messages in one Discord server out of the relay, per server; each relayed channel gets a pinned notice listing the other servers with an opt-out button.
- The setup wizard's chat bridge step has a label field and shows the bridge's relay group (read-only).

### Security

- **Only a bot admin can set a relay group.** A guild manager's dashboard write that adds, changes or removes `relayGroup` is refused, and a block that omits it keeps the group on disk, so nobody can join another community's group by typing its name (`guildConfig.ts`).

### Fixed

- Containers can reach a Minecraft API wrapper running on the Docker host through `host.docker.internal`, including on Linux.
- The setup wizard's Docker instructions match the compose setup, and the obsolete RCON password and `say` command settings are gone from the example files.
- **The Mods summary strip no longer shows green checks it cannot back up.** When the server is offline or the mods list could not be read, the tiles show a neutral dash with "Unknown, server offline" (or "Unknown, mods list unavailable") instead of "Compatible" and "running server is up to date", and Add mods notes "Applies on next start" (`ModsView.vue`).
- The Config page no longer repeats "the bot is not running" under the editor bar when the app-wide banner already says so; the "Saved, not applied" chip stays (`ConfigView.vue`).
- **Mod config shows only the error when the file list cannot load.** The status bar, filter, empty file list and "Pick a file to edit" no longer sit around the failure; it names the likely cause (wrapper not answering, wrapper too old, dashboard error) and offers Retry (`ModConfigView.vue`).
- **Prune says which half is too old.** The unsupported state now tells apart an API wrapper that does not report chunk pruning from a setup suite without the prune script, and what to update (`/api/servers/:id/prune/support` returns `missing`, `pruneSupportGap` in `access/prune.ts`).
- **Prune chunks reads as three steps.** The rules (what counts as unused) come first and fold away once there is a result, the result and map follow, and Delete is its own section at the end.
- Prune's Delete section ends with one summary (chunks deleted of the total, space freed, and the backup note) directly above the button, and says to scan again when the preview is out of date.
- **Phone layouts are tighter.** The save bar at the bottom of Config, Daily rewards and the other editors is one status line when there is nothing to save (instead of a row of disabled buttons), Config's "Jump to group" list follows the group you scrolled to, item-pool rows in Daily rewards label their amount and chance and keep the delete button beside the name, and the Mods pager, Rewards inputs and chance toggle meet the 44 px touch size (`EditBar.vue`, `ConfigView.vue`, `RewardsView.vue`, `PagerNav.vue`).
- **Numbers follow the dashboard's language, not the browser's.** A browser set to German no longer shows "1.400" next to English text or "283,7 Mio.
- Daily rewards shows each rarity as a square pip in that tier's own embed colour instead of an emoji circle, and the Prune chunk map sits on a faint block grid until regions are painted (`RewardsView.vue`, `PruneMap.vue`).
- Config's "Saved, not applied" chip now reads "Saved, waiting for the bot"; Daily rewards' "Weights to 100" is "Rescale weights to 100" with its explanation shown under the toolbar instead of a hover title.
- The Config schema description for feature nudges no longer names an internal type (`config.schema.json`).
- Stale-data notices ("the bot last reported", "as of" on Mods and Mod config, an unfinished prune) say "3 weeks ago" or "2 months ago" instead of a raw timestamp once older than a week (`relativeAgeLong` in `relativeTime.ts`).

## [8.1.0] — 2026-10-19

### General

- Discord messages get their own look per kind: joins, leaves, deaths, advancements, chat, milestones, rewards, leaderboards and whitelist prompts each have an icon and a colour instead of one shared grey or blue (`src/schema/embedCategories.ts`, `createEmbed` `category`).
- Error embeds carry a ⛔ icon in the title.
- **The dashboard's Mods page is laid out like the new mockup.** A summary strip shows how many mods are installed, the compatible Minecraft version and loader, and how many changes wait for a restart, next to an Add mods button.

### Security

- **Guild managers can no longer make themselves bot admins or reach other servers.** In the dashboard, a guild manager's save keeps the guild's `adminUsers` and `allowedServers` as they are on disk (sending a different value is refused) and may only reference servers the guild can already use; an unknown server id is an error instead of a warning.
- **Players can't impersonate each other in chat.** In-game `!commands`, the chat bridge and the sleep prompt now read the speaker only from the server's own `<name>` at the start of the chat line, so text like `x]: <Admin> !link 123` inside a message, a `/me` line, or Discord text relayed with `/say` no longer counts as another player speaking.
- **Rolling a world back needs `server:rollback`.** The dashboard's rollback action required only `server:control`; it now requires the `server:rollback` capability, and the Roll back button is shown only to users who hold it.
- **The config editor no longer hands out the RCON password.** `config:read` showed `server.properties` and plugin configs verbatim, and `config:write` could change RCON, `online-mode`, whitelist and op settings.
- **The console deny-list catches namespaced and `execute` spellings.** `minecraft:op`, `bukkit:stop` and `execute … run op …` were not matched by a `stop`/`op` entry; the command word now loses any `namespace:` prefix and every command after `run` is checked.
- **Cross-site writes to the dashboard API are refused.** The session cookie's `SameSite=Lax` let a page on another port of the same host, or on a sibling subdomain, post to the API with the user's cookie (restart, rollback, restore need no body).
- **A mod slug or prune dimension can no longer reach another wrapper route.** A slug of `..` turned `/mods/../update` into `/update` once the URL was parsed.
- **Release builds no longer run third-party code with publish rights.** The release workflow is split into a read-only gate (tests, the wrapper checkout and build) and a publish job; actions are pinned by commit, checkouts don't keep the token, the gate's wrapper ref comes from the `WRAPPER_REF` repository variable, and the contract workflow passes its `wrapper_ref` input through the environment instead of pasting it into a script (`.github/workflows/{release,contract,ci}.yml`).
- **Local `docker compose build` no longer copies configs or databases from the working tree into the image.** `.dockerignore` excluded `config.json` and `data/` files only at the top level, so `data/agent-*/config.json`, a `data/config.json` or `bot.db` could end up in a locally built image; `data/` is now an allow-list (`.dockerignore`).
- **A used `!link` code can no longer be replayed to take over another player's link.** After a successful link the code stayed valid until it expired, so another player who had seen it in chat could use it to swap the Minecraft name on that Discord account.
- **An empty `allowedServers` list now means no servers.** In a setup with several guilds the empty list was read as unrestricted, so a guild an operator meant to lock out could reach every server.
- **The console deny-list catches `return run <command>` and a literal `run` token.** It only unwrapped the first `run` of an `execute` chain, so `return run op <name>` or a player named `run` slipped past it (`schema/consoleCommands.ts`).
- **Server control confirm buttons re-check targeting when they are pressed.** Stop, restart and the stats prune now check that the guild may still target the server at press time, not only when the command was run (`bot/commands/server/control.ts`).
- **Two admins can no longer both act on one whitelist application.** The first decision claims the application; a second approve or deny is told it was already handled, and approval re-checks that the stored server is still visible to the guild.

### Added

- **A Players page in the dashboard** (under Monitor, capability `server:read`).
- **Analytics has Players and Server tabs.** Players (default) holds the activity chart, the leaderboard and a players list with Active, Gone quiet and New filters; Server holds uptime and command usage.
- **Edit daily rewards in the dashboard.** The new Daily rewards page (under Manage) edits the shared pool and each server's override: search items by name instead of typing ids (vanilla list bundled, any modded id accepted), set chances in percent or as weights (weights stay what is stored; a percent edit changes only that item's weight), see each item's rarity tier and "1 in N claims", edit streak milestones and the bonus chance.
- **Prune unused chunks from the dashboard.** The new Prune chunks page (capability `server:update`) scans a world for chunks nobody used (InhabitedTime below a threshold), shows a per-dimension summary and a map (decision or time used, region grid, protected zones you draw), and deletes them as a job that stops the server, backs it up and restores the backup if anything fails.
- **Upgrade a server's Minecraft version from the dashboard.** The new Upgrade page (capability `server:update`, typed confirmation) runs one supervised job on the host: warn players, save and stop, archive backup, install, start and watch.
- Wrapper features `operations` and `lifecycle-events` are expected by the startup report; on an older wrapper, stop, backup, restore and mod writes can still overlap, as before.
- **A livelier `/daily`.** The claim shows your head, the reward with a rarity badge (common to legendary, from how rare the item is in the pool), a streak progress bar, the next milestone and the next claim time.
- `/streak` shows a progress bar and a milestone track; `/daily-history` and the streak leaderboard use flame icons, the leaderboard shows the leader's head, and the daily reminder DM is an embed.
- **Appearance page in the dashboard** (sysadmins): pick the color of every embed category and rarity tier, with a live Discord-style preview on dark and light backgrounds and a warning when a color is hard to see (`views/AppearanceView.vue`, `composables/useEmbedColors.ts`).
- `embedColors` in `config.json` recolours any embed category or rarity tier (`#rrggbb`; `src/core/configValidation.ts`, `docs/admin/configuration.md`).
- **A map you can move around, and choose chunks on by hand.** The Prune chunks map now fills the page instead of being sized to the whole world (a large world no longer needs hundreds of megabytes of canvas): scroll to zoom, drag to move, pinch on touch screens, arrow keys, plus and minus and 0 (fit).
- **The prune map works from the keyboard.** Focus it and the arrow keys move a cursor from chunk to chunk (Shift jumps eight, the view follows), Space chooses or unchooses the chunk, Enter inspects it, and what is under the cursor is read out.
- **A terrain view for the prune map.** Pick **Terrain** and zoom in: each region is drawn from above (water, sand, grass, stone, relief) with the usual colours over it, so you can tell what you are selecting.
- **Keep chunks that look built, and look inside a chunk.** Unused chunks that hold chests, signs, beds, furnaces or modded blocks that no village, mineshaft or dungeon explains are kept as "looks built" (grey on the map, a column in the summary, an option to turn it off).

### Changed

- **Activity history is kept for 90 days instead of 14** , so the Analytics chart can show a quarter.
- **Player sessions are kept for 365 days instead of the last 20 per player.** Sessions moved from one JSON document into a `player_sessions` table (migration 7); the existing document is imported once at startup and kept under `sessions.migrated` for a rollback.
- **Dashboard: the command usage panel names the right permission.** It reads bot-wide data and needs `audit:read` under `"*"`, but its error text said `server:read`.
- **The shipped reward pool moved to `data/dailyRewards.defaults.json`.** `data/dailyRewards.json` is no longer tracked in git: it is created from the defaults on first use and then belongs to you, so editing it never conflicts with an update again.
- Reward files are now checked when read: invalid entries (an id with spaces, amount 0 or above 6400, a weight of 0 or less, an empty milestone) are skipped and logged once instead of failing at `/give` time.
- The startup report expects wrapper feature `chunk-prune` version 2, which the Prune chunks page already uses; a version 1 wrapper is reported as outdated (`src/core/utils/server/wrapperContract.ts`).
- Prune: the classes drawn over the terrain picture are more transparent, so the terrain stays recognisable under the heat and decision colours (`components/PruneMap.vue`).
- Prune: a **Chunk colours** slider in the terrain view (0–100 %, default 30 %) sets how strongly the colours cover the terrain picture; at 0 % only the terrain, your selection, protected zones and the grid are drawn.
- Prune: the page is laid out around the map.
- Starting an upgrade with a stored prune plan that no longer exists now says to scan again instead of a generic failure (`web/backend/routes/upgrades.ts`).
- **Prune chunks scans only what you choose.** The Prune chunks page lists the world's dimensions (from directory listings, no chunk is read) and scans, caches and prunes only the ticked ones.
- **A down wrapper no longer holds up every write.** Script runs, mod changes, config saves, backup restore and delete now fail fast while the circuit breaker is open, as reads and console commands already did, instead of each waiting out its full timeout.
- **TPS and disk alert levels follow one shared table.** The dashboard and the bot now agree: a TPS below 12 is an error (it was below 10 for alerts), and a disk alert below the critical level is amber with a warning-level ping (`schema/thresholds.ts`, `bot/logWatcher/watchers/monitors/tpsMonitor.ts`, `hostResourcesMonitor.ts`).
- **Leaderboard rows read `** Name**: value`, in the guild's language.** Stat names and numbers follow the language (German gets German names and `19,8`), and a scheduled leaderboard is built in each guild's own language instead of mixing the default language into titles and footers (`core/utils/minecraft/statUtils.ts`, `bot/logWatcher/watchers/schedulers/leaderboardScheduler.ts`).
- **Messages from the log no longer stall each other.** Chat, join, death, advancement and server-event messages go through one ordered queue per Discord channel and their follow-up work runs detached, so a slow Discord channel or a slow wrapper call no longer holds up the other watchers or in-game commands of that server (`bot/logWatcher/watchers/sendQueue.ts`, `log/*`).
- **Status, presence, downtime alerts and the activity chart no longer show or record 0 players when the list could not be read.** They fall back to the health counts or `?`, or skip the sample (`core/utils/server/server.ts`, `bot/commands/info/status.ts`, `monitors/downtimeMonitor.ts`).
- **Dashboard errors from wrapper calls are uniformly 502 with the code `BAD_GATEWAY`.** The failure text points to the dashboard (web) logs, not the bot logs; `dryRun`, `refresh` and similar flags accept `1`, `true`, `0` and `false`; `?lines=0` on the log tail returns one line; update-all is audited as `mod update-all`; a mod config revert also refreshes the file list, and mod changes clear the last-known installed list (`web/backend/routes/*`).
- **The config editor is stricter about numbers and layouts.** A whole-number setting rejects fractions and numbers beyond 2^53 in every format, duplicate JSON keys and values continued over several YAML lines are read-only, and the queued-edit preview skips read-only files exactly as the flush does (`core/utils/configfmt/*`, `core/utils/wrapper/queueFlush.ts`).
- **`/config reload` reports every changed top-level setting and servers that failed to start.** The summary now includes `timezone` and `schedules`, a reload that only reorders keys no longer rebuilds a live server, and a server that fails to start is named and retried on the next reload (`core/utils/config/configDiff.ts`, `bot/utils/applyConfig.ts`, `bot/logWatcher/initMinecraftCommands.ts`).
- **If the config cannot be read while the bot runs, commands are locked instead of silently open** (`core/utils/commands/commandPolicy.ts`).
- **`/server prune-stats` lists the orphaned stats files and deletes them after a confirm button.** The `confirm:` option is gone (`bot/commands/server/control.ts`).
- **`/help` lists each subcommand as `/cmd sub` with its options; `/backup` sizes use one decimal and a dot; `/config show` lists every guild feature including console, translated** (`bot/commands/general/help.ts`, `backup.ts`, `admin/config.ts`).
- **Sleep prompts and in-game `!` command texts are translated.** English deployments get English sleep prompts, German keeps its current text, and the `Please wait` reply of in-game commands follows the language (`core/locales`, `bot/logWatcher/watchers/log/sleepWatcher.ts`, `bot/logWatcher/commands/*`).
- **Server autocomplete follows the same visibility as the commands.** An operator now sees every server in autocomplete, matching what the commands accept (`bot/utils/autocomplete.ts`).
- **Dashboard: job polling gives up after six failed polls.** If a running upgrade, prune or compat job cannot be read six times in a row, the page stops polling and shows an error instead of retrying forever; toasts share one set of lifetimes (`composables/usePolledJob.ts`, `composables/useNotify.ts`).

### Removed

- **`/top` is gone; use `/leaderboard`.** The two commands were the same command under two names.
- **The dashboard route `GET /api/servers/:id/analytics/players`.** The Players page's `GET /api/servers/:id/players` replaces it; nothing outside the dashboard used it.
- **The `servers.<id>` block inside `dailyRewards.json` is no longer read.** Per-server pools live only in `data/dailyRewards_<serverId>.json` (same contents).
- **The top-level `leaderboard` config key.** It was never read (the leaderboard is configured per guild).

### Fixed

- **One player, one head.** Heads went by the player's UUID once the bot had read the usercache and by name before, so the same player got two head URLs depending on timing (a player who joined since the last read was not cached yet).
- **Prune map: a terrain picture that fails to load is tried again.** A failed request (a busy wrapper, a proxy timeout, a dropped connection) left the region without terrain until the dimension was switched, and said nothing.
- **"Back to the form" after an upgrade or prune stays on the form.** The page reloaded its data, found the job it had just closed (a finished job is shown for a day) and opened its log again.
- **Joins, leaves, deaths and advancements work again on Minecraft 26.3.** 26.3 writes every message the server sends behind `System chat: ` (`[Server thread/INFO]: System chat: Steve joined the game`), which the event watchers did not accept, so those Discord posts, sessions, milestones and challenge wins stopped.
- **Upgrade and prune progress no longer leaves "Warn players" and "Save and stop" on ⏳.** The setup suite only reports that these two steps started, so the Discord message and the dashboard showed them as still running after the job had finished.
- **Switching servers on the Backups page can't act on the previous server any more.** Switching while the list was still loading kept the old server's archives on screen under the new server's name, so delete, restore and download went to the old server.
- **Switching servers on the Console page no longer shows the previous server's stream.** A switch during the connection's first request left the old stream attached and open (`composables/useConsole.ts`).
- **Two dashboard config saves at the same moment no longer undo each other.** Saves for two different guilds (or a save and a rollback) are made one at a time, each against the file as it is then (`core/utils/config/configService.ts` `withConfigWriteLock`, `web/backend/routes/{config,guildConfig}.ts`).
- **Guild managers see only their own guild in config validation messages,** and a failed save no longer shows them the config file's path (`web/backend/routes/guildConfig.ts`).
- **`/server stop` and `/server restart` answer in time when the wrapper is slow.** The confirmation waited for the player list and could miss Discord's three-second window ("The application did not respond"); a list that failed was shown as "nobody online".
- **In-game `!commands` enabled by a config reload work without a restart.** They were logged as loaded but never reached the running log watchers (`logWatcher/initMinecraftCommands.ts`).
- **The status embed recovers from a deleted channel and no longer piles up copies.** Any error editing the status message posted a new one and left the old showing a stale status; now only a deleted message is replaced, and a deleted channel is set up again on the next cycle (`schedulers/statusEmbed.ts`).
- **Mod config edits are checked against the setting's type.** The string `"false"` could be written as `true`, a non-list emptied a list, and an empty value became `0`; a value of the wrong kind is now refused, and a save that would not read back as entered is not written (`core/utils/configfmt/index.ts`).
- **The bot container's health check means something.** It checked that PID 1 was node, which is always true; it now fails when the bot's heartbeat (`data/runtime.json`) is older than 150 seconds (`Dockerfile`).
- **`docker stop` stops the dashboard cleanly.** It had no SIGTERM handler, so Docker waited out its timeout and killed it; it now closes console streams, the HTTP server and the database first (`web/backend/index.ts`).
- **The container's first `config.json` keeps `$schema` and survives quotes in secrets.** The template was rendered with `envsubst`, which also blanked `"$schema"` and produced invalid JSON for a value containing `"` or `\`; it is now rendered by a small script that only fills `${VARS}` and escapes them (`scripts/render-config-template.mjs`, `docker-entrypoint.sh`; the image no longer installs `gettext-base`).
- **Starting the bot and the dashboard together on an old database no longer crashes one of them,** and one malformed row in a legacy JSON file (a link without a Discord id, two whitelist names that differ only in case) is skipped with a warning instead of blocking startup.
- **A lapsed streak shows as 0.** `/streak` and the streak leaderboard showed the streak stored at the last claim, so someone who stopped claiming kept their place on the board until they claimed again (`core/utils/minecraft/rewards.ts` `liveStreak`, `streakLeaderboard.ts`, `daily/streak.ts`).
- **Bumping `webui.sessionEpoch` also ends open console streams,** and one user can hold at most 8 console streams at once (`web/backend/console/streamRegistry.ts`, `routes/console.ts`).
- **Dashboard actions say when a script is still running.** A backup, restart or restore that outlived the dashboard's wait, or that the wrapper refused (for example because another operation was running), was reported as "the wrapper did not answer, so it did not run" and offered back as a one-click retry, which could start it twice.
- **Reverting a mod config checks the file did not change since you opened it.** A revert now names the version it replaces, like a save (needed by wrappers with `mod-configs` version 2).
- **Config edits queued while the wrapper is away get the same checks as a live save.** An edit made against an older copy, to a read-only or unparseable file, or that would not apply, is refused instead of queued; at flush, one refused file no longer stops the rest (`web/backend/routes/modConfigs.ts`, `core/utils/wrapper/queueFlush.ts`).
- **Simultaneous claims, votes and decisions no longer overwrite each other.** `/daily`, the daily reminder pass, queued reward delivery on join, whitelist applications, polls (`/poll`, buttons, `!vote`), `!waypoint` and `/note` used to load a whole store, wait on Discord or the server, and save the stale copy back, which could undo another user's claim (letting them claim twice), deliver or drop queued rewards twice, or put an approved whitelist application back to pending.
- **`/daily` no longer hands out duplicates when a give fails.** The claim is written before the items are given; anything that doesn't arrive is queued for your next join instead of leaving the claim open for a retry that gave the delivered items again (`commands/connection/daily/daily.ts`, locale `daily.partlyQueued`).
- **One busy database moment no longer disables every later save.** A transaction whose start timed out (`SQLITE_BUSY`) left the process refusing all further transactions until restart (`core/db/index.ts`).
- **A broken `config.json` save keeps the last good config running.** A failed reload (file watcher or `/config reload`) dropped the cached config, so every command and dashboard page failed until the file was fixed (`core/config.ts`).
- **A slow autocomplete or failed reply no longer crashes the bot.** Errors from the interaction and Discord→Minecraft message handlers are logged instead of reaching the process guard, which exited (`bot/index.ts`, `chatBridge.ts`).
- **Chat bridge webhooks fall back to the embed form.** A webhook send that fails (a deleted webhook, or a player name Discord refuses, such as one containing "clyde") now posts the message as an embed instead of dropping it, and a deleted webhook is recreated on the next message (`chatBridge.ts`).
- **Discord → Minecraft bridge messages use `/tellraw`.** They show as `[DiscordName] message` (no `[Server]` prefix), are never expanded as selectors, and no longer land in the server log where text could pass for player chat (`chatBridge.ts`, `core/utils/sanitize.ts`).
- **A console command whose RCON reply went missing counts as sent, not as answered with nothing.** Wrappers with the W-005 fix report such a command as `via: "rcon"` with no result instead of running it again through screen; the bot now reads that as `sent` (`rcon-no-reply`) rather than a delivered empty reply (`src/core/utils/server/access/commands.ts`, `src/schema/commandOutcome.ts`).
- **Dashboard "prune stats" no longer deletes every player's stats when the player lists can't be read.** If the whitelist can't be read, or the whitelist and usercache are both empty, the prune is refused instead of treating every player as unknown (`web/backend/routes/servers.ts`).
- The streak leaderboard no longer prints the English "day(s)" in German.
- Prune chunks page: a map that finishes loading after a rescan no longer replaces the new one, and a second request for the same map joins the first (`composables/usePrune.ts`).
- The progress bar of a prune-only job can now reach 6 of 6 (`composables/useServerUpgrade.ts`).
- **Slash and in-game commands load on Windows.** Command modules were imported by plain path, which Node rejects on Windows, so the bot started without any command.
- **`/console tail` no longer fails on long output.** The reply could exceed Discord's 2,000 character limit; it now keeps the newest lines within it (`bot/commands/admin/console.ts`).
- **Sleep prompt: the night check and the in-bed check work.** Every tick counted as night, and a player name containing digits followed by `s` could be read as sleeping (`bot/logWatcher/watchers/log/sleepWatcher.ts`).
- **Scheduled restarts respect a reload and report a failed restart.** A config reload during a restart was overwritten by the old schedule, and a failed restart still announced that it was complete (`bot/logWatcher/watchers/schedulers/restartScheduler.ts`).
- **A permanent `/ban` cancels an earlier timed ban.** The timer used to lift the permanent ban when it ran out (`bot/commands/moderation/ban.ts`).
- **`/streak` shows the bonus streak as 0 once the live streak has lapsed** (`bot/commands/connection/daily/streak.ts`).
- **More death messages are recognised, and advancements with brackets in the title are read whole.** Freezing, lightning, fire, lava, dragon's breath and mace deaths now produce their embed, and a challenge is detected from the message verb (`bot/logWatcher/watchers/log/deaths.ts`, `advancements.ts`).
- **Year-based Minecraft versions (26.1, 26.1.2) are read correctly** in `/status` and `/info` instead of being dropped or misread as 1.2 (`core/utils/minecraft/versionName.ts`).
- **A server ping that times out before connecting counts as an error, not as offline** (`core/utils/server/serverPing.ts`).
- **Queued daily rewards are no longer lost if delivery throws part way** (`core/utils/minecraft/rewards.ts`).
- **The mod browser labels server-unsupported mods as client-only, and mods with missing data as unknown** (`core/utils/modrinth.ts`).
- **Coordinates and dimension lookups work for Bedrock players whose names start with `.`** (`core/utils/minecraft/consoleResponse.ts`).
- **Daily restart and leaderboard times are correct on daylight-saving change days** (`core/utils/time.ts`).
- **A legacy JSON file is renamed to `.imported` only after rows were really imported.** If the table already has rows the bot logs a warning and leaves the file (`core/db/importLegacy.ts`).
- **Database housekeeping:** `MCBOT_VACUUM_ON_START` vacuums only when set to exactly `1`, the bot closes the database on shutdown, a database that fails to initialise no longer leaks its handle, the `npm rebuild` hint appears only for native-module load failures, and migration checksums ignore SQL comments (existing databases keep starting and are upgraded automatically) (`core/db/*`).
- **Concurrent joins, leaves, challenge results and `/watch` changes no longer overwrite each other** , the watch hint respects the limit of 10 and the duplicate rule, and players named `__proto__` or `constructor` no longer break session tracking or the offline reward queue (`core/utils/stores/*`).
- **Uptime data is pruned by age and `/uptime` reads less per call** (`core/utils/stores/uptimeTracker.ts`).
- **`/server prune-stats` and the dashboard prune report a real wrapper error** instead of silently counting 0 deletions; a wrapper without the route still gives 0 (`core/utils/server/access/stats.ts`).
- **Removed and re-added servers start clean.** Alert, cooldown and buffer state no longer survives a server being removed from the config and added again; the leaderboard scheduler warns once about a missing channel instead of every five minutes; milestones beyond the per-pass cap are announced on the next pass; a deleted upgrade message is reposted (`bot/logWatcher/watchers/*`).
- **`/unlink` shows a real error on a database failure** instead of saying you are not linked, and **`/poll create` can no longer open two polls on one server** when two admins race (`bot/commands/connection/unlink.ts`, `general/poll.ts`).
- **In-game `!link` answers `Please wait` on rapid retries and reaches players the bot has not seen since a restart** (`bot/logWatcher/commands/connection/link.ts`).
- **Stats embeds format `...Time` stats as durations, `/mods` asks Modrinth in batches of 100, and relative ages no longer round up** (`59.5 min` no longer reads `60 min`).
- **Dashboard: the setup wizard could write one guild's channel ids into another's config** when responses arrived out of order.
- **Dashboard: Status and Overview no longer leave a polling timer running after you navigate away** , the Commands page no longer marks itself changed just by browsing, and saving overrides for a scope that is not in the config warns instead of claiming success (`composables/usePolling.ts`, `composables/useCommands.ts`).
- **Dashboard: the prune map keeps its undo history when a selection is refused** , keeps selections in dimensions that are not loaded, and a failed item catalog load can be retried; typing in the console while a command runs is no longer wiped (`composables/pruneSelection.ts`, `utils/minecraftItems.ts`, `composables/useConsole.ts`).
- **Dashboard: the guild list names a missing token, a rejected token and an unreachable Discord apart again** after the loader rework (`views/GuildsView.vue`).

## [8.0.0] — 2026-10-12

### General

- **Breaking:** downtime, host and TPS alerts ping `mentionRole` only on the first failure and when severity rises; recoveries and repeats are posted without a ping.
- Discord messages change colour: one status colour per meaning, shared with the dashboard; joins, leaves and deaths turn grey; titles name the action and the server state circle (🟢 🟡 🔴 ⚪) is the only title emoji.
- `/server stop` and `/server restart` ask first with a confirm row that expires after 60 seconds.
- Errors, denials, confirmations and cooldowns are visible only to the person who ran the command; a claimed `/daily` reward is public.
- `/config show` is private and lists servers by wrapper host only, without the token or admin IDs.
- Every dashboard page has its own address; secrets are password fields; toasts appear top right.

### Breaking

- BREAKING: **Alert mentions default to the escalation policy.

### Added

- **Mod icons everywhere a mod is listed.** Installed rows, check progress and results, the blocker summary, the Modrinth catalogue, the version picker and the remove dialog show the project's Modrinth icon, or an initials tile on a stable colour when there is none or it fails to load.
- **`/server stop` and `/server restart` ask first.** The command replies only to you with the number of online players, a red confirm button and Cancel; the buttons expire after 60 seconds and keep working across a bot restart.
- **Alert mention policy.** `guilds.
- **TPS recovery message.** When TPS is back above `tpsWarningThreshold` after a warning, the TPS channel gets a "back to normal" post; a drop below 10 TPS alerts at once instead of waiting for the 5 minute repeat (`watchers/monitors/tpsMonitor.
- Server recovery alerts say how long the server was down (`watchers/monitors/downtimeMonitor.
- **Dashboard links and the back button.** Every dashboard page has its own address (`#/overview`, `#/console/<server>`, `#/mods/<server>?
- **Phone navigation.** Under 760 px the dashboard shows a top bar with a menu button, the page title and the current server; the menu opens a drawer that closes with Escape or a tap outside and returns focus to the button.
- **Density switch.** "Roomy" or "Compact" in the sidebar sets row and control height for this browser (`AppShell.
- **Backups page rebuilt.** Summary tiles (backups, space used, newest), a type filter with counts and a "Latest per type" card, fed by the new `GET /api/servers/:id/backups/summary` route (`server:read`).
- **Config editor rebuilt.** Settings sit in groups (Bot and Discord, Servers, Guilds, Alerts, Leaderboard, Commands and features, Web dashboard) with a group list beside them (a "Jump to group" select under 1100 px) and two or three columns on very wide screens.
- **Server actions show their run on the card.** Start, stop, restart, roll back and back up on the Servers page show a job block with the elapsed time while the script runs; a failed run stays on the card with the exit code, the script output, "Try again" and "Dismiss", and a finished one is a toast that says what happened.
- **Console history and wrap.** Up and Down recall earlier commands, "Wrap long lines" can be turned off, and typing a blocked command says which command is blocked (`views/ConsoleView.
- **Config schema titles and effect notes.** Top-level settings, the server API URL and key, and the dashboard port and session epoch carry a `title` in `config.
- **Console copy, download and clear.** Under the log, Copy puts the lines shown on the clipboard, Download saves them as a `.
- **Sort control on phones.** Under 760 px the Audit log and Analytics tables, shown as one card per row, get a "Sort by" picker and an order button in place of the hidden column headers (`components/ui/SortControl.
- **`/status` shows TPS, how long the server has been online and its version.** TPS is fetched with a 2 second budget and left out when the wrapper does not answer in time; "Online for" comes from the uptime checks and the version from the server list ping, as in `/info`.
- **Downtime alerts say when the server was last seen and who was on it.** The "is offline" alert has a "Last seen" field (a Discord relative time from the last check that found it up) and "Players hit" (the players online at that check; while the wrapper is up the monitor now reads the player list once per check to know this), and adds "Check the crash reports on the host.

### Changed

- **Mods page rebuilt on the shared components.** One Installed card opens with the upgrade check (target version, Check, a progress block with "Checking N of M", then Ready, No build and Unknown counts, the blocking mods' icons, a verdict and Copy blocker list), and the results table has All, Blockers and Ready filters with Unknown counted as a blocker (`?
- **Discord messages follow the dashboard's status colours.** Green for online and done, amber for warnings and "not responding", red for offline and failures, grey for unknown and plain events, violet for confirmations and whitelist applications, blue for answers and running jobs; the old gold, purple and brand colours are gone.
- **Titles name the action or object** ("Player banned", "Backups of smp", "smp is offline") instead of "✅ Success", "❌ Error" or "ℹ️ Info", in sentence case.
- **Errors are only visible to you and say what to do next.** Every slash command now runs through the shared error wrapper (daily, streak, link, linkstatus, unlink, help, map, whitelisted, compare, playtime and stats did not), errors are ephemeral with a problem and a recovery line, and a public "thinking.
- **Admin commands deny before posting anything.** A non-admin running an admin command gets one ephemeral "Bot admins only" reply before the command defers; the dispatcher's `adminOnly` denial uses the same message (`commands/middleware.
- **`/daily` shows the claimed reward publicly** in a "Daily reward claimed" embed with your streak and when the next reward is ready, so the channel can cheer or laugh at the roll.
- **Pagination** is Previous, a disabled "Page n/m" button and Next; after 3 minutes the buttons switch off instead of disappearing, also on replies only you can see (`utils/embeds/embedUtils.
- The live status embed takes the colour of the worst server, lists servers that need attention first and shows when it was last updated (`watchers/schedulers/statusEmbed.
- `/backup` names the backup types like the dashboard (Hourly, Daily, Pre-update, Manual, Archive) and shows ages as Discord timestamps (`commands/server/backup.
- **Dashboard confirm dialogs and status chips.** Typed confirms put the cursor in the input (or on Cancel when there is nothing to type), state target, effect and recovery, and return focus to the button that opened them.
- German copy uses du-form and one word per concept ("Discord-Server" for the guild, "Kanal", "Benachrichtigung", "Antrag", "Serie", "der API-Wrapper"); plurals come from `Intl.
- **Dashboard sidebar.** The eleven pages are grouped under Monitor, Manage and Admin, each with its own icon (Config and Mod config no longer share one), and there is one server picker.
- **Mod config and the guild config dialog use the same editor frame.** Mod config keeps its file tree and filter, and gains the edit bar, "Review changes", bound labels, the old value with Reset, and a read-only notice that says why (no `config:write`, or a file that is view-only).
- **Commands page on the editor frame.** The Commands page uses the same edit bar as Config (unsaved count, Discard, Save, the apply state), with the scope, search, show and layout filters held under it while you scroll.
- **Guilds page and setup wizard.** Guilds has a page heading with "Set up a guild" beside it, distinguishes "the bot is in no Discord server you manage" from "the bot is in N servers, none set up yet", and names features the same way everywhere.
- **Overview, Servers, Console, Analytics and Audit log say why something is missing.** A load that failed shows what failed and Retry in place of the list, so it no longer reads as "nothing here": an expired session offers "Sign in again", a missing grant names the capability, and the Overview's guild panel says when Discord rejected the bot token instead of "No guilds configured yet".
- **Analytics durations read like the bot's.** Playtime, "for 2 d 22 h" and the playtime board use the shared duration format ("12 h 7 min") instead of "0d 12h 0m 0s", and a server with no health checks yet says so in one sentence instead of a row of dashes and "Unknown" (`views/AnalyticsView.
- **Monitor pages on phones and for keyboard and screen reader users.** Status dots and chips on these pages use the shared shapes, server cards and panels have headings, the console log is a focusable log region with labelled filter and command inputs, the range and stat pickers are labelled, every control is 44 px tall on touch screens, and the Audit log and Analytics tables turn into one card per row under 760 px instead of scrolling sideways (`views/*`, `style.
- **Toasts appear top right** , below the top bar on phones, so they no longer cover the console's Send button or the docked edit bar (`App.
- The login page's heading says what it is for ("Sign in to the dashboard"); the app name above it is no longer the heading (`App.
- The dashboard's "bot looks down" banner is one status line with the time of the last heartbeat and a link to Overview, instead of a large orange block (`App.
- **Playtime reads like every other duration.** `/players`, `/playtime`, `/compare`, `/profile`, `/stats`, the playtime leaderboard and the in-game playtime milestone announcements show the two largest units in the shared format ("8 d 20 h", "45 min 12 s") instead of "8d 20h 0m 0s", the same as the dashboard and in both languages (`core/utils/minecraft/statUtils.
- **Reward items have readable names.** `/daily`, `/daily history` and the in-game notice for queued rewards show "3 × Diamond" and "16 × Cooked Beef" instead of "3x diamond", the same in both languages; the in-game notice now lists what was delivered (`core/utils/minecraft/itemNames.
- **`/players` and `/mods` open with a summary line.** `/players` says how many players are online and known and how the list is sorted ("3 online, 41 known.
- The "Bot admins only" reply names the subcommand that was denied ("/server stop is for bot admins.
- **Backups page text goes through the shared translation layer.** Nothing looks different (`views/BackupsView.

### Security

- **Mod icon lookups are bounded.** Only slug-shaped keys are sent, at most 300 per lookup in batches of 50 to the fixed Modrinth API host with a 4 second timeout; answers are cached (6 hours, 1 hour for unknown projects, 1 minute after a failed request so a polling page cannot hammer Modrinth) in at most 2000 entries; only `https://cdn.
- **Dashboard secrets are password boxes.** The bot token and the servers' API keys show an empty password field ("Set.
- **Relayed text never pings.** The chat bridge, `/console live`, in-game reports and event notifications set `allowedMentions` explicitly, and alerts allow exactly the configured role (`watchers/log/chatBridge.
- The admin audit record of a `/server` action is written only after the capability check passes, and for stop and restart only once confirmed (`commands/server/control.
- **`/config show` no longer exposes secrets.** The reply is now ephemeral, drops the (partially masked) bot token and the admin IDs, shows only the guild the command was run in, and lists each Minecraft server by wrapper host instead of its full URL.

### Fixed

- Dialog close buttons, the "Skip to content" link and the "Open overview" link in the bot status line are 44 px targets on phones; the guild config dialog close button was 40 px (`style.
- On phones, text inputs, selects, chips inputs, the secret Show button, switches (by a larger invisible hit area), dialog footer buttons, Add to Discord and Log in with Discord are 44 px targets; they were 39 to 40 px (`style.
- "Discard unsaved changes?
- Under 1100 px the Config page showed both the group list and the Jump to group select above the settings; only the select remains (`views/ConfigView.
- **Mods page failures are shown where they happen.** A failed installed-list load showed "No mods installed", a failed update check and a failed catalogue search were dropped or only toasted; each now says what failed with Retry, and a list that could not be refreshed stays visible with a note.
- **`/mods` works for large modpacks.** Above about 110 mods the reply exceeded Discord's 6000 character embed limit and failed with a generic error; the list is now split into pages that each stay within the limits (`commands/info/mods.
- Pager buttons on replies only you can see stayed clickable but dead after the timeout; they now switch off (`handlePagination`).
- German guilds saw English fragments in German messages: "players" and "including" in `/status` and the status embed, raw `online`/`offline` in `/uptime`, "*None*" and "(cont.
- The crash loop alert told admins to run `/mods disable`, which does not exist; it now points at the logs and `/server restart`.
- **German whitelist application form works again.** The German label of the optional note field was 53 characters, over Discord's 45 character limit, so Discord rejected the form and the Apply button did nothing.
- **`/daily` no longer fails on slow servers.** It acknowledges the command before the online lookup and the reward delivery, so a slow wrapper no longer produces "The application did not respond".
- **German guilds got the challenge reward line in the global language** , and backup sizes in `/backup` used a decimal point; both now follow the guild language (`watchers/log/advancements.
- The challenge and streak leaderboard titles still carried a trophy emoji; the server state circle is now the only emoji in titles, as intended (`core/locales/*.
- **`/daily` showed the wrong reward** when the random bonus triggered: the bonus item was listed as the daily reward and the real reward was hidden.
- **Unexpected command errors are localised and never leave "thinking..." hanging.** The fallback reply was a fixed English string; it now uses the guild's language, says what to do next, and replaces a pending deferred reply.
- **Downtime alerts use each guild's language.** The alert text was built once in the global language and sent to every guild; it is now built per guild (`watchers/monitors/downtimeMonitor.
- **Audit log and config history showed the wrong time outside UTC.** SQLite timestamps (`YYYY-MM-DD HH:MM:SS`, UTC) were read as local time, so an entry from two minutes ago read "2 h ago" on UTC+2 and the rollback dialog printed the UTC clock time.
- **Mod Config no longer drops edits silently.** Opening another file or switching server with unsaved changes now asks first, and closing the tab warns (`useModConfigs.
- **Guilds no longer says "No guilds configured yet" when Discord rejects the bot token.** A failed guild read is shown in place with its cause and a fix: a missing or rejected token (with Open Config for bot admins, "ask a bot admin" for guild managers), rate limiting, or Discord being unreachable, each with Try again.
- The "Not listed?
- The Commands list overlapped its own columns below 1100 px wide; the setup wizard button on a guild card had no icon (`views/CommandsView.
- **Mod config said "Saved" for an edit that was only queued** while the wrapper was unreachable; it now says the change is held and written when the wrapper is back (`views/ModConfigView.
- **Config and Mod config no longer scroll sideways on phones** (360 and 430 px).
- **Save conflicts in the config editors** were labelled with mod config's queue wording ("Was, when you queued"); they now say the field changed on disk while you edited and show its value from when you opened the page (`components/schema/ConflictPicker.
- **Raw JSON edits count as unsaved work.** Text that does not parse, or differs from the loaded config, enables Discard and triggers the leave prompt (`useConfig.
- **Dashboard contrast and keyboard focus.** Primary buttons now read at 7.
- **`/daily` lists the lucky bonus.** When `bonusChance` rolled an extra item, it was given and saved in the history but missing from the reply; it now has its own "Lucky bonus" line (`commands/connection/daily/daily.
- **An unreachable wrapper no longer shows "fetch failed".** When a command cannot reach the server's API wrapper (refused, timed out, paused after repeated failures, or rate limited), the private error is titled "Could not reach smp", says the server did not answer and what to do next, in the guild's language; the raw cause only goes to the log (`core/utils/server/transportError.
- **Challenge item bonus shows a readable name.** The bonus reads "3 × Diamond" or "Cooked Beef" instead of the raw item id (`commands/admin/challenge.
- **List fields in Config and Mod config no longer log a deprecation warning** in the browser console, and each entry's remove button names the entry it removes.
- **Wrapper errors are explained instead of dumped.** When the API wrapper answers a command with a server error, the reply says "smp had a problem" with a hint on what to do next.

## [7.0.0] - 2026-10-10

### Security

- **Dashboard `trustProxy` is configurable and off by default.** It was unconditionally on, so anyone who could reach the dashboard without the proxy could spoof `X-Forwarded-For` and dodge the login and write rate limits. `webui.trustProxy` accepts `false`, a list of IPs, CIDRs or `loopback`/`uniquelocal`, a hop count, or `true`, and is read on every request. The dashboard warns once when proxy headers arrive from an untrusted private address (`web/backend/trustProxy.ts`, `server.ts`, `docs/admin/configuration.md`).
- Rate limits hold up behind a proxy: write limits are per verified signed-in user with a shared per-address ceiling (only admitted requests count), pre-login routes stay per address, forged or rotated cookies fall into the address bucket, bucket maps are bounded, and a full map serves new keys from a per-source overflow bucket instead of evicting exhausted ones (`web/backend/rateLimit.ts`, `core/utils/rateLimiter.ts`).
- The OAuth login `state` is bound to the browser that started it by a short-lived `HttpOnly` cookie, so a captured state cannot be replayed from another browser (`auth/auth.ts`, `routes/auth.ts`).
- New `webui.sessionEpoch` signs every dashboard session out when raised, with no restart (`auth/auth.ts`, `config.schema.json`).
- `MCBOT_DEV_NO_AUTH=1` refuses to start the dashboard on a non-loopback address or under `NODE_ENV=production`.
- The mod icon proxy caps each icon at 1 MB, keeps at most 200 in memory, serves raster images only (no SVG) and sends a sandboxing CSP (`web/backend/iconProxy.ts`).
- `config.json` rewrites (dashboard saves and the config migration) kept the default file mode, so on Linux a `0600` config could become world-readable. Rewrites now keep the existing owner and group bits and never the "other" bits, new config files and migration backups are `0600`, and temp files are created exclusively under a random name and swept after a crash (`core/utils/config/atomicWrite.ts`, `configService.ts`, `core/config.ts`).
- Updated dependencies to clear `npm audit` findings (vue and server-renderer XSS, undici, brace-expansion, source-map-js). The remaining advisory is in the vitest family (dev only) and needs a major upgrade. TypeScript is unified on 6.x.

### Added

- **`/players`**: every player who ever played on a server (stats files plus whitelist and usercache names) with online state or last-seen and lifetime playtime, 20 per page, with `sort` (`last-seen`, `playtime`, `name`), `inactive:<days>` and `include_unknown`. Last-seen only covers time since the bot began tracking sessions, and vanilla caps the usercache at about 1000 entries (`commands/stats/players.ts`, `core/utils/minecraft/playerRoster.ts`).
- Optional `server` option (with autocomplete) on `/whitelisted`, `/stats player`, `/stats daily`, `/top`, `/leaderboard`, `/playtime` and `/compare` (`commands/info/whitelisted.ts`, `commands/stats/*`).
- `/uptime server:all` shows the overview of every server the guild may target (`commands/info/uptime.ts`, `utils/guild/serverOptions.ts`). `/daily-admin reset` takes an optional `server`.
- **Mod config editor handles nested and non-TOML configs.** The file list reaches eight folders deep, groups files by mod then folder, and warns when the server has more than 2000 files. New editors for `key:value` text files such as Xaero's Minimap and World Map, legacy Forge `.cfg`, `.yml`/`.yaml` (scalars only, comments kept), `.ini` and `.conf`; other text files and waypoint files open as read-only source. Settings are shown in collapsible sections, 200 at a time. Needs a wrapper with the config index; older wrappers keep the old limits. Touched: `core/utils/configfmt/**`, `routes/modConfigs.ts`, `ModConfigView.vue`, `useModConfigs.ts`, `src/schema/wire/**`. See `docs/admin/mod-configs.md`.
- **Mods tab: Check another Minecraft version.** Pick the installed or any released version and see which installed mods have a release for it, with progress, a "48 ready, 9 missing, 5 unknown" summary, a badge per mod and an "Only blockers" filter. Needs `mods:read` and the wrapper's `mod-compat` feature (hidden otherwise; the per-installed-version check keeps working). Results are cached six hours. Limits: one check per user and server (409), two per guild and two per server (429), six overall (429), one refresh per server every 30 s (429). Touched: `routes/mods.ts`, `routes/compatGuard.ts`, `ModsView.vue`, `useModCompat.ts`, `serverAccess` (`access/modCompat.ts`), `minecraft/mojang.ts`. See `docs/user/mods-version-check.md`.
- **Command outcomes.** `CommandOutcome` (`delivered`, `sent`, `unreachable`) and `ServerInstance.send`, which never throws. Console commands go through the per-server circuit breaker, so a down wrapper fails an in-game command at once. The wrapper's `POST /command` reply names the channel it used (`rcon-command` v2); an older wrapper is read as before. `whisper`, `announce` and `tellraw` helpers send messages to players (`schema/commandOutcome.ts`, `access/commands.ts`, `server.ts`, `core/utils/minecraft/serverMessages.ts`).
- Per-server circuit breaker in front of wrapper reads: after 5 consecutive failures it fails fast for 15 s, then probes once. A 429 never counts toward it and surfaces as its own `RateLimitedError` (`core/utils/server/circuitBreaker.ts`).
- Leaderboard builds and the hourly stat snapshot use the wrapper's bulk stats route (`stats-bulk`); on an older wrapper they fall back to per-player reads capped at 6 concurrent (`statUtils.ts`, `serverAccess.readAllStats`). `/api/status` and `/metrics` cache each server's health (10 s), TPS (15 s) and host info (60 s) (`web/backend/status/status.ts`).
- **Dashboard config editing** (Config, Commands, guild editor): modified-section markers, a `Save N changes` button disabled until something changed, Discard, loading and retry states, validation errors on their section, and a prompt before leaving with unsaved edits. A save made against a file that changed meanwhile keeps your edits and lets you choose per field. An "Applied / Pending / Bot not running / Restart required" chip shows whether the bot has loaded the saved config (`GET /api/config/status`, `ConfigStatusChip.vue`, `runtimeHeartbeat.ts`, `configApplyStatus.ts`).
- Dashboard API errors carry a stable `code` (`CONFLICT`, `VALIDATION_FAILED`, ...) and the frontend throws a typed `ApiError` (`web/backend/errors.ts`, `schema/apiErrors.ts`, `web/frontend/src/api.ts`).
- Wrapper wire types are generated from the wrapper's `openapi.json`: `npm run wire:sync -- <wrapper dir>` vendors it to `src/schema/wire/` and `npm run wire:check` (CI, release) fails on drift (`scripts/sync-wire.mjs`).
- `scripts/e2e-wrapper-contract.mjs` covers the whole wrapper surface and takes its route list from the wrapper manifest, failing on any route without a case. The contract CI job also runs against the commit the minecraft-server-setup submodule pins.
- `npm run i18n:check` also fails on a hard-coded English literal in a Discord reply, embed or button (`scripts/lib/i18nLiteralLint.mjs`, `scripts/i18n-literal-allowlist.json`).
- Fixtures of every historical `config.json` format (`tests/fixtures/config/`), and a test that fails when a config field would fall back to the raw-JSON editor.

### Changed

- BREAKING: **`config.json` is rewritten on the first start.** The file gets standard indented JSON and a `configVersion`, and the original is kept as `config.json.bak-v<old version>-<timestamp>` next to it. Pre-5.0.0 local-mode configs migrate once `apiUrl` and `apiKey` are present; otherwise the bot stops without touching the file and lists the keys to add. A `configVersion` newer than the bot is refused. See `docs/admin/migrating-to-7.md` (`core/configMigrations.ts`, `core/config.ts`, `core/utils/config/configService.ts`).
- BREAKING: **Behind a reverse proxy you must set `webui.trustProxy`.** The dashboard no longer trusts `X-Forwarded-For` by default (see Security and `docs/admin/docker.md`).
- BREAKING: **Wrapper API keys must be at least 32 characters.** The wrapper refuses to start with a shorter key; use `openssl rand -hex 32` for `apiKey`, `API_KEY` or `API_KEY_<SERVER_ID>`.
- BREAKING: **A current wrapper and setup suite are needed for full behaviour.** `rcon-command` v2 (delivery results), `stats-bulk`, `mod-compat` and the mod config index are expected features; the startup report lists any a wrapper lacks and the bot falls back as described below. The wrapper's sudoers grant must include `node` for mod management (`docs/admin/remote-setup.md`).
- BREAKING: **`config_structure.json` is removed.** Use `config.template.json` for the shape and `config.schema.json` for every field.
- BREAKING: **Server resolution changed.** A command resolves its server from `server:`, then the guild's `defaultServer`, then the guild's only allowed server (in a DM, the only configured server). With several candidates it fails and lists the IDs instead of using the first server of the deployment; a stale `defaultServer` is an error instead of being replaced silently. `getGuildServerId`, which bypassed tenant isolation, is removed (`core/utils/server/guildTargets.ts`).
- BREAKING: **`/uptime` without `server:`** shows the resolved default server's detail. The all-servers overview moved to `/uptime server:all`.
- BREAKING: Internal API: `ServerInstance.sendCommand` and `serverAccess.sendCommand` are removed in favour of `send` and `sendCommandOutcome`.

- **Config changes apply to the running bot without a restart.** The chat bridge, TPS monitor, leaderboard schedule, milestone and update-notifier timers, status embed and application prompts follow the live config; newly enabled commands are registered; a change that lands before the bot is ready is applied once it is; a server whose `apiUrl`, `apiKey`, ping or modpack settings changed gets a fresh instance and watchers. The dashboard process reloads `config.json` too: `webui.grants`, `adminUsers`, `webui.console.blockedCommands` and the server list apply immediately, a console stream held by someone whose access was removed is closed, and a removed server's cached data is dropped (`web/backend/config/liveConfig.ts`, `initMinecraftCommands.ts`, `tpsMonitor.ts`, `leaderboardScheduler.ts`, `milestoneWatcher.ts`, `updateNotifier.ts`, `statusEmbed.ts`).
- `/server stop|restart|backup` and scheduled restarts wait as long as the wrapper does. The wrapper advertises `scriptTimeoutsMs` in `/manifest` (clamped to 5 s to 15 min, with a built-in table as fallback); a script that outlives the wait is reported as "still running, check status", not as failed. Backup download (header wait), restore and delete requests have timeouts (`access/scripts.ts`, `wrapperContract.ts`, `commands/server/control.ts`).
- Messages that were hard-coded in English now follow the language setting: `/config`, `/daily`, `/streak`, `/link`, `/linkstatus`, `/unlink`, `/help`, `/map`, `/chunkbase`, `/seed`, `/mods`, `/status`, `/uptime`, `/whitelisted`, `/clear`, `/backup`, `/tps`, `/server`, `/whitelist`, `/unwhitelist`, `/stats`, `/compare`, `/playtime`, shared error and success embeds, pagination, permission and rate-limit replies, server targeting errors, leaderboard titles, the status embed, join, leave, death, advancement and server start and stop posts, and the update notice DM. Every slash command runs in its guild's language (`core/locales/{en,de}.ts`, `commands/**`, `watchers/**`).
- The guild editor and setup wizard use a hash of the guild's own config block as their concurrency token, and the Commands view saves with the hash from when it loaded, so a concurrent edit is a conflict instead of an overwrite or a false conflict (`routes/guildConfig.ts`, `core/utils/config/guildConfigHash.ts`, `useCommands.ts`).
- Backup restore, backup delete and irreversible server actions confirm in a PrimeVue dialog (type the server name) instead of the browser `prompt` (`TypedConfirmDialog.vue`).
- `getSeed`, `getPlayerCoords`, `getPlayerDimension`, `getLastDeathLocation` and `getPlayerData` return a `QueryResult` with the reason for a miss; `getSeed` caches a failure for a minute.
- The startup report lists a wrapper that serves `rcon-command` v1 or lacks `stats-bulk`. `scripts/e2e-wrapper-contract.mjs` requires `WRAPPER_DIR`.
- `release.yml` runs typecheck, lint, layout, schema and locale checks, tests, `wire:check` and the wrapper contract on Node 24 before it builds. The Docker image generates `config.schema.json` in its build stage.
- The schema enforces guild `language` values, `waypoints.maxPerServer` (integer, at least 1), `webui.port` (1 to 65535), restart `time` (`HH:MM`) and positive `warnMinutes` and milestone thresholds, so the dashboard form and setup wizard see the bounds the bot checks (`schema/config.ts`, `core/configValidation.ts`).

### Removed

- `config_structure.json` (it still showed pre-5.0.0 per-server fields).
- `ServerInstance.sendCommand`, `serverAccess.sendCommand`, `playerUtils.getListOutput` (always returned null), the no-op uptime flush scheduler, the unreachable `if (!server)` checks after `resolveServer()`, and unused exports `getGuildServerId`, `getServer`, `getGuildConfig`, `getServerChoices`, `kvDelete`, `evictModCache`, `savePlayerCountStore`, `saveTempBanStore` and `getTempBan`.

### Fixed

- **Moderation and whitelist commands no longer report success when the command never reached the server.** `/ban` (including timed bans), `/kick`, `/pardon`, `/whitelist`, `/verify` and `/unwhitelist` check the result: an unreachable server tells the admin and records nothing (no audit entry, no timed ban, no whitelist history); a console that visibly refuses the command is reported; a server with no reply channel gets an "unverified" note. Approving a whitelist application leaves it pending when the add did not reach the server. A timed ban is kept and its release `/pardon` retried every minute until the server receives it (`commands/moderation/*`, `commands/shared/whitelistAdd.ts`, `commands/unwhitelist.ts`, `interactions/whitelistApplications.ts`, `schedulers/tempBanScheduler.ts`).
- Event tips and feature nudges are marked sent only after the whisper reached the server, and a failed in-game command no longer starts its cooldown (`eventTips.ts`, `featureNudges.ts`, `logWatcher/defineCommand.ts`). Daily and challenge rewards are requeued only when the server was unreachable (`rewards.ts`).
- `!waypoint set` refuses to save when it cannot read the player's dimension instead of storing an overworld waypoint; `!chunkbase`, `!slime` and `!netherportal` say when position, dimension or the server is unavailable, and in-game queries against an unreachable server answer at once instead of waiting 900 ms. A Discord message that could not be relayed to the game gets a warning reaction (`chatBridge.ts`). The dashboard console says when a command had no reply channel and answers 502 when it did not reach the server (`routes/console.ts`).
- `!chunkbase` did nothing for players on older servers: the click component now follows the server's Minecraft version and the URL is always shown as text. `!seed`, `!slime`, `!chunkbase`, `/seed` and `/chunkbase` work again on servers whose wrapper has no RCON reply channel (log-poll fallback restored; a failed lookup is remembered for 60 s). `!commands` / `!help` list every enabled in-game command, not only the `general` folder.
- `timezone` and `featureNudges` set in `config.json` or the dashboard were dropped by `loadConfig()` and never took effect (`core/config.ts`).
- Server targeting: commands in a DM with a single configured server work, a guild with one allowed server but no `defaultServer` can no longer be sent to a server outside its allowed set, and `/daily-admin` `reset` and `move` apply the tenant check while `show` lists only servers the guild may target.
- **Saving a mod config above 4 KB failed with a generic error.** The wrapper now accepts large bodies and the dashboard shows the real reason for a refusal (too large, changed since opened, gone, rate limited) (`access/configFiles.ts`, `configAccessError.ts`).
- Mod config editor: files in deeper folders were invisible and nested files were grouped under the file name instead of the mod; keys under TOML `[[array tables]]` no longer collide, dotted and quoted TOML keys and `\uXXXX` escapes survive an edit, a float edited to a whole number stays a float, properties files with `\:` or continuation lines round trip, list-rooted JSON and settings nested deeper than eight levels can be saved; a file that parsed with a warning is read-only as its warning says; the filter is labelled for what it does.
- Config editor: saving an unchanged form no longer says "Config saved", a failed load no longer claims a raw JSON fallback or saves an empty config, the Raw JSON switch no longer flips back, a conflict keeps your edits, and a server with the id `server` no longer hijacks a reference dropdown and overwrites the `servers` map (`useConfig.ts`, `SchemaField.vue`, `schemaField.ts`). Re-running the setup wizard on a configured guild no longer drops `server`, `mentionRole`, `postTime`, `events` or a multi-bridge `chatBridge` (`useGuildSetup.ts`).
- **Dashboard Analytics ranges.** The range selector only changed the activity chart and command usage. Every panel now honours it (30d and 90d added), clamped to what it keeps (uptime 30 d, activity 14 d, leaderboard 32 d, command usage 90 d) with a note when clamped. The leaderboard is the stat gained in the range, the players table clips playtime to it, and command usage is hour precise (`schema/analytics.ts`, `routes/analytics.ts`, `AnalyticsView.vue`).
- The bot missed config saves after the first on Linux when `config.json` was replaced by rename; it now watches the directory and recovers from watcher errors. Migration backup names include milliseconds and a counter (`core/config.ts`).
- The bot logs and exits non-zero on an uncaught exception or unhandled rejection, so the supervisor restarts it with a reason on record (`processGuards.ts`). A cached read in flight when its entry was invalidated could write a stale result back (`core/utils/cache.ts`).
- Player avatars fell back to the default skin after a restart until the name to UUID cache warmed; each server instance now warms it when its watchers are wired. The wrapper-version-mismatch warning no longer fires on the latest release (`backup-files` declared as v2). Downtime monitoring logs every poll at debug level (`DEBUG=1`). `npm ci` no longer fails on a vite version mismatch in `package-lock.json`.

## [6.1.0] — 2026-09-21

### Added

- `/clear-dm` command: deletes the bot's own messages from the invoking user's DM with it, with an optional `amount` cap and an optional `.
- Mods dashboard tab: install, update, remove and browse mods for a server.
- Config editor: collapse-by-default sections.
- Config editor: a scope breadcrumb in section headers (for example "Data Corner > notifications"), threaded through nesting, map entries and array items, with depth-based header weight.
- Config editor: per-section "Edit as JSON" toggle that flips a single subtree to raw JSON and back.
- Mods tab: disable/enable a mod without uninstalling it.
- Backups tab: permanently delete an archive from the dashboard.
- Leaderboard posting can now be anchored to a specific weekday and time (`postTime` "HH:MM" + `postDay` "SU".
- Analytics tab: a 24h/3d/7d/14d time-range picker for the activity chart and command-usage table (capped at 14 days — `player_count_hours`' retention ceiling).
- Downtime monitoring now detects a systemd crash loop (the server restarting repeatedly and failing to stay up) and alerts immediately, instead of potentially never crossing the normal 3-consecutive-failures threshold because the server can be briefly "up" between restarts.
- Player avatars in embeds and chat-bridge webhooks now resolve by UUID (cached from the whitelist/usercache lookups the bot already does) instead of by raw username, fixing the common case where a renamed account or a Bedrock/Geyser name silently fell back to the default Steve/Alex skin.

### Changed

- Config editor help text is now an info icon per field (`FieldHint`), shown on hover and pinned on click, instead of inline text.
- Config editor: object-valued map entries (guilds) fold their name into the section header instead of printing it twice.
- Mods tab: the installed-mods card now matches the height of the "Add from Modrinth" card instead of shrinking to fit its own content.
- Dashboard: adding a new tab/view is now a two-edit change in `App.
- Overview and Servers tabs share one alert-detection module (`utils/serverAlerts.

## [6.0.0] — 2026-08-16

### Added

- **Analytics dashboard tab.** Every number the bot already collected — `/uptime`, `/activity`, `/leaderboard`, `/playtime`, `/sessions` — was reachable only through a Discord command, which meant a time series was being rendered as block characters in an embed because that was the only surface available.
- **`/info` command.** The one question new members actually ask — what do I type to join, and what do I install first — had no command behind it and was answered by a person in chat, per new member, forever.
- **Offline-tolerant dashboard: last-known reads.** When the API wrapper was unreachable, every read that went through it answered with a hard failure, so the mod config editor, the backups table and the rest simply vanished and told the operator to go read the bot logs — at the exact moment they were most likely trying to find out what was wrong.
- **Offline-tolerant dashboard: queued config edits.** Building on the reads above — an operator can now open the mod config editor during an outage, see the last-known values, edit them, and have the change applied automatically when the wrapper returns, instead of being able to look but not touch.
- **The dashboard absorbs the standalone server-manager panel.** Everything `minecraft-server-manager` did is now in the dashboard, reached through the API wrapper like every other server operation.
- **Per-capability dashboard access** (`webui.
- **Live console.** A relayed log stream plus a command line, replacing the panel's WebSocket terminal.
- **Console command deny-list** (`webui.
- **Backups panel** : archive listing, download and restore, plus **rollback** on the Servers view.
- **`SseLineStream` in `@mcbot/core`.** The SSE transport extracted out of `RemoteLogWatcher` so the dashboard could use it without a second copy of the connect/backoff loop.
- **`ServerStatus.features`** — what each server's wrapper advertises, from its capability probe and manifest.
- **Mod config editor** (needs wrapper 3.
- **Event tips are a registry.** `EVENT_TIPS` (`src/core/utils/minecraft/eventTips.
- **Command usage is measured.** A `command_usage` table records every successful slash and in-game invocation (command, surface, user, guild, server), pruned to 90 days.
- **The dashboard's Commands page shows usage.** Each command now carries "N uses by M people in 30 days", or an explicit "Not used in 30 days".
- **`/help` leads with what you have not tried.** Commands the caller has never run are sorted first and marked ✨, turning a reference list into a recommendation without hiding anything.
- **The death DM mentions `!deathpos`.** A player reading it has just proved they care where they died, which is the only moment that command is obviously useful.
- **Follow-up hints: features suggest their pair, at the moment of use.** Five pairs so far — `/daily` offers to switch on its reminder, `/status` on a *down* server offers to `/watch` it back online (both one-tap buttons), and `/stats`, `/playtime` and `/seed` each name the command that answers the question they raise (`/leaderboard`, `/activity`, `/chunkbase`).
- **In-game nudges for `/link` and `/daily`.** The chat bridge is the only feature with real traffic because it needs no learning; everything else starts with a Discord command players have never been shown.
- **`/ban` takes a duration.** `duration: 30m | 2h | 3d | 1w | 2mo | 1.
- **`findDiscordIdByMcName` in `linkUtils`.** The name → Discord-ID reverse scan existed as four hand-rolled copies (`whois`, `profile`, `deaths`, `defineCommand`); they now share one case-insensitive helper, which the timed-ban DM also uses.
- **The bot can now ask the Minecraft server directly, with no wrapper involved.** `serverPing.
- **Server state is now three-valued, and "we could not ask" is one of them.** "Offline" used to mean three different things.

### Changed

- **Shared logic consolidated into `@mcbot/core`.** Anything both the bot and the dashboard consume now lives in one place, so there is one code source and one behaviour rather than two implementations drifting apart.
- **Dashboard commands are grouped by their source folder.** The manifest only split slash versus in-game, so the dashboard grouped by surface and ignored the repository's own structure.
- **The Servers view no longer has a "View log" button.** It fetched a fixed tail into an inline pane; the Console tab streams the same log live and can send commands.
- `requireSysadmin` is removed rather than deprecated.
- **Timezones are per guild and per schedule; the `TZ` env var is gone.** Everything stored stays UTC epoch ms; a zone is applied only where a human reads a time or a wall-clock schedule fires.
- **Fixed: `nextMidnightEpoch()` returned NaN on the last day of every month** , so the nightly channel purge misfired every month-end.
- **Fixed: `/status` host metrics.** `process.
- **Fixed: disk figures in `/status` were per filesystem, labelled per directory.** The server dir and the backups dir usually share a filesystem, so both printed identical `df` numbers, which reads as two disks that coincidentally match.
- **Fixed: presence reporting "0 online" for populated servers.** When the health check passed but `/list` threw, `buildServerField` left the counts at zero while still reporting the server as up — and said nothing in the log.
- **Waypoints can be deleted by a bot admin** , not only by their author.
- **Wrapper `host-info` is v2** (`minecraft-server-api`), declared through the existing feature manifest.
- **Config validation is schema-driven.** Types, requiredness, enums and numeric bounds are now checked with Ajv against the generated `config.
- **One `errMsg` for unknown throws.** Replaced 107 copies of the `err instanceof Error ?
- **Reward rules moved out of the `/daily` command** into `core/utils/minecraft/rewards.
- **One `formatDuration` and one `formatBytes`.** `formatDuration` had three implementations with three different renderings (`/sessions` showed a 3-day session as `72h 5m`); `formatBytes` had two that had already drifted, so the same figure read `512 KB` in Discord and `0 MB` in the dashboard.
- **`fetchJson` for upstream calls** (`core/utils/http.
- **`sanitizeReason`/`MAX_REASON_LENGTH` moved to `core/utils/sanitize.ts`** from `kick.
- **`scheduleAt` (`core/utils/longTimer.ts`)** owns the setTimeout-overflow handling that two schedulers had implemented differently.
- **`loadLinkedAccountsOrEmpty`** replaces seven copies of `loadLinkedAccounts().

### Fixed

- **A stop during the SSE handshake could leave the stream running.** `stop()` aborts the request, but if the response had already resolved the abort was too late: the reader went on to report a connection, fire `onConnect` and start reading a stream the caller had just cancelled.
- **The Backups tab was hidden on every host, so the whole backup feature was invisible.** `ServerStatus.
- **Features were reported only for a running server.** The probe sat after `collectStatus`'s early returns, so a stopped or unresponsive server reported none at all — and the Backups tab disappeared at the exact moment someone would want to restore one.
- **The console showed nothing until the server next spoke.** The SSE stream only carries lines written after it connects, and the backlog was seeded only from lines the hub had already seen — which solved the problem for the second viewer and left it in place for the first.
- **`npm run typecheck` did not typecheck the frontend.** `tsc -b src/bot src/web` builds the dashboard's *backend* project; the `.
- **Backup DTOs were declared in `@mcbot/core` but re-exported from `@mcbot/schema`.** `BackupFileInfo` and `BackupFileIndex` are read by the browser, and the frontend cannot import core (core imports Node built-ins), so a shape both sides read belongs in schema by definition.
- **The cross-repo contract check scaffolded an incomplete suite layout.** Its fake server directory wrote five script files from a hard-coded list, so adding `rollback` to the shared action set left `capabilities.
- **`/api/setup/servers` was inconsistent with grants.** It was sysadmin-only, which predates capabilities; a user who can see a server in `/api/status` received a 403 asking for its name.
- **The cross-repo contract check failed on the normal release order.** A wrapper offering features the bot does not consume yet was treated as a disagreement, so the very state that additive wrapper releases are *supposed* to produce — wrapper first, bot half second — turned the wrapper's CI red until both repositories caught up.
- **Fifteen commands reported zero uses despite being run daily.** `/daily` was the visible symptom — used constantly, shown as never used.
- **The bot and the dashboard disagreed about whether a server was up.** The bot asked `serverIsUp`, which counts a server as up when it is online *or* unresponsive.
- **"0/0 players online" during a wrapper blip.** The status collector flattened a null roster into `{ online: 0, max: 0 }`, so the interface confidently asserted nobody was playing at the exact moment it had no idea.
- **`/daily` never saw a player as online.** It was the only case-sensitive name comparison in the codebase — `getOnlinePlayers().
- **Console did not follow output.** Two independent causes, either alone enough to break it.
- **Console overflowed on large screens.** The pane filled the content column, so a tall display grew a console taller than anyone reads and pushed the composer off the fold.
- **Command list columns did not line up.** Each row was its own grid with auto-width toggle columns, so the toggles never aligned vertically and the "Default" label clipped to "Defaul".
- **Working with raw IDs where a name was available.** Guild config editors showed snowflake channel and role IDs instead of names, and the audit log printed raw guild IDs in its prose.
- **In-game tips are delivered in game.** The `!
- **Tips no longer advertise disabled commands.** The join nudges, the follow-up hints and the death DM all recommended commands without checking command policy, so a server with `daily` switched off still told every new player to run it — and following the tip landed them on "unknown command", which is worse than never being told.
- **A lag spike was reported as a server outage.** The downtime monitor read one boolean, so a server too loaded to answer RCON crossed the three-failure threshold and got a "🔴 Server Down" alert.
- **An unreachable API wrapper was reported as a server outage.** Same three consequences, from a cause that says nothing at all about the Minecraft server.
- **Player-count history recorded lag spikes as players leaving.** The sampler skipped only servers that were down, so an unresponsive one was sampled, `getList()` returned zeros, and the activity chart drew an exodus.
- **`mcbot_server_online` conflated three incidents into one alert.** Split into `mcbot_wrapper_up`, `mcbot_server_up` and `mcbot_server_online`.
- **The chat bridge lagged behind in-game chat, worst with webhooks on.** Two compounding causes, both since fixed: `RemoteLogWatcher` awaited handler dispatch inside the SSE read loop, so the socket sat idle for the whole of every handler's Discord round-trip and each chat line waited for the previous line's HTTP request.

### Removed

- **Three slash commands: `/say`, `/playerhead`, `/netherportal`.** The in-game equivalents `!

### Not carried over from the server-manager panel

- **The local username/password login.** The dashboard stays Discord-OAuth2 only.
- **The public, login-free status page.** The dashboard has no public surface; every route requires a session.

## [5.0.0] - 2026-07-17

### ⚠️ BREAKING: local mode is gone. The bot now requires the API wrapper.

**If the bot currently reaches your server by reading its files, sending keys
to a `screen` session, or opening its own RCON connection, it will not start
after this upgrade until you install the
[API wrapper](https://github.com/LetsGaming/minecraft-server-api) (3.1.1+) on
the Minecraft host and repoint `config.json` at it.**

The bot refuses to start rather than starting in a state that looks configured
and is not. It names every removed field it finds:

```
Config validation failed:
  - servers.survival: serverDir, linuxUser, useRcon configured local mode,
    which was removed in 5.0.0. The bot now reaches every server through an
    API wrapper. Move those settings into the wrapper's own config on the
    Minecraft host, delete them here, and set apiUrl + apiKey.
    See docs/admin/migrating-to-5.md. 4.3.x is the last release that
    supported local deployment.
```

Migration guide: **[docs/admin/migrating-to-5.md](docs/admin/migrating-to-5.md)**.

**4.3.x is the last release supporting local deployment, and it is
end-of-life** — no fixes, no features, no security updates, permanently. There
is no deprecation release in between: 4.3.x is where local mode stops.

#### What was removed

- **Per-server config fields**: `serverDir`, `scriptDir`, `linuxUser`,
  `screenSession`, `useRcon`, `rconHost`, `rconPort`, `rconPassword`. They
  describe the Minecraft host and now live in the wrapper's config there.
  `apiUrl` and `apiKey` are both required.
- **The pre-`servers` single-server format**, where the top-level object
  doubled as one server block. It only ever carried local fields.
- **`RCON_PASSWORD_<ID>` / `RCON_PASSWORD`** env overrides → replaced by
  **`API_KEY_<ID>` / `API_KEY`**. (The wrapper still reads `RCON_PASSWORD_<ID>`
  for its own connection: same name, different machine.)
- `src/core/rcon/` (the bot's RCON client) and `src/core/shell/` (the
  `execCommand`/sudo layer). The wrapper has both.
- The `LogWatcher` file tailer — a second implementation of the wrapper's
  `logStream.ts`, down to the same 1 MB/cycle catch-up cap. Every instance is
  watched over the wrapper's SSE stream now.
- `df`/`ps` host metrics. The wrapper's `/info` reports them, from the machine
  they describe.
- The RCON e2e smoke harness (`scripts/e2e-smoke.mjs`, `docker-compose.e2e.yml`,
  the `e2e` workflow). The cross-repo contract test (`npm run e2e:contract`)
  covers the seam that still exists.

#### Why

Every feature had two implementations — one against the filesystem, one against
the wrapper — and they drifted. This is not theoretical; it is where the bugs
below came from. The wrapper path was the tested one and the one most people
ran. Removing the other one deleted ~570 lines from two files and made a class
of bug impossible rather than fixed.

#### Deployment

**Docker is the supported way to run the bot**, and the dashboard ships with it.
It is a Node application and nothing stops you running it directly, but that is
not a supported configuration and there is no guide for it. The bot can now run
anywhere that can reach the wrapper over HTTP — it no longer needs to sit on the
Minecraft host.

The dashboard still edits the bot's config, in the bot's container. Unchanged.

### Added

- **The bot now reports which remote features it is missing, by name.** An API
  wrapper that lacks a feature used to look identical to a healthy one — every
  call degrades individually, so a 404 on `/usercache` just quietly became "no
  usercache names". The bot now reads the wrapper's `GET /manifest` at startup
  and names each gap and what it costs (`does not provide "usercache" — names
  for players who are not on the whitelist`), in **both** directions: it also
  reports features the wrapper offers that the bot is too old to use, which had
  no mechanism at all. Wrappers predating `/manifest` fall back to the version
  compare. Requires api-wrapper with `/manifest`; older ones keep working.

- **Cross-repo contract check** (`npm run e2e:contract`) — runs the bot's real
  `serverAccess` against a real api-wrapper process, so a renamed field on the
  wrapper fails CI instead of silently returning `undefined` on remote
  instances. `apiGet<T>` casts the wrapper's JSON, which no unit test on either
  side can verify. Runs from both repos' CI; about ten seconds, no Minecraft
  needed (scaffolded instance directory plus a real RCON socket).

### Fixed

- **`/stats <player>` errored for anyone who had never played.** The wrapper
  answers 404 for a missing stats file, which is an answer, not a failure —
  but `readStats` let it throw, so the command replied "Failed to retrieve
  stats" and logged an ERROR where it should have shown the "Stats File Not
  Found" embed it already has. A 500 still throws: a broken read must not look
  like an empty one.
- **Period leaderboards could silently report all-time totals.** If a stats
  read returned nothing, `takeSnapshot` recorded an empty snapshot; baselines
  resolve a missing player to zero, so one empty snapshot in the window made
  every period board subtract nothing and present lifetime numbers labelled as
  the period. It now refuses to record an empty snapshot and logs why, naming
  the likely cause.
- **Daily rewards were reported as delivered without being checked.** `give()`
  verified the console's reply only when the bot held the RCON connection
  itself; on every other server it returned success without looking. The
  wrapper had been relaying that reply all along. It is now verified whenever
  there is one — and a wrapper that cannot be reached is failure (the reward
  stays queued), while a wrapper answering over screen with no output is
  unverifiable but not failed (the reward is not re-given on every join). Those
  two used to be the same `null`.

- **`src/` now holds workspaces and nothing else, and CI enforces it**
  (`npm run layout:check`). A stray file at `src/` root is invisible to every
  gate: it belongs to no tsconfig project so `tsc` never compiles it, eslint
  lints it without resolving imports so its broken ones pass, and vitest only
  globs `tests/`. Two files from another repo sat there unnoticed. Nothing in
  this repo should be able to hide from all three checks at once.

- **`/compare` threw for any player with a real stat file.** The field chunker
  summed line lengths against Discord's 1024-character limit, then joined the
  lines with `\n` — so the value it sent was longer than the one it measured,
  by one character per line. A chunk that counted 1020 shipped 1029 and the
  field was rejected. It only bites once a category fills a chunk, which is why
  it passed on thin fixtures and failed for everyone real: measured against the
  actual function, 60 shared stats built fine and 100 threw. Established
  players share thousands.

- **Player stats were invisible on servers that do not use the vanilla world
  layout.** `statsDir()` resolved `<level-name>/stats` and nothing else; a
  Fabric instance keeps its stat files at `<level-name>/players/stats`, next to
  `players/advancements`, with no `<level-name>/stats` at all. Every read
  missed, `/stats` and every leaderboard came back empty, and **nothing logged
  an error** — on the wrong path a miss is an `ENOENT`, which is exactly what a
  world nobody has played on looks like. Both layouts are now probed, at both
  ends (the wrapper needs the same fix, ≥3.1.1). Requires no config change.

- **`npm run clean` did not clean.** It ran `tsc -b --clean`, which only removes
  output for sources TypeScript still knows about — so a renamed file left its
  old `.js` in `dist/` forever. Because the in-game command loader walks that
  directory, an incremental build after any rename registered every `!command`
  twice, and players got two replies. Now `rm -rf src/*/dist`, which is what the
  script always claimed to do. The loader also refuses a duplicate command name
  and says why, since that is a bug however it happens.

- **Two test files asserted against copies of the code they claimed to test**,
  so the bugs they were named for could have been reintroduced with the suite
  green. `tps.test.ts` re-implemented `getTps` inline (its header even claimed
  "a regression in the source will break the matching test" — it would not), and
  `validateConfig.test.ts` asserted that object literals had the properties it
  had just given them. Both are gone; their real behaviours — the Bug 1 and
  Bug 4 guards, and the `tpsWarningThreshold` check that had no coverage at all
  — are now asserted against the actual implementations, and verified to fail
  when those are broken. Test count drops by 15; signal does not.

- **`MIN_WRAPPER_VERSION` was `1.2.0`, a version that never had `/info`.** The
  endpoint shipped in wrapper 3.0.0, so every wrapper that answered the version
  handshake was already above the floor and the comparison could never fail —
  the one mechanism meant to surface an outdated wrapper was unreachable, and
  the constant's comment asserted something untrue. Corrected to `3.0.0`, and
  demoted to the pre-manifest fallback path.

- **Period leaderboards and `/stats daily` used the wrong window.** Scheduled
  daily boards anchored on a 26–48h-old baseline instead of 24h — on a
  recently-installed bot, on the oldest snapshot there was, so a "daily" board
  showed what looked like all-time totals — and `/stats daily` silently
  shortened its window to match whatever had survived. Snapshot retention thinned
  a whole calendar day as soon as that day's *first* snapshot aged past 24h,
  which (since yesterday's 00:00 snapshot is always over 24h old) tore a hole
  through the rolling window exactly where both daily baselines are looked up.
  Retention is now a rolling window sized from what the readers need, and the
  regression tests assert retention and the readers together.

### Changed

- `ServerInstance.supportsTps` is always true — the wrapper answers `/tps` for
  every instance. It used to depend on how the server was reached.
- TPS parsing, and its Bug 1/2/4 regression guards, moved to the wrapper
  (`tests/tps.test.ts` there), which owns the RCON connection and is therefore
  the only side that sees a `tps` response. The wrapper had the fixes and no
  tests; it now has both.
- `/config show` lists each server's `apiUrl` instead of its RCON host and
  Linux user.
- `docs/admin/sudoers.md` and `docs/admin/pm2.md` are gone. Sudo is the
  wrapper's requirement and the wrapper documents it; PM2 was a non-Docker
  guide.

- **Every bloated directory is now grouped by purpose**, the way
  `bot/commands/` always has been:
  - `core/utils/` → `minecraft/`, `server/`, `stores/`, `config/`, `commands/`,
    with the cross-cutting primitives at the root. The `utils.ts` grab-bag is
    dissolved into `paths.ts`, `jsonStore.ts`, `minecraft/whitelist.ts`, and
    the modules that were its only consumers; `getLevelName` was dead and is
    gone.
  - `bot/logWatcher/watchers/` (21 flat files) → `log/`, `monitors/`,
    `schedulers/`, split by what starts them — which is what the entry point's
    name already told you.
  - `bot/logWatcher/commands/` → the **same categories as the slash commands**,
    so the two surfaces of one feature match: `/seed` is `info/`, `!seed` is
    `info/`.
  - `core/types/` → grouped like `utils/`. Import through `types/index.ts` as
    before; nothing else changes.
  - `bot/utils/` → `embeds/`, `guild/`. `web/backend/` → `auth/`, `config/`,
    `status/`, with the Fastify plumbing at the root.
  - `web/frontend/components/` → `schema/` (the config editor's renderer) and
    `ui/` (presentational primitives).
  - `tests/` (86 flat files) → grouped by subject: `config/`, `db/`,
    `minecraft/`, `server/`, `commands/`, `ingame/`, `watchers/`, `web/`,
    `utils/`, `suites/`.
- **Values that cross a workspace boundary moved into `@mcbot/schema`**: the
  leaderboard interval durations (snapshot retention now derives its cap from
  the longest one, so a new interval cannot outlive the history it needs), the
  Discord snowflake format (was inlined in three layers), and the server-action
  names (were a four-item `Set` in the dashboard, a five-key `Record` in the
  script runner, and bare string comparisons in both front-ends). The action
  guard also removes an unsafe cast from the dashboard's action route.
- **The developer docs are split the way the repo is** — `docs/dev/` keeps what
  is true everywhere, with `bot/`, `core/`, and `web/` directories beneath it,
  and shipped design records moved to `dev/history/`. Corrected along the way:
  the architecture doc still claimed there was no database (SQLite landed in
  4.0), and `data-storage.md` documented `loadJson`'s failure mode backwards.

### Security

- `/metrics` compared its bearer token with `!==`, which leaks the token's prefix
  through timing. Every secret comparison in the dashboard now goes through one
  constant-time `secretEquals()`.
- Migrations record their SQL checksum. Editing a shipped migration used to be
  silent — already-migrated databases skipped the new SQL, leaving schema and
  code disagreeing — and now refuses to start.

## [4.3.0] — 2026-07-12

## [4.2.2] — 2026-07-12

## [4.2.1] — 2026-07-12

## [4.2.0] — 2026-07-11

### Added

- **Config rollback** — the dashboard snapshots the config before each change
  (gzip-compressed, kept for the last 3 days) and can restore any of them;
  `GET /api/config/history` and `POST /api/config/history/:id/rollback`.
- **Per-guild config editor** — edit a guild's whole configuration from a
  schema-driven form (every field, with type-appropriate inputs) instead of
  re-running the setup wizard.
- **Per-command options** — commands can carry configurable options (e.g.
  `/map`'s URL), edited in the Commands tab and declared in a `COMMAND_OPTIONS`
  registry.
- **Dashboard setup guard** — missing required config (`WEBUI_SESSION_SECRET`,
  `WEBUI_CLIENT_SECRET`) now serves a clear setup page instead of an opaque 500.
- `WEBUI_PUBLIC_URL` to set the dashboard's public URL behind a reverse proxy
  (fixes the OAuth redirect and the session cookie's `Secure` flag).
- `bump-version` script that updates the version across every manifest + the
  changelog and can optionally tag/push a release.

### Changed

- **Command schema**: `commands.<name>.url` is replaced by a general
  `commands.<name>.options` object. Existing `url` values are still honoured
  (backward compatible).
- **Meaningful errors everywhere** — API responses now carry a human-readable
  message instead of terse codes (`forbidden`, `conflict`, `unknown server`,
  …); unknown endpoints return a named 404.
- **Docker deployment is fully `.env`-driven** — rewritten `docker-compose.yml`,
  `docker-entrypoint.sh` and `.env.example`; the active config now lives in the
  writable `data/` volume (`MCBOT_CONFIG_PATH`), seeded once on first start.

### Fixed

- A server is no longer reported offline after a single failed status request —
  the remote-API path retries before declaring it down.
- Config written from the dashboard no longer fails with `EACCES` on a
  read-only/root-owned path; it is written to the process-owned `data/` volume.
- Env-only secrets (`DISCORD_TOKEN`, …) are applied before validation, so a
  config that omits them still boots.
- The optimistic-concurrency 409 on config writes now surfaces to the dashboard
  correctly (reload-and-retry).
- Notification events that previously never fired now fire.

### Security

- `@fastify/helmet` with a tuned Content-Security-Policy on the dashboard.
- Token-bucket rate limiting across the auth and mutating API routes.
- Guild-manager scope now expires (2 h) and is re-checked on write, so a
  demoted manager can't keep write access for the rest of a session.

## [4.1.0] — 2026-07-07

### Added

- **Redesigned dashboard** — a sidebar layout (live server switcher +
  feature nav), card/table views, and a dark PrimeVue theme with modern
  selection cues. Covers Servers, Guilds, Commands, Config, and Audit.
- **Add to Server** — a one-click invite button that opens the bot's
  Discord OAuth2 URL with the right scopes and permissions
  (`GET /api/invite`).
- **Guided guild setup** — a wizard that reads a guild's channels and
  roles from Discord and configures features (notifications, chat bridge,
  leaderboard, downtime/TPS alerts, reports, console, whitelist apps,
  linked role, …) with dropdowns instead of pasted IDs. Writes through
  the existing validated `PUT /api/config`; re-running edits rather than
  blanks an existing guild. Adds read-only routes `GET /api/setup/guilds`
  and `.../guilds/:id/{channels,roles}`.
- **Schema-driven setup wizard** (`scripts/setup.mjs`) — prompts now
  generate from `config.schema.json`, so new config fields appear
  automatically. Adds remote-instance setup (apiUrl/apiKey), secret
  masking, lossless `--edit`, and tri-state command overrides at
  global/guild/server scope.
- **Docker-aware wizard** — finds `commandManifest.json` via `--manifest`,
  the local file, or `docker compose cp` from the running bot, and
  validates against the schema when no build is present.

### Changed

- **Dashboard backend split** into focused route modules; `server.ts` is
  now a thin assembler (audit QUAL-01). No behavioral change.
- **Death-message matching is table-driven** (audit QUAL-03) — easier to
  extend when Mojang adds messages.

### Fixed

- **Web dashboard no longer crash-loops silently** on startup — config,
  SQLite, and logging failures now print one clear error instead of a
  bare restart loop. The web container defaults to the built-in SQLite
  driver (`MCBOT_SQLITE_DRIVER=node`); causes are documented in
  `docs/admin/docker.md`.
- **Commands-view save** sends `baseHash` correctly instead of writing a
  stray `hash` key into `config.json`.
- **In-game cooldown map no longer grows unbounded** (audit BUG-01) —
  stale entries are swept.
- **CI `i18n:check`** resolves the workspace locale paths (was ENOENT).

### Security

- **Server events can no longer be forged from chat** (audit SEC-01) —
  watcher regexes are anchored to the server-thread log tag with a
  chat-wrapper backstop, closing a forged-challenge payout. Includes a
  regression suite.
- **Dashboard 500s no longer leak error detail** (audit SEC-04) —
  internals go to the log; clients get a generic message.

## [4.0.0] — 2026-07-05

Workspace restructure + a real data layer. Upgrading: `npm ci && npm run build` (Node 20+; 24 LTS recommended) — data migrates itself on first start, including the snapshots directory.

### Changed

- **npm workspaces layout.** Code stays under `src/`, now as four
  workspaces: `src/bot` (the product), `src/web` (one package — Fastify
  backend + Vue frontend, one build, one artifact), `src/core`
  (process-agnostic core) and `src/schema` (isomorphic contracts).
  `discord.js` exists only in the bot's dependency tree, vite/vue only in
  the dashboard's; ESLint boundary rules and workspace-scoped installs
  (`npm ci -w @mcbot/bot`) enforce the direction. One root lockfile — the
  frontend's nested npm project is gone. Build output lives inside each
  workspace; deploy paths changed: `src/bot/dist/index.js` and
  `src/web/dist/backend/index.js` (PM2 ecosystem + Dockerfile updated).
- **SQLite data layer for machine-written state** (`data/bot.db`, via
  better-sqlite3 behind a small driver seam;
  `MCBOT_SQLITE_DRIVER=node` selects the built-in `node:sqlite` on hosts
  without a compile toolchain, Node ≥ 22.13). Ownership decides the
  medium: hand-edited files stay JSON (`dailyRewards.json`, configs),
  every machine-written store lives in the database — audit trails,
  account links + link codes, watches, player notes, waypoints, sessions,
  challenges, polls, daily claims + pending rewards, watcher states,
  uptime checks, player-count history, and hourly stat snapshots. The
  time-series stores got real tables: recording an uptime check or a
  player-count sample is now one INSERT/UPSERT instead of rewriting a
  43k-entry JSON file. Snapshots are keyed `(server_id, ts)` in the
  database — the multi-server keying fix, structurally. Both processes
  run idempotent migrations at boot; every legacy JSON store imports once
  and is kept as `*.imported` (the snapshots directory as
  `snapshots.imported/`).
- **`PUT /api/config` uses optimistic concurrency.** `GET` returns
  `{ hash, config }`; `PUT` takes `{ baseHash, config }` and answers 409
  when `config.json` changed underneath the editor (second admin, bot
  write, hand edit). The dashboard surfaces the conflict and reloads its
  baseline.
- Docker: images build on `node:24-alpine`; the Dockerfile gained
  separate `bot` (default) and `web` targets — the dashboard image
  contains zero bot code — plus toolchain-bearing dependency stages that
  compile better-sqlite3 on Alpine so the runtime images stay slim. `docker compose --profile web up -d` starts the
  dashboard alongside the bot (own healthcheck against `/healthz`, no
  `depends_on` — the processes stay independent).

### Fixed

- **Dashboard showed every server offline** (and `/metrics` emitted no
  per-server gauges): the web process never initialized its server
  registry. It now runs its own instances by design — server control and
  config edits keep working while the bot is down.
- **Admin audit entries could be lost** when a dashboard action raced a
  bot action: both processes appended to the same JSON file with no
  cross-process coordination. Appends are single inserts in SQLite now.
- **Concurrent `/link` completions could drop an update** (read-modify-
  write on shared maps). The whole issue/confirm/unlink flow is
  transactional; the in-game handler's module-level code cache — which
  also went stale against codes issued after startup — is gone.
- **After `/unlink`, `/link` claimed "already linked" forever**: the old
  flow inferred link state from leftover confirmed codes, which unlink
  never cleaned. Link state now comes from the links table itself.
- `/metrics` collects all servers in parallel instead of serially, and
  can be gated with a bearer token (`WEBUI_METRICS_TOKEN`).

### Added

- `MCBOT_SQLITE_DRIVER` env switch between the shipped better-sqlite3
  driver and the built-in `node:sqlite` fallback.
- `WEBUI_HOST` / `WEBUI_PORT` environment overrides for the dashboard
  bind address (config.json is shared with the bot; where to bind is an
  environment concern — compose sets `0.0.0.0` for the container).
- `MCBOT_DB_PATH` override for the SQLite store location.

- **Scoped command settings**: every command (slash and in-game) now
  takes `enabled` / `adminOnly` at three scopes — global `commands`,
  per guild (`guilds.<id>.commands`, slash) and per server
  (`servers.<id>.commands`, in-game) — merged field-by-field and
  enforced live at dispatch time. `adminOnly` for in-game commands
  checks the player's linked Discord account against the global admin
  list; built-in admin commands stay admin-gated regardless. `/help`
  hides commands disabled for the guild.
- **Commands tab in the dashboard**: a matrix editor over those blocks
  with a scope selector, inherit/on/off tri-states, and the effective
  value per scope, backed by a command manifest the bot writes at
  startup (`GET /api/commands`).

## [3.6.0] — 2026-07-05

The roadmap batch: everything from `docs/ROADMAP.md` shipped in one
release — operator tooling, community features, and the web dashboard.

### Added

- **Web dashboard** (`npm run start:web`): a separate Fastify process
  with Discord-OAuth2 login (admin-gated), live server status, uptime
  and activity data, admin-audit view, a schema-driven config editor
  with secret redaction, server operations (start/stop/restart/backup,
  log tail, prune-stats with dry-run), plus `/healthz` and a Prometheus
  `/metrics` endpoint. Frontend is a small Vue 3 SPA built with Vite
  (`npm run build:web`); the bot writes a heartbeat file so the
  dashboard shows when the bot is down.
- **Scheduled restarts** (`schedules.<serverId>.restart`): wall-clock
  restarts with countdown warnings in-game and in the notifications
  channel, downtime alerts suppressed around the restart, admin-audited.
- **Whitelist applications** (`guilds.<id>.whitelistApplications`):
  a persistent Apply button, an application modal (with server select in
  multi-server guilds), an admin queue with Approve/Deny buttons that
  survive restarts, DM feedback to applicants.
- **Console access**: `/console tail` (ephemeral log tail) and
  `/console live enable|disable` — a batched, flood-protected live relay
  of a server's log into a configured admin channel.
- **Moderation shortcuts**: `/kick`, `/ban`, `/pardon` — thin, audited
  wrappers over the console commands.
- **/daily-admin**: move a user's daily-claim record between servers
  (fixes streaks stranded by the v2 per-server migration), reset records,
  and inspect them across servers.
- **/activity**: player-count history — 24h sparkline plus the busiest
  local hours from a compact per-hour series sampled for free by the
  status pass (standalone sampler covers status-less deployments).
- **/profile**: player card from existing data — head, linked account,
  whitelisted-by, playtime and last-seen, daily streak.
- **/daily-history**: the last stored daily claims (date, streak, items).
- **/watch**: one-shot DMs when a server comes back online or a player
  joins; list/remove included.
- **Milestone posts** (`milestones` config): "X just passed 1,000 hours"
  announcements in-game and in notification channels, with silent
  baseline seeding on first activation.
- **Span polls**: `/poll create servers:"smp, creative"` (or `all`) runs
  one poll across several instances with a merged tally and per-instance
  announcements; the one-open-poll rule holds per participating server.
- **Streak leaderboards**: current and longest daily streak as
  `/leaderboard` and `/top` categories.
- **More leaderboard categories**: crafted, player kills, jumps, animals
  bred, fish caught, diamond ore mined.
- **Guild-picked scheduled leaderboards**
  (`guilds.<id>.leaderboard.categories`): choose which boards the
  scheduled post includes.
- **Per-server daily reward pools** (`servers` section in
  dailyRewards.json) with field-level fallback to the shared pool.
- **Webhook chat bridge** (`chatBridge.useWebhook`): MC→Discord messages
  appear as the player (name + head) via a channel webhook, with
  automatic fallback to the embed form.
- **Waypoint categories** (`!waypoint set <name> [category]`, filterable
  in `!waypoints` and `/waypoints`) and a configurable per-server cap
  (`waypoints.maxPerServer`).
- **Remote host metrics**: disk and process usage of remote (apiUrl)
  instances via the wrapper's `/info` endpoint (wrapper ≥ 1.2.0), plus a
  startup version handshake that warns on outdated wrappers.
- **Backup staleness alert** (`hostAlerts.backupMaxAgeHours`) with
  hysteresis, and a "Newest backup" line in `/backup`.
- **Update notifier**: daily GitHub release check with optional admin DM
  (`updateNotifier` config, on by default, DM off by default).
- **Role mentions on alerts** (`mentionRole` on downtime/TPS alert
  configs, also used by host-disk and backup-age alerts).
- **Per-guild language** (`guilds.<id>.language`): embeds and replies
  localize per guild; in-game strings stay on the global language.
- **Configurable rate limits** (`limits` config block) for the slash and
  chat-bridge limiters.
- **Presence down state** (`presence.downFormat`, status idle while
  down) and live re-arming of the status/presence timer on config
  reload.
- **Config reload summaries**: `/config reload` and the file-watcher log
  now report guild/feature-level changes, not just server add/remove.
- Locale parity gate (`npm run i18n:check`), GitHub Actions CI
  (typecheck, lint, tests, audit, schema drift, locale parity, frontend
  build), a tag-driven release workflow (artifact + GHCR image), and a
  nightly RCON e2e smoke against a real Paper server in Docker Compose.

### Changed

- Source layout: bot code moved to `src/bot/`, shared process-agnostic
  code to `src/common/`, the dashboard lives in `src/web/` — enforced by
  ESLint boundary rules (`common` imports neither, `web` never imports
  `bot`).
- `defineCommand` supports an optional last argument (`"name?"`)
  alongside the existing greedy form.
- Node.js ≥ 20 is now required (`engines`).

### Fixed

- Aggregate presence no longer reports "0 online" while every instance
  is unreachable — it reports the down state instead.

## [3.5.1] — earlier

Community-features batch and prior releases (polls, waypoints, notes,
challenges, reports, host-disk alerts, sessions, uptime tracking, and
the multi-server/remote-wrapper foundation). See the Git history.
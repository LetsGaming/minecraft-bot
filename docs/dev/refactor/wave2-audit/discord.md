# Wave 2 audit: Discord experience (phase A, read only)

Branch `refactor/w2-a-discord`. No source file was changed. Findings carry IDs `DISC-01` to `DISC-36`; `DISC-01` to `DISC-25` are the ranked top 25 (section g), `DISC-26` and up are backlog.

Quoting convention: this repo forbids em and en dashes in text, but the code and locale files contain them. In quoted source strings `<EM>` stands for an em dash and `<EN>` for an en dash.

## (a) Method and limits

Method: static reading of `src/bot/commands/**`, `src/bot/interactions/**`, `src/bot/utils/embeds/**`, `src/bot/logWatcher/watchers/**`, the dispatch in `src/bot/index.ts`, both locale files, `docs/user/commands.md` and the dashboard strings in `src/web/frontend/src`. Four throwaway checks were run against the installed `discord.js` 14.27.0 (inline scripts, nothing saved in the repo):

| Check | Result |
|---|---|
| Does a `SlashCommandBuilder` subcommand entry carry `required`? | No (`Object.keys` = name, description, options). `/help` therefore labels every subcommand row "(optional)" (DISC-11). |
| Does `LabelBuilder.setLabel` accept the German `wlapp.modalNote` (53 chars, limit 45)? | Setter accepts, `toJSON()` throws "Received one or more errors". The modal cannot be built (DISC-01). |
| Embed size of 8 fields x 1000 chars | 8058 chars, Discord limit 6000. `/mods` has no cap (DISC-04). |
| Locale scan (en.ts/de.ts, 495 keys each) | Key parity and placeholder parity are clean. Em dashes: 56 EN, 58 DE. En dashes: 2 each. "(s)" style plurals: 19 EN, 17 DE. |

Limits, stated plainly:
- No live Discord gateway was available. Nothing was rendered; embed width, mobile wrapping, button layout and webhook behaviour are judged from the builder code and Discord's documented limits. Statements marked "verify live" depend on Discord server behaviour.
- Reply shapes were reconstructed from builder calls and locale keys, not captured JSON from a running bot.
- German review is by reading; the du-form check was a grep for Sie/Ihr forms (none found).
- In-game `!` commands and the `liege wie` sleep prompt are in-game surfaces. They are noted only where they share locale keys or docs with Discord.
- Dashboard comparison is limited to labels in `src/web/frontend/src` (App.vue, views, utils/format.ts). The dashboard is English only (no i18n layer found).

## (b) Command inventory

Visibility: P = public reply, E = ephemeral. Permission: all = anyone, ADM = bot admin (`adminUsers` in config, role or user id, global or per guild), linked = needs `/link`, MM = Discord Manage Messages. Every command is also subject to a per-guild `commandPolicy` (enabled, adminOnly) checked in `src/bot/index.ts:411-438`. "wrapped" = uses `withErrorHandling`.

45 top-level commands. All admin-only commands are visible in the picker for everyone; only `/clear` sets `setDefaultMemberPermissions`. No command sets `setContexts` or `setDMPermission`.

| Command | Purpose | Options | Vis | Perm | Reply shape | Problems |
|---|---|---|---|---|---|---|
| `/status` | Live state, players, ping, host | server | P | all | embed, state colour, 2 inline ping fields + Host field | Hint button on down state is good; hard-coded "players" (DISC-08) |
| `/uptime` | Uptime bars | server (+`all`) | P | all | embed, 3 bars, sparkline | State shown raw lowercase English; no "not responding" state (DISC-08, DISC-16) |
| `/info` | How to join | server | P | all | embed, 5 fields | OK |
| `/seed` | World seed | server | P | all | embed + "Requested by" footer | footer noise (DISC-25) |
| `/tps` | Tick rate | server | P | all | embed, inline fields, raw footer | raw server text in footer, English field names (DISC-33) |
| `/backup` | Backup status | server | P | all | embed, inline field per dir | Name clashes with `/server backup` (DISC-18); raw dir names |
| `/whitelisted` | Whitelist list | server | P | all | paginated embed, one field per page | Not wrapped, swallows server-resolution errors as "Failed to read the Whitelist." (DISC-03); no "x/y" in footer |
| `/mods` | Mod list | server | P | all | embed, 3 grouped link lists | No pagination, breaks past ~110 mods (DISC-04) |
| `/map` | Dynmap link | none | P | all | embed + "Requested by" | footer noise |
| `/playtime` | Playtime | player, server | P | all | embed | Not wrapped (DISC-03); error footers repeat the title |
| `/stats player` | All-time stats | player, stat, server | P | all | paginated embed, 2 fields per page | Not wrapped; `stat` has no autocomplete (DISC-20) |
| `/stats daily` | 24 h delta | player, stat, server | P | all | embed | same |
| `/compare` | Two players | player1, player2, stat, server | P | all | paginated embed | Not wrapped; numbered option names (DISC-26) |
| `/leaderboard` | Top 10 | stat, server | P | all | embed, medals | Duplicate of `/top` |
| `/top` | Top 10 | stat, server | P | all | embed | Identical to `/leaderboard` (DISC-18) |
| `/sessions` | Recent sessions | player, server | P | all | embed | OK |
| `/players` | Roster | server, sort, inactive, include_unknown | P | all | paginated embed, lines | Sort choice "Last seen" hard-coded English; snake_case option |
| `/activity` | Busy hours | server | P | all | embed | OK |
| `/profile` | Player card | player, server | P | all | thumbnail embed, emoji bullets | Mixed date formats (DISC-36); good recovery string `profile.noPlayer` |
| `/chunkbase` | Seed map link | dimension, server | P | all | embed | Footer shows `server | user.tag` publicly |
| `/waypoints` | Waypoint list | server, category | P | all | paginated embed | Waypoint vs "Wegpunkt" in DE |
| `/link` | Start link | none | E | all | plain text | Plain text, not embed |
| `/linkstatus` | Link state | none | E | all | plain text | Three commands for one concept (DISC-18) |
| `/unlink` | Remove link | none | E | all | plain text | No confirmation |
| `/daily` | Claim reward | server | P success, E errors | linked | plain text (success), embed (errors) | Never defers; claim saved before first reply (DISC-02); generic errors |
| `/daily-history` | Past claims | server | E | all | embed | OK |
| `/daily-reminder` | Opt in to DM | enabled, server | E | all | text | `enabled` boolean vs `mode` choice in `/console` |
| `/streak` | Streak | server | E | all | plain text via defer | Not wrapped (DISC-03) |
| `/watch server\|player\|list\|remove` | One-shot DM | server, player, id | E | all | embed | `id` has no autocomplete (DISC-20) |
| `/poll create\|status\|close` | Cross-platform poll | question, options, duration, server, servers | P | ADM | embed + up to 5 buttons | Admin tag in description, `servers` free text, title built from user text |
| `/help` | Command list | none | E | all | paginated embed, 5 per page, 9 pages | Subcommand rows wrong, dead buttons (DISC-11) |
| `/clear-dm` | Delete bot DMs | amount, save_history | E | all | embed (+file) | Shown in guilds too (DISC-21) |
| `/whois` | Audit card | username | E | ADM | embed, inline fields | No autocomplete on `username` (DISC-20) |
| `/note add\|list\|remove` | Player notes | player, text, index, server | E | ADM | embed | OK |
| `/challenge start\|status\|cancel` | Advancement race | advancement, reward, item, amount, duration, server | P | ADM | embed, Gold | Denial is public (DISC-06) |
| `/console tail\|live` | Log tail, relay | lines, mode, server | E | ADM | plain text + code block | `mode` on/off vs boolean elsewhere |
| `/config show\|reload` | Config | none | P | ADM | embed with code blocks | Public output of URLs, ids, partial token (DISC-05) |
| `/daily-admin move\|reset\|show` | Daily records | user, from, to, overwrite, server | E | ADM | embed | `from`/`to` free text, no autocomplete |
| `/server start\|stop\|restart\|backup\|status\|prune-stats` | Control | server, archive, confirm | P | ADM | progress embed then result embed | No confirm for stop/restart (DISC-14); denial public |
| `/ban` `/kick` `/pardon` | Moderation | player, duration, reason, server | P | ADM | success embed | `/pardon` has no autocomplete; console reason "Temporarily banned" English (DISC-08) |
| `/clear` | Bulk delete | amount | E | MM | success embed | Only command with Discord-side permission gating |
| `/whitelist` `/verify` | Add to whitelist (alias pair) | username, server | P | ADM | success embed | Two names for one command (DISC-18) |
| `/unwhitelist` | Remove | username, server | P | ADM | success embed | No autocomplete, no confirmation |

### Structure findings (summary)

Naming of recurring options:

| Concept | Names in use | Proposal |
|---|---|---|
| Minecraft account | `player` (14), `username` (4: whois, whitelist, verify, unwhitelist), `player1`/`player2` (compare) | `player` everywhere; compare uses `player` and `other` |
| Server | `server` (all but): `from`/`to` (daily-admin), `servers` (poll) | keep `server`; `servers` becomes a multi-select style `also_on` |
| On/off | `enabled` (boolean, daily-reminder), `mode` (on/off choice, console live), `confirm` (boolean, prune-stats), `overwrite` | boolean `enabled` for toggles, `confirm` for destructive |
| Duration | integer hours (poll, challenge), string `30m`/`2h` (ban), integer days (`inactive`) | string with unit everywhere, parsed by the existing `parseDuration` |
| Case | `save_history`, `include_unknown` (snake), others single word | single words or kebab-free: `history`, `unknown` |

Proposed tree (45 to 24 top-level, all admin tools in 3 groups). Discord allows 25 subcommands and 8000 chars per command, so the budget is fine.

| New command | Absorbs |
|---|---|
| `/status`, `/info`, `/map`, `/seed`, `/mods`, `/help` | stay (the "first week" commands) |
| `/stats` player, daily, top, compare, playtime, sessions, players, activity, profile | `/stats`, `/top`, `/leaderboard`, `/compare`, `/playtime`, `/sessions`, `/players`, `/activity`, `/profile` (9 into 1) |
| `/link` start, status, remove | `/link`, `/linkstatus`, `/unlink` |
| `/daily` claim, streak, history, reminder | `/daily`, `/streak`, `/daily-history`, `/daily-reminder` (keep `/daily` with no subcommand not possible: Discord forbids mixing; accept `/daily claim`) |
| `/server` status, tps, uptime, backups (read), start, stop, restart, backup-now, prune-stats | `/tps`, `/uptime`, `/backup`, `/server` |
| `/mod` kick, ban, pardon, whois, note | `/kick`, `/ban`, `/pardon`, `/whois`, `/note` |
| `/whitelist` add, remove, list | `/whitelist`, `/verify`, `/unwhitelist`, `/whitelisted` |
| `/admin` config, console, challenge, poll, daily-records | `/config`, `/console`, `/challenge`, `/poll`, `/daily-admin` |
| `/watch`, `/waypoints`, `/chunkbase`, `/clear`, `/clear-dm` | stay |

Trade-off to decide in phase B: hiding admin groups via `setDefaultMemberPermissions` would also hide them from config-listed admins who lack the Discord permission, so keep the runtime check as the authority and only add guild-only contexts plus an `[Admin]` description prefix. Renames are breaking for muscle memory and for `commandPolicy` keys (policy is keyed by command name), so a migration alias window is needed.

Autocomplete (`src/bot/index.ts:323-370`):
- Handled: `server` (prefix match on id, 25 max, `all` for `/uptime`) and `player`/`player1`/`player2` (prefix match on known names).
- Missing: `username` (whois, unwhitelist), `/pardon player` (no `setAutocomplete`; should list banned players), `/watch remove id` (should list the user's watches with label), `stat` in `/stats` and `/compare`, `from`/`to` in `/daily-admin`.
- Quality: prefix only (no contains), no default marker, no online/offline hint on server entries, label equals raw id.

Ephemeral policy as built: ephemeral for personal data and admin lookups (link, streak, history, reminder, watch, help, whois, note, console, daily-admin, clear, clear-dm); public for everything else including `/config show` and every error of a wrapped command, because `withErrorHandling` defers publicly before `requireServerAdmin` runs (`middleware.ts:60-99`). `/daily` success is public plain text.

Slash metadata (plain English by decision): the voice is fine but inconsistent. Seven admin commands end in "| Admin only" (challenge, console, note, poll, ban, kick, pardon), ten others do not (config, server, whitelist, verify, unwhitelist, whois, daily-admin "(admin)", clear). The server option is "Server instance" on 30+ commands; a user learns nothing from it. Proposed: `Server to use (default: this Discord server's default)`. `daily` says "Link required", `clear` hides its Manage Messages need.

## (c) Embed and reply catalogue

Shared builders (`src/bot/utils/embeds/embedUtils.ts`): `createEmbed` (Info blue, timestamp on by default), `createSuccessEmbed` (title "✅ Success"), `createErrorEmbed` ("❌ Error"), `createInfoEmbed` ("ℹ️ Info"), `createEmbedWithThumbnail`, `createPlayerEmbed` (author head, or thumbnail if flag), `createPaginationButtons` (4 emoji buttons), `handlePagination` (60 s collector). Palette in `embedColors.ts`: Success 0x55ff55, Error 0xff5555, Info 0x00bfff, Warning 0xffaa00, Gold, Critical 0xff0000, Neutral 0x888888, Challenge purple, Blurple, Modrinth green. State display (emoji + colour + hint) in `serverStateDisplay.ts`.

| Surface | Builder | Title | Description / fields | Footer | Colour | Extras |
|---|---|---|---|---|---|---|
| Any success | createSuccessEmbed | "✅ Success" (generic) | one sentence | none or text | Success | timestamp |
| Any error | createErrorEmbed | "❌ Error" | one sentence, no recovery | often repeats the title ("Player Not Found") | Error | timestamp |
| /status | createEmbed | "Server Status: x" | "🟢 **Online**: 3/20 players" + hint; fields Online, Bot Ping, Round Trip, Host | none | state colour | timestamp |
| Status embed (auto) | createEmbed | "📊 Server Status" | one field per server (inline if <=3) | "Updates every 60s" | always Info | edited in place; voice channel rename |
| /uptime | createEmbed | "📈 Uptime: x" | state line, 3 bar fields, sparkline | "Based on N checks" | Success/Error/Neutral | no amber |
| /mods | createEmbed | "🧩 Installed Mods: x" | 3 grouped link fields | freshness | Modrinth green | no limit guard |
| /tps | createEmbed | "🟢 TPS: x" (🟢/🟡/🔴) | inline 1/5/15 min | raw server text | Success/Warning/Error | |
| /backup | createEmbed | "💾 Backup Status: x" | summary + inline field per dir | none | Info | |
| /profile | createPlayerEmbed(thumbnail) | "👤 name" | emoji bullet lines | server id | Info | |
| /stats | buildStatsEmbeds | "Stats for X (Page n/m)" | 2 fields per page | "Total stats | Page n/m" | Info | |
| Leaderboard (cmd, scheduled) | buildLeaderboardEmbed | "🏆 Leaderboard: stat (period)" | 🥇🥈🥉 then bold numbers | "N players tracked" or period note | Info | up to 10 embeds per scheduled message |
| /whitelisted | createEmbed | "📃 Whitelisted Minecraft Players" | field "Page n" with comma list | "Total: n" | Info | |
| /help | createEmbed | "📖 Command Help (Page n/m)" | per command: name field + "**Description:**" + Options field | none | Info | ✨ marks unseen |
| Poll | createEmbed | "🗳️ question" | numbered options, how to vote, "⏳ Ends" | server ids | Info; Gold at close | up to 5 buttons |
| Join / leave | createPlayerEmbed(author) | "Player Joined" / "Player Left" | "X joined the server" | server id if >1 server | Success / Error | name appears 3 times |
| Death | createPlayerEmbed | "☠️ Death" | vanilla death text | same | Error | |
| Advancement | createPlayerEmbed | "⭐ Made advancement" / "✨ Completed challenge" | bold name | same | Success / Challenge purple | |
| Server started / stopped | createEmbed | "🟢 Server Started" / "🔴 Server Stopped" | body, uptime | same | Success / Error | |
| Milestone / challenge / poll result | createEmbed | "🏅 …" / "🏆 …" / "🗳️ …" | prose | server id | Gold | |
| Downtime alerts | createEmbed + roleMention | "🔴 Server Down", "🟠 Server API Unreachable", "🔁 Server Crash Loop", "✅ …" | prose | server id | Error/Warning/Success | role ping on every one |
| TPS / disk / backup alerts | createEmbed + roleMention | "⚠️ Low TPS Warning" etc. | prose + inline TPS fields | server id | Warning/Critical/Error/Success | |
| Whitelist application | createEmbed + buttons | "📋 Whitelist application" | applicant, name, server, note | `wlapp:<id>` | Success then decision colour | Approve/Deny |
| Chat bridge | webhook (opt in) or createPlayerEmbed | player name | message | none | Info | embed per line when webhook off |
| DMs | plain text | none | reminder, watch, update, death coords, ban expiry, application result | none | n/a | no buttons |

Conventions actually followed:
- Colour: Success green, Error red, Info blue, Warning amber map cleanly for command results and alerts. The event posts break it: leave, death and "Server Stopped" use the Error red though nothing failed; join and advancement use Success green; Gold carries milestone, challenge, poll result at once; a purple only for challenge advancements.
- Emoji: titles of about 60% of embeds start with an emoji; "Player Joined", "Whois", "Notes", "Sessions", "Players on x", "Stats for x" do not. The generic titles carry emoji, specific ones inconsistently.
- Title case: English alerts use Title Case ("Server Back Online", "Low TPS Warning", "Crash Loop Cleared"); everything else is sentence case ("Poll closed", "Note added", "Disk space warning"). German is sentence case throughout.
- Footers: a mix of server id (always on profile, activity, poll, challenge; only when >1 server on watchers), "Requested by", error category repeats, page counters in three different formats (`Page n/m • count`, `Total stats | Page n/m`, `Total: n`).
- Timestamps: on by default for every embed, including ephemeral errors and info answers where they add nothing.
- Field ordering: no rule. Server-scoped data sometimes leads with the server id in the title, sometimes only in the footer.
- Inline rules: stats use `chunk.length <= 3 && chunkLength <= 100`; uptime overview and status embed use "<=3 servers". Discord renders at most 3 inline per row on desktop and stacks on mobile, so a 3-server status embed is dense on desktop and a long column on a phone.
- Limits: guarded in stats (1024 per field), leaderboards (10 embeds per message), `clamp` in players. Not guarded: `/mods` (6000 total), `/server status` description (`control.ts:231`, up to 4096), poll title (user text), alert descriptions.
- Pagination: 60 s timeout, only the invoker, buttons are bare emoji (⏮️ ◀️ ▶️ ⏭️) with no page indicator on the row, removed after timeout on public replies, left in place but dead on ephemeral ones (`embedUtils.ts:235-242` returns early for ephemeral).
- Loading states: all wrapped commands `deferReply` (public "thinking"); long-running `/server` actions show a Warning-coloured progress embed ("This can take several minutes...") and later replace it, which is the right pattern but shows no elapsed time and no result detail for `stop`/`restart` beyond "stopped".
- Confirmation of destructive actions: only `/server prune-stats` (dry run first, then `confirm:true`). `/server stop`, `/server restart`, `/unlink`, `/unwhitelist`, `/ban`, `/clear`, `/clear-dm` act immediately.

## (d) Findings

Severity: blocker (feature unusable), major (wrong or lost output, security-adjacent, or hits many users), minor (friction), polish. Evidence is file:line at this commit. Fixes name the builder to change; the ranked list is in (g).

### Blocker

| ID | Evidence | Problem | Fix |
|---|---|---|---|
| DISC-01 | `src/core/locales/de.ts:371` `wlapp.modalNote` = "Gibt's was, das die Admins wissen sollten? (optional)" (53 chars); used as label at `src/bot/interactions/whitelistApplications.ts:277`. Verified: `LabelBuilder.toJSON()` throws above 45 chars. | In every German guild with `whitelistApplications` the apply button cannot open its modal. EN label is 43 chars and works. | Shorten to "Hinweis für die Admins (optional)" (33). Add a locale test that every modal title/label (45), button label (80), select option (100), embed title (256) fits in both languages. |

### Major

| ID | Evidence | Problem | Fix |
|---|---|---|---|
| DISC-02 | `src/bot/commands/connection/daily/daily.ts:55-247` has no `deferReply`; `getOnlinePlayers` (l.131), sequential `give()` (l.226) and two store writes run before the first `reply`. | If RCON or the wrapper takes more than 3 s the interaction expires ("The application did not respond"), but the claim is already persisted (`persistClaim`, l.239). The user sees a failure and has lost the cooldown. | Defer first, then `editReply`; build the result as an embed (`createSuccessEmbed` with title "Daily reward"), keep errors ephemeral via follow-up. |
| DISC-03 | `src/bot/index.ts:468-481` catches with the literal `"❌ An error occurred."`. 13 commands export a raw `execute` (daily, streak, stats, playtime, compare, whitelisted, link, linkstatus, unlink, help, map, verify, whitelist). `resolveServer` is called outside their try blocks (`stats.ts:89`, `playtime.ts:37`, `streak.ts:33`, `daily.ts:95`). `whitelisted.ts:28-77` puts it inside a try and then reports "Failed to read the Whitelist." for every failure. | In a multi-server Discord server a member who types `/stats` without `server` should read `target.several` ("Several servers are available (a, b). Pass `server:` to choose one."). They get a generic English line, in German guilds too, because the string is not passed through `t()`. | In `index.ts` use `createErrorEmbed(t("common.unexpectedError"))` and `editReply` when deferred; wrap all 13 in `withErrorHandling`. Builder: add `replyError(interaction, message)` to `embedUtils.ts`, call it from both middleware and dispatcher. |
| DISC-04 | `src/bot/commands/info/mods.ts:35-69,108-128`: link lines are about 53 chars (`[Sodium Extra](https://modrinth.com/mod/sodium-extra)`), one field per 1024 chars, no total guard. | About 111 mods exceed Discord's 6000-char embed total; the API rejects the message and the user gets the generic error. Modpack servers routinely exceed this. | Paginate by group using a new `paginateFields` helper plus `createPaginationButtons`; count characters, not fields. Localise "*None*" and "(cont.)". |
| DISC-05 | `src/bot/commands/admin/config.ts:100-220`: wrapped with default `ephemeral:false`; embed lists every server `apiUrl`, guild ids, `redact(token)` (first and last 2 chars) and admin ids. | Anyone in the channel reads infrastructure details. | `{ ephemeral: true }`. |
| DISC-06 | `middleware.ts:60-99`: `withErrorHandling` defers publicly, then `requireServerAdmin` throws `common.noPermission`; result is a public red "❌ Error / You do not have permission to use this command." for the 10 admin commands that defer publicly (ban, kick, pardon, whitelist, verify, unwhitelist, server, poll, challenge, config; whois, note, console and daily-admin defer ephemerally). The dispatcher's own denial (`index.ts:432`) is a different, ephemeral plain-text shape. | Non-admins who try an admin command post a public error; two shapes for the same denial; the message says neither who may use it nor what to do. | Check admin before deferring (`requireServerAdmin` as a pre-defer guard replying ephemeral) with one shared embed. Text: "This command is for bot admins only. Ask an admin if you need it." |
| DISC-07 | `control.ts:164` (`the \`${sub}\` management script`), `mods.ts:89` ("a mod manifest (common/downloaded_versions.json)"), `backup.ts:16` ("the suite backup layout") are passed as `{feature}` into `capability.missing`. | DE renders "**x** bietet the `start` management script nicht an." Mixed language in an error that explains a missing setup. | Pass i18n keys, translate inside `requireCapability`. |
| DISC-08 | Hard-coded English in localised surfaces: `statusEmbed.ts:291,340` ("players", "⚠️ Error fetching status"); `serverStateDisplay.ts:83-89` ("players", "including"); `mods.ts:36,66` ("*None*", "(cont.)"); `tps.ts:37-39`, `tpsMonitor.ts:85-94` ("1 min", "5 min", "15 min"); `uptime.ts:96-98,68` (raw `online`/`offline`/`unknown`); `players.ts:52` (choice "Last seen"); `relativeTime.ts:73-83` via `mods.footerStale` ("3 h ago"); `ban.ts:90` console reason "Temporarily banned" shown to the banned player; `control.failed` interpolates raw `sub` ("start", "prune-stats"). | German guilds see English fragments inside German sentences; the status embed is the most visible one. | Route through `t()`; `describePlayers` takes a localised unit; uptime uses `describeState`. |
| DISC-09 | `downtimeMonitor.ts:340-345`, `hostResourcesMonitor.ts:255-258`, `tpsMonitor.ts:56,115-118`: `roleMention` is applied to every alert, including "Server Back Online", "Disk space recovered", "Fresh backup detected", and TPS re-pings every 5 minutes while low. | Recoveries ping the on-call role like failures do; a long TPS dip pages repeatedly with no closing message. | Ping only on first failure and on severity increase. Recoveries call `roleMention(undefined)`. Add a TPS recovery embed. Put the outage duration in the recovery text. Builder: `alertUtils.roleMention` plus a `sendAlert(kind)` wrapper. |
| DISC-10 | `chatBridge.ts:132,185-199,353-358`: webhook is cached by channel and only invalidated on config reload; a send failure is logged and the message dropped (`enqueueSend` catch). | If an admin deletes the bridge webhook or the token is revoked, every bridged message is silently lost until the next reload. Discord also restricts some webhook usernames (substrings such as "clyde"/"discord"; verify live), which would drop that player's lines. | On send error with unknown-webhook, invalidate the cache and fall back to the embed form for that message; prefix the avatar name with a safe form when the name is rejected. |
| DISC-11 | `help.ts:70-107`: subcommand builders have no `required`, so `/server` renders "• `start`: Start the Minecraft server (optional)"; subcommand parameters are never listed. 45 commands at 5 per page = 9 pages; no categories although the dashboard's Commands view groups by folder (`commandManifest.ts:25-33`); admin commands are mixed in with no marker; ✨ reordering changes page contents per user; `embedUtils.ts:235-242` leaves ephemeral buttons dead after 60 s. | `/help` is the only discovery tool and it misdescribes the tree. | Group by category with one embed per category and a select menu; render `/stats player <player> [stat] [server]`; badge admin commands; disable (not remove) buttons on timeout for both visibilities and extend to 3 min. Builders: `createPaginationButtons`, `handlePagination`, new `buildHelpEmbeds`. |
| DISC-12 | Error catalogue below. | 14 error strings state the problem but give no next step. | `createErrorEmbed(message, { hint })` renders a second line; rewrite per table. |
| DISC-13 | `embedUtils.ts:74,90,106`; 40 call sites. | "✅ Success" and "❌ Error" occupy the title line and say nothing; the real statement sits in the description ("Banned **x** on **y**."). On mobile the title is the only line seen in notifications and collapsed lists. | Default title = action ("Player banned", "Whitelist updated"); error title = "Could not <action>". Keep the generic ones only as fallback. |
| DISC-14 | `control.ts:129-253`: `stop` and `restart` start the 30 s countdown the moment the command runs, public, with no confirmation and no player count. | A mistyped subcommand kicks everyone online. `prune-stats` shows the pattern to copy (dry run first). | Ephemeral preview ("2 players online. Stop **survival** in 30 s?") with a Danger confirm button and a 30 s expiry; progress embed with elapsed time. Builders: new `createConfirmRow`, `createProgressEmbed`. |
| DISC-15 | `de.ts:208-231`: "Die API-Wrapper" (feminine) in `downtime.apiDown`, `apiUp`, `apiDownServerKnown`, `state.unknownHint`, `state.wrapperDownHint`; correct "der API-Wrapper" in `console.reason.*`. Plus `downtime.crashLoop` (EN `en.ts:222`, DE `de.ts:218`) tells admins to run "`/mods` disable", a subcommand that does not exist (`/mods` only lists). | The alert people read at the worst moment contains grammar errors and an instruction that cannot be followed. | Rewrite per section (e); correct the recovery steps to `/server restart` after fixing mods. |

### Minor

| ID | Evidence | Problem | Fix |
|---|---|---|---|
| DISC-16 | `embedColors.ts`, `joinLeave.ts:117`, `deaths.ts:157`, `serverEvents.ts:63,86` | Error red marks leave, death, "Server Stopped"; Gold means five things; uptime shows no amber for "not responding" while status does; dashboard shows amber for unknown and Discord grey. | Add event colours (`EmbedColor.Event`, `Join`, `Leave`) or neutral grey for events; reserve Error for failures; `createEventEmbed(kind)`. |
| DISC-17 | `chatBridge.ts:381-422`, `sanitize.ts:16-37` | Discord to game: text cut at 160 chars with no signal; empty text (image only) sends "[Name] "; custom emoji `<:x:123>` and mentions `<@123>` arrive raw in game chat; attachments, stickers and replies are dropped without trace. | `formatBridgeMessage(msg)` using `cleanContent`, `:name:` for emoji, "[image]" for attachments, skip empty, react "✂️" on truncation. |
| DISC-18 | Inventory, structure findings. | Duplicates and split concepts: `/top` = `/leaderboard`; `/verify` = `/whitelist`; `/backup` (read) vs `/server backup` (create); `/status` vs `/server status` vs `/tps` vs `/uptime`; link x3; daily x5. | Tree in (b). |
| DISC-19 | `embedUtils.ts:154-183` | Four bare emoji buttons, no `2/5` indicator, no labels for screen readers, 60 s timeout, invoker only. `/whitelisted` has no "x/y" and puts the page number in a field name. | Add a disabled middle button "2/5", labels via emoji plus text where space allows, disable instead of remove, 3 min, `pageFooter(page, total, count)` for every paginator. |
| DISC-20 | `index.ts:323-370`, option inventory | Autocomplete gaps (see (b)); server list is prefix-only without default marker. | Move to `utils/autocomplete/`, add handlers: banned players, user watches, known usernames, stat keys, "default" marker. |
| DISC-21 | all `data` exports | No `setContexts`; 30 guild-only commands show in DMs and answer with `clear.textChannelOnly` or router errors. | `.setContexts(InteractionContextType.Guild)` on guild-only commands; allow DM for link, help, watch, daily family. |
| DISC-22 | `statusEmbed.ts:371-375` | Embed colour is always Info regardless of fleet state; footer "Updates every 60s" is static; timestamp shows absolute time only. | Colour by worst `describeHealth` colour; footer "Updated <t:ts:R>"; list degraded servers first. |
| DISC-23 | `i18n.ts` (no plural rules), 19 EN / 17 DE "(s)" patterns | "1 session(s)", "Tag(en)", "Minute(n)", "die 1 Befehle" (`help.newToYou`). | `t()` plural syntax `{count|one|other}` via `Intl.PluralRules`; migrate the 36 strings. |
| DISC-24 | `en.ts`/`de.ts`: 56+58 em dashes, 2+2 en dashes; `poll.ts:79`, `clear.ts:16` en dashes in slash metadata | Violates the repo dash rule; titles such as "How to join <EM> x" look machine-made. | Replace with colon, comma or period; mechanical, but touches about 120 strings. |
| DISC-25 | `seed.ts:26`, `map.ts:29`, `chunkbase.ts:49`, `playtime.ts:45-96`, `stats.ts:100-242`, `embedUtils.ts:40` | "Requested by x" footers on public embeds (adds `user.tag` to the channel); error footers repeat the title; timestamp default on every embed. | Drop these footers; `createEmbed` timestamp default false, on only for live data. |
| DISC-26 | Option inventory | Inconsistent option names (see (b)). | Rename with a deprecation alias window. |
| DISC-27 | Slash descriptions | "| Admin only" on 7 of 18 admin commands; "Server instance" on 30+ options. | Prefix `[Admin]`, describe the server option properly. |

### Polish and backlog

| ID | Evidence | Problem | Fix |
|---|---|---|---|
| DISC-28 | `control.ts:227-233` | `/server status` reuses the title "Server Status: x" and puts unbounded script output in a code block (fails above 4096). | Title "Status script output", slice to 3900. |
| DISC-29 | `serverEvents.ts`, `restartScheduler.ts:125-179` | One planned restart yields "Scheduled restart ahead", "Scheduled restart executed", "Server Stopped", "Server Started" plus status embed edits. | One message that is edited through the stages. |
| DISC-30 | `daily.ts:276-299`, `dailyReminderScheduler.ts:54-58` | Daily success is plain public text while errors are embeds; reminder DM has no "stop reminders" button although the hint infrastructure supports buttons. | Embed reply; add a button to the DM. |
| DISC-31 | `whitelistApplications.ts:413,396`, `en.ts:401` | Deny has no reason field; DM says only "was denied"; footer shows internal `wlapp:<id>`. | Optional reason modal; neutral footer. |
| DISC-32 | `docs/user/commands.md` | Lists `/say`, `/netherportal`, `/playerhead` as slash commands; they exist only as in-game `!` commands. | Fix docs. |
| DISC-33 | `tps.ts:65` | Raw server output (first 100 chars) as footer; 🟡 appears nowhere else. | Remove footer, reuse state emoji. |
| DISC-34 | `backup.ts:44-49` | Raw directory names ("hourly", "archives/x") where the dashboard shows "Hourly", "Archive"; ages as "5m/3h/2d". | Shared tier labels from `@mcbot/schema`; Discord timestamps. |
| DISC-35 | `playerhead.ts:15-27`, `sleepWatcher.ts` | In-game replies not localised; sleep prompt is German only, always on, not configurable. | Move to `t()`; add config switch. |
| DISC-36 | `profile.ts:86-91,111`, `daily.ts:272`, `whois.ts` | Three date styles: raw stored string, `<t:ts:R>`, guild-timezone clock. | Use Discord timestamps throughout. |

### Error and permission messages: worst offenders (part of d)

Pattern wanted: what failed, why if known, what to do next. The only strings that already do it are `query.unreachable`, `profile.noPlayer`, `moderation.invalidDuration`, `control.pruneNoWhitelist`, `link.pending`.

| Key | File ref | EN now | DE now | Missing | Proposed EN |
|---|---|---|---|---|---|
| (literal) | `index.ts:471` | "❌ An error occurred." | (not localised) | everything | "Something went wrong and the command did not finish. Try again in a moment; if it keeps happening, tell an admin." |
| `common.noPermission` | `en.ts:27`, `de.ts:21` | "You do not have permission to use this command." | "Du hast keine Berechtigung für diesen Befehl." | who can, what next | "This command is for bot admins only. Ask an admin if you need it." |
| `common.unexpectedError` | `en.ts:542` | "An unexpected error occurred." | "Es ist ein unerwarteter Fehler aufgetreten." | next step | same as the first row |
| `common.serverNotFound`, `router.serverNotFound` | `en.ts:26,667` | "Server not found." / "Server \"{server}\" not found." | "Server nicht gefunden." | list of valid servers | "No server called \"{server}\". Available: {servers}." |
| `daily.linkRequired` | `en.ts:629` | "You must link your Discord account first." | "Du musst zuerst dein Discord-Konto verknüpfen." | the command | "Link your Minecraft account with /link first, then run /daily again." |
| `daily.dataError` | `en.ts:633` | "Daily rewards data unavailable." | "Die Daily-Belohnungsdaten sind nicht verfügbar." | cause, owner | "No daily rewards are set up for this server. Tell an admin." |
| `common.playerNotFound` | `en.ts:543` | "Player `{player}` not found." | "Spieler `{player}` nicht gefunden." | spelling, scope | "`{player}` is not known on this server. Check the spelling or pick a name from the suggestions." |
| `stats.fileNotFound` | `en.ts:550` | "Stats file not found for `{player}`." | "Keine Statistikdatei für `{player}` gefunden." | jargon "file", cause | "No stats for `{player}` yet. They appear after the first session on this server." |
| `stats.failed`, `whitelisted.readFailed` | `en.ts:554,538` | "Failed to retrieve stats." / "Failed to read the Whitelist." | "…konnten nicht abgerufen werden." | retry, cause | "Could not load the stats. Try again in a moment." |
| `whitelist.notFound` | `en.ts:610` | "Username **{username}** not found." | "Benutzername **{username}** nicht gefunden." | whose lookup; also shown when the Mojang API is down | "Mojang has no player called **{username}**. Check the spelling." (and a separate message for "Mojang did not answer, try again") |
| `streak.noData` | `en.ts:480` | "No streak data found for your account." | "Für dein Konto gibt es noch keine Streak-Daten." | how to start | "No streak yet. Claim your first reward with /daily." |
| `tps.unavailable` | `en.ts:583` | "Could not retrieve TPS. Server may be offline." | "TPS konnten nicht abgerufen werden. Der Server ist möglicherweise offline." | where to check | "Could not read the TPS. Check /status to see if the server is up." |
| `backup.none` | `en.ts:578` | "No backups found." (thrown as an Error, so a red error) | "Keine Backups gefunden." | it is an empty state, not an error | Info embed: "No backups yet. An admin can create one with /server backup." |
| `wlapp.noServer` | `en.ts:377` | "This guild has multiple servers and no default <EM> an admin needs to set guilds.<id>.defaultServer before applications can route." (shown to an applicant) | "Diese Guild hat mehrere Server und keinen Default <EM> ein Admin muss erst guilds.<id>.defaultServer setzen." | audience: config path shown to a non-admin | "Applications are not available right now. Please tell an admin." |
| `router.guildOnly` | `en.ts:665` | "In a multi-server setup, commands must be used inside a Discord server." | "Bei mehreren Servern müssen Befehle auf einem Discord-Server ausgeführt werden." | which command, why | "There is more than one Minecraft server. Run this command in a Discord server so the right one is chosen." |
| `hint.failed` | `en.ts:422` | "Could not turn that on <EM> please try the command directly." | "Konnte das nicht aktivieren <EM> bitte nutze den Befehl direkt." | which command | "Could not turn that on. Run /daily-reminder yourself." |
| `capability.missing` | `en.ts:668` | "**{server}** doesn't provide {feature}. This feature needs the setup-suite layout. {hint}" | "**{server}** bietet {feature} nicht an. …" | feature is English in DE (DISC-07) | translate the feature, name the repo doc |
| `command.disabledHere` | `en.ts:405` | "`/{command}` is disabled here." | "`/{command}` ist hier deaktiviert." | who to ask | "`/{command}` is turned off on this Discord server. An admin can enable it." |

Permission model as users see it: the picker shows everything; denial arrives only after the command runs, with two different shapes (DISC-06); `/help` does not mark admin commands; `wlapp.notAdmin` says "server admins" while the check is bot-admin (config), not the Discord Administrator permission, which will mislead people with the Discord role.

DM behaviour: commands are not restricted to guilds (DISC-21). In a DM the `adminUsers` global list applies, guild admin lists do not (`middleware.ts:29-30`). Multi-server setups answer DMs with `router.guildOnly`, which has no way forward. `/link` and `/help` work in DMs.

### Chat bridge, notifications, signal and noise (part of d)

Chat bridge presentation (`chatBridge.ts`):
- Game to Discord: optional webhook (`useWebhook`, default off) gives the player as author with an mc-heads avatar (UUID when cached, name otherwise; Bedrock/Geyser names fall back to a default skin, noted in `mcHeads.ts`). `allowedMentions: { parse: [] }` correctly blocks pings. Without the webhook each chat line is a full embed with head, timestamp and Info colour, which in a busy channel is about four times the height of a normal message and cannot be scanned. Recommend making webhook the default and the fallback a plain `**name**: text` line, not an embed.
- Long text is cut at 2000 characters (webhook) with no marker; the embed path has the 4096 limit but no guard.
- `!`-prefixed lines are not bridged (good) and rate limiting reacts with ⏳ (good feedback, `chatBridge.ts:407-410`).
- Discord to game: see DISC-17. A failure to deliver reacts ⚠️ with no reason.
- Per-channel ordered queue and webhook prewarm are solid; the weak point is cache invalidation (DISC-10).

Event posts (join, leave, death, advancement, start, stop): each is an embed with author head, a title that restates the event, and a description that restates it again ("Player Joined" / "Steve joined the server" / author "Steve"). Four lines of height for one fact. A compact form is `🟢 **Steve** joined` as one description line with the head as thumbnail, and consecutive joins and leaves within 60 s could be edited into one message. Joins and leaves are on the default event list (`DEFAULT_NOTIFICATION_EVENTS`); with 20 players that is the loudest channel in the guild.

Alerts and mention policy:

| Source | Cadence | Dedupe | Ping | Problem |
|---|---|---|---|---|
| Downtime (`downtimeMonitor.ts`) | check 60 s, alert after 3 failures, suppressed 30 s grace on intended restarts | `alerted` flag, crash-loop flag | role on every alert | recoveries ping (DISC-09); no outage duration |
| TPS (`tpsMonitor.ts`) | poll interval from config, 5 min repeat | time-based only | role on every repeat | no recovery message, repeated pings |
| Disk and backup age (`hostResourcesMonitor.ts`) | 5 min, hysteresis | armed flags | role | all five alert types share `downtimeAlerts.channelId` and ping the same role |
| Scheduled restart | warn, then done | none | none | overlaps with Stopped/Started (DISC-29) |
| Update notifier | 24 h, DM only to config admins, once per version | `lastNotifiedVersion` | none | good; plain text, no link button |
| Daily reminder | 5 min scan, one DM per cycle | `lastReminderAt` | DM | no unsubscribe in the DM (DISC-30) |
| Watches | one-shot DM | consumed on fire | DM | clear and polite |
| Polls, challenges, milestones | event driven | stored state | none | good: no pings |
| Streak reminders | not present (daily reminder covers it) | | | |

Timing: alerts fire after 3 minutes of failures, which is a reasonable debounce. The status embed edits in place every 60 s (the right choice) but when the stored message id is gone it silently posts a new one and the old one is never cleaned.

## (e) German review

Register: du-form is consistent (no Sie/Ihr forms found). Tone is casual and mostly natural; the problems are grammar around loanwords, Denglisch verbs, literal translations and unmarked plurals.

Terminology map (what the strings do today):

| Concept | Variants in `de.ts` | Recommendation |
|---|---|---|
| Minecraft server vs Discord server | "Server" (97 uses) for both; "Discord-Server" (3), "Guild" (4), "Gilde/Gilden" (5) | "Minecraft-Server" or just "Server" when the context is a command target; "Discord-Server" for the guild; drop "Guild" and "Gilde" from user-facing text |
| Channel | "Channel" (5: Konsolen-Channel, Bewerbungs-Channel), "Kanal" (2: Textkanal) | "Kanal" everywhere (matches Discord's German UI) |
| Waypoint | "Waypoint" (12), "Wegpunkt" (1, `waypoint.noneInCategory`) | "Waypoint" |
| API wrapper | "die API-Wrapper" (5), "der API-Wrapper" (7) | masculine, "der API-Wrapper" |
| Claim | "Claim", "claimst", "abholen", "Abholversuch" | verb "abholen", noun "Belohnung"; keep "Daily" as a name |
| Watch | "Watch" as masculine noun | "Benachrichtigung" |
| Plural hack | "Tag(en)", "Session(s)", "Minute(n)" | proper plural helper (DISC-23) |
| Gender | "Erste(r)" | neutral rephrase |

Thirty worst strings (proposals contain no dashes):

| # | Key | Current | Proposed | Why |
|---|---|---|---|---|
| 1 | `wlapp.modalNote` | Gibt's was, das die Admins wissen sollten? (optional) | Hinweis für die Admins (optional) | 53 chars, Discord limit 45: modal fails (DISC-01) |
| 2 | `downtime.apiDown` | Die API-Wrapper von **{server}** antwortet seit {failures} Prüfungen nicht.\nDer Minecraft-Server selbst läuft möglicherweise weiterhin <EM> sein Zustand ist derzeit **unbekannt**, nicht offline. | Der API-Wrapper von **{server}** hat bei {failures} Prüfungen in Folge nicht geantwortet.\nDer Minecraft-Server läuft eventuell weiter. Sein Zustand ist **unbekannt**, nicht offline. | Genus, dash, "derzeit" filler |
| 3 | `downtime.apiUp` | Die API-Wrapper von **{server}** antwortet wieder. | Der API-Wrapper von **{server}** antwortet wieder. | Genus |
| 4 | `downtime.apiDownServerKnown` | …und ist **{state}** <EM> Spieler sind nicht betroffen, aber Server-Steuerung, Chat-Bridge und Statistiken fehlen, bis die Wrapper wieder läuft. | Der Minecraft-Server hat auf einen direkten Ping geantwortet und ist **{state}**. Spieler merken nichts. Steuerung, Chat-Bridge und Statistiken fallen aus, bis der API-Wrapper wieder läuft. | Genus, "Wrapper wieder läuft", long clause chain |
| 5 | `state.wrapperDownHint` | Der Server selbst ist erreichbar, seine API-Wrapper jedoch nicht <EM> Server-Steuerung, Chat-Bridge, Statistiken und Log-Überwachung sind daher nicht verfügbar, bis sie wieder läuft. | Der Server ist erreichbar, sein API-Wrapper nicht. Steuerung, Chat-Bridge, Statistiken und Log-Überwachung fallen aus, bis der Wrapper wieder antwortet. | Genus, wrong pronoun "sie" |
| 6 | `state.unknownHint` | Weder die API-Wrapper des Servers noch der Server selbst haben geantwortet, daher konnte der Zustand nicht ermittelt werden. Prüfe, ob der Host erreichbar ist. | Weder der API-Wrapper noch der Server hat geantwortet, der Zustand ist deshalb unbekannt. Prüfe, ob der Host erreichbar ist. | Genus, passive |
| 7 | `downtime.crashLoop` | …(meist ein defektes Mod <EM> versuche `/mods` disable für zuletzt geänderte), und starte ihn dann mit **/server restart** neu… | **{server}** ist {restarts}-mal neu gestartet und systemd versucht es nicht mehr. Der Server bleibt aus, bis jemand eingreift.\nPrüfe die Logs. Meist ist eine defekte Mod die Ursache, vor allem nach geänderten Mods. Starte danach mit **/server restart** neu, das setzt auch den Fehlerstatus von systemd zurück. | "das Mod" wrong gender, `/mods disable` does not exist, nested dash/parenthesis |
| 8 | `players.noneInactive` | Seit mehr als {days} Tag(en) war kein Spieler inaktiv. | Kein Spieler war länger als {days} d inaktiv. | Literal translation, reads as the opposite |
| 9 | `daily.queueFull` | Es warten bereits {max} nicht abgeholte Belohnungen ingame auf dich. Joine den Server und hol sie ab, bevor du erneut claimst. | Im Spiel warten schon {max} Belohnungen auf dich. Betritt den Server und hol sie ab, bevor du die nächste anforderst. | Denglisch "Joine/claimst" in an error |
| 10 | `daily.cooldown` | ⏳ Nächster Claim in {hours} h {minutes} min. \| Bereit um {time} | ⏳ Die nächste Belohnung gibt es in {hours} h {minutes} min (um {time} Uhr). | Pipe separator, "Claim" |
| 11 | `common.noPermission` | Du hast keine Berechtigung für diesen Befehl. | Dieser Befehl ist nur für Bot-Admins. Frag einen Admin, wenn du ihn brauchst. | No recovery, who can |
| 12 | `daily.linkRequired` | Du musst zuerst dein Discord-Konto verknüpfen. | Verknüpfe zuerst deinen Minecraft-Account mit /link, dann klappt /daily. | No command named; the thing linked is the Minecraft account |
| 13 | `daily.dataError` | Die Daily-Belohnungsdaten sind nicht verfügbar. | Für diesen Server sind keine Daily-Belohnungen eingerichtet. Sag einem Admin Bescheid. | Compound noun, no owner |
| 14 | `stats.fileNotFound` | Keine Statistikdatei für `{player}` gefunden. | Zu `{player}` gibt es noch keine Statistiken. Sie entstehen nach der ersten Session auf diesem Server. | "Datei" is jargon |
| 15 | `common.playerNotFound` | Spieler `{player}` nicht gefunden. | `{player}` ist auf diesem Server unbekannt. Prüfe die Schreibweise oder nimm einen Vorschlag aus der Liste. | No recovery |
| 16 | `whitelist.notFound` | Benutzername **{username}** nicht gefunden. | Mojang kennt keinen Spieler **{username}**. Prüfe die Schreibweise. | Says who looked |
| 17 | `whitelist.added` | **{name}** wurde auf **{server}** auf die Whitelist gesetzt. | **{name}** steht jetzt auf der Whitelist von **{server}**. | "auf ... auf" |
| 18 | `profile.whitelisted` | 📋 Gewhitelistet von {by} am {at} | 📋 Auf die Whitelist gesetzt von {by} am {at} | Anglicised participle |
| 19 | `challenge.wonEmbed` | **{player}** hat als Erste(r) **{advancement}** erspielt! | **{player}** hat **{advancement}** als Erstes geschafft! | Gender slash, "erspielt" |
| 20 | `challenge.fieldAdvancement` | Wer zuerst **{advancement}** erspielt, gewinnt | Es gewinnt, wer **{advancement}** zuerst schafft | Word order, verb |
| 21 | `dailyAdmin.targetExists` | **{user}** hat bereits einen Eintrag auf **{server}** <EM> overwrite:true zum Überschreiben. | **{user}** hat auf **{server}** schon einen Eintrag. Mit `overwrite:true` wird er ersetzt. | Telegram style, dash |
| 22 | `poll.alreadyActiveOn` | …Erst schließen oder den Server aus der Liste nehmen. | …Schließe sie zuerst oder nimm den Server aus der Auswahl. | Telegram style |
| 23 | `watch.duplicate` | Genau diesen Watch hast du schon aktiv. | Diese Benachrichtigung hast du schon aktiv. | "Watch" as noun; unclear gender |
| 24 | `watch.dmServer` | ✅ **{server}** ist wieder online. (Dieser Watch ist damit verbraucht.) | ✅ **{server}** ist wieder online. Diese Benachrichtigung ist damit erledigt. | "verbraucht" reads like a coupon |
| 25 | `router.guildOnly` | Bei mehreren Servern müssen Befehle auf einem Discord-Server ausgeführt werden. | Es gibt mehrere Minecraft-Server. Führe den Befehl auf einem Discord-Server aus, damit der passende gewählt wird. | Ambiguous "Server", no reason |
| 26 | `console.noChannel` | Kein Konsolen-Channel für diese Guild konfiguriert. Erst guilds.<id>.console.channelId in config.json setzen. | Für diesen Discord-Server ist kein Konsolenkanal eingerichtet. Trage `guilds.<id>.console.channelId` in der config.json ein. | Guild/Channel, unformatted path |
| 27 | `wlapp.noServer` | Diese Guild hat mehrere Server und keinen Default <EM> ein Admin muss erst guilds.<id>.defaultServer setzen. | Bewerbungen sind gerade nicht möglich. Sag bitte einem Admin Bescheid. | Config path shown to a player |
| 28 | `capability.missing` | **{server}** bietet {feature} nicht an. Diese Funktion braucht das Layout der Setup-Suite. {hint} | **{server}** unterstützt diese Funktion nicht: {feature}. Sie braucht die Setup-Suite. {hint} | Feature text is English (DISC-07) |
| 29 | `dailyReminder.enabled` | ✅ Tägliche Erinnerungen aktiviert <EM> ich schicke dir eine DM, sobald dein nächstes /daily bereit ist. Stelle sicher, dass deine DMs für diesen Server offen sind. | ✅ Erinnerung aktiv. Du bekommst eine DM, sobald dein nächstes /daily bereit ist. Deine DMs müssen dafür offen sein. | 160 chars to say three facts |
| 30 | `help.newToYou` | ✨ markiert die {count} Befehle, die du noch nicht ausprobiert hast <EM> sie stehen zuerst. | ✨ = noch nicht ausprobiert ({count}). Diese Befehle stehen zuerst. | "die 1 Befehle" at count 1 |

Additional DE fixes worth batching: `control.progressLong` ("...", dash) to "Das kann einige Minuten dauern: Countdown, Welt speichern und bei Backups das Archivieren."; `tempban.dmExpired` to "Dein befristeter Bann auf **{server}** ist abgelaufen. **{player}** kann wieder beitreten. Bitte halte dich an die Regeln."; `poll.badOptions` to "Gib {min} bis {max} Optionen an, getrennt durch |."; `hostAlerts.diskFull` ending to "Backups und das Speichern der Welt können bald fehlschlagen."; `mods.footerStale` shows "3 h ago" from `relativeAge` inside German text.

EN strings worth fixing (not parity, wording): `downtime.crashLoop` (nonexistent `/mods` disable, see row 7), `info.versionUnknown` ("Unknown <EM> the server did not answer." to "Unknown. The server did not answer."), `nudge.link` and `nudge.daily` (in game, long, run-on), `uptime.currently` shows the raw lowercase state, `leaderboard.noClaims` ("No claims on this server yet." to "Nobody has claimed a daily reward on this server yet."), `help.description` ("**Description:**" label wastes a line on every command).

## (f) Shared concepts with the dashboard

| Concept | Dashboard term | Discord EN | Discord DE | Verdict |
|---|---|---|---|---|
| Server state | "Online", "Not responding", "Offline", "State unknown" (`utils/format.ts:170-181`) | same four (`state.*`) | "Online", "Antwortet nicht", "Offline", "Zustand unbekannt" | Match in `/status`, alerts, status embed. `/uptime` shows raw "online"/"offline"/"unknown" and lacks "not responding" (DISC-08) |
| State colour | green / red / amber dot; amber for both unresponsive and unknown (`StatusDot.vue`, `format.ts:131-143`) | 🟢 green, 🟠 orange, 🔴 red, ⚫ grey (`serverStateDisplay.ts:33-40`) | same | Unknown differs (amber vs grey); pick one. Recommendation: grey for unknown on both |
| Wrapper down | "API wrapper unreachable <EM> server controls, logs and stats are unavailable. The server itself answered a direct ping." | "The server itself is reachable, but its API wrapper is not <EM> so server controls, the chat bridge, stats and log watching are unavailable until it is back." | "…seine API-Wrapper jedoch nicht…" | Same facts, three phrasings. Share one string table in `@mcbot/schema`; fix DE gender |
| Server | nav "Servers", switcher "SERVER" | option "Server instance", titles "Server Status: x" | "Server" for both Minecraft and Discord server | Discord DE ambiguity (section e) |
| Guild | nav "Guilds" (discord icon) | "Discord server" (`router.guildOnly`) and "guild" (`console.noChannel`, `wlapp.noServer`, `target.*`) | "Gilde", "Guild", "Discord-Server" | Mismatch inside Discord itself. Pick "Discord server" in Discord text, keep "Guild" only in dashboard admin where it names a config key |
| Backups | "Backups", tiers "Hourly", "Daily", "Archive", "Pre-update", "Manual" (`format.ts:104-119`) | `/backup`: raw dir names ("hourly", "archives/x" shown as "📁 x") | "Backup(s)" | Tier labels differ; share the labelling function |
| Mods | "Mods", toggle "hide client-only mods"; no group names found | `/mods` groups "Client + Server", "Optional (client)", "Server-only" | "Nur Server", "Optional (Client)" | Unverified parity; align group names with the dashboard's client/server vocabulary |
| Players | "Online" counts, player names | "players" | "Spieler" | OK |
| Permissions | "Sysadmin", per-capability gates (`server:read`, `mods:read`, `audit:read`), guild admin | "admin", "bot admin", "server admin" (`wlapp.notAdmin`) | "Admin", "Server-Admin" | Discord has one admin tier; `wlapp.notAdmin` calls it "server admins" which users read as the Discord role. Say "bot admins" |
| Audit | "Audit Log" | "audit log" in `/kick` and `/ban` option text | "Audit-Log" (not seen) | Collides with Discord's own Audit Log; say "bot audit log" |
| Feature names | "Notifications", "Chat Bridge", "Leaderboard", "Status Embed", "Downtime Alerts", "TPS Alerts", "Channel Purge", "Whitelist Apps" (`GuildsView.vue:136-146`) | `/config show` prints raw keys "chatBridge", "tpsAlerts", "purge", "downtime" next to localised "status", "notifications" | localised for two only | Mismatch; render dashboard names |
| Command groups | Commands view groups by source folder (admin, connection, general, info, moderation, server, stats) | `/help` has no groups | none | "connection" means link and daily and means nothing to a user; rename groups and use them in both |
| Language | English only | EN + DE | DE | A DE guild gets a German bot and an English dashboard; note for phase B planning |

## (g) Ranked top 25

Effort: S under half a day, M one to two days, L more. "Builder" names the function in `src/bot/utils/embeds` (or the named file) that carries the fix.

| Rank | ID | Sev | Effort | Fix | Builder change |
|---|---|---|---|---|---|
| 1 | DISC-01 | blocker | S | German modal label under 45 chars; limit test for all labels | `whitelistApplications.ts` modal; new `clampLabel` + locale limit test |
| 2 | DISC-02 | major | S | `/daily` defers, replies as embed | `createSuccessEmbed(title)` for daily; `withErrorHandling` |
| 3 | DISC-03 | major | S | Dispatcher error localised and specific; wrap 13 commands | new `replyError` in `embedUtils.ts`; `createErrorEmbed` |
| 4 | DISC-04 | major | M | Paginate `/mods`, count chars | new `paginateFields`, `createPaginationButtons`, `handlePagination` |
| 5 | DISC-05 | major | S | `/config show` ephemeral | `withErrorHandling({ephemeral:true})` |
| 6 | DISC-06 | major | M | Admin check before defer, one ephemeral denial | `requireServerAdmin` + `createErrorEmbed` with hint |
| 7 | DISC-07 | major | S | Capability feature as i18n key | `requireCapability` signature; `capability.missing` |
| 8 | DISC-08 | major | S | Localise hard-coded fragments | `describePlayers`, `statusEmbed`, `uptime` via `describeState` |
| 9 | DISC-09 | major | S | Ping only on failure; recovery silent; TPS recovery | `alertUtils.roleMention` call sites, `sendAlert(kind)` |
| 10 | DISC-10 | major | S | Webhook invalidation and embed fallback | `chatBridge.deliver`, `invalidateWebhookCache` |
| 11 | DISC-11 | major | M | Rebuild `/help` by category, subcommand syntax, admin badge | new `buildHelpEmbeds`, `handlePagination` (disable on end) |
| 12 | DISC-12 | major | S | Recovery text on 14 errors | `createErrorEmbed(message, {hint})` |
| 13 | DISC-13 | major | M | Action titles instead of "Success/Error/Info" | `createSuccessEmbed`/`createErrorEmbed`/`createInfoEmbed` title option |
| 14 | DISC-14 | major | M | Confirm button for stop/restart, elapsed progress | new `createConfirmRow`, `createProgressEmbed` |
| 15 | DISC-15 | major | S | DE grammar for wrapper alerts; correct crash loop steps | locale only |
| 16 | DISC-16 | minor | S | Event colours separate from Error | `EmbedColor`, new `createEventEmbed(kind)` |
| 17 | DISC-17 | minor | M | Discord to game message formatting | new `formatBridgeMessage` (bridge, not embeds) |
| 18 | DISC-18 | minor | L | Consolidate 45 commands into 24 | command definitions; `/help` categories |
| 19 | DISC-19 | minor | S | Page indicator, disable on end, 3 min | `createPaginationButtons`, new `pageFooter` |
| 20 | DISC-20 | minor | M | Autocomplete for banned, watches, usernames, stats | `index.ts` router to `utils/autocomplete/` |
| 21 | DISC-21 | minor | S | Guild-only contexts on 30 commands | each `data` builder |
| 22 | DISC-22 | minor | S | Status embed colour by worst state, relative update time | `buildStatusEmbed`, `describeHealth` |
| 23 | DISC-23 | minor | M | Plural support in `t()` | `core/utils/i18n.ts` |
| 24 | DISC-24 | minor | S | Remove 120 dashes from locale strings | locale only |
| 25 | DISC-25 | minor | S | Drop "Requested by" and echo footers; timestamp default off | `createEmbed` default, `createErrorEmbed` footer option |

Backlog IDs DISC-26 to DISC-36 are in the polish table of section (d).

Suggested order for phase B: items 1, 2, 3, 5, 7, 8, 9, 10, 15 are small and independent (about two days together). Items 12 and 13 should land as one change because both rewrite the shared builders. Item 18 is the only one that needs a product decision first.

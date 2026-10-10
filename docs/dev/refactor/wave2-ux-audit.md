# Wave 2 UX audit: synthesis (phase A)

Entry document for Wave 2 phase B. It merges two source audits, which stay as appendices and hold the full evidence, screenshots and per-finding text:

- [Appendix A: dashboard audit](wave2-audit/dashboard.md) (`DASH-xx`, screenshots in `wave2-audit/shots/`)
- [Appendix B: Discord audit](wave2-audit/discord.md) (`DISC-xx`)

Wave 1 context: [wave1-summary.md](wave1-summary.md). Nothing in this phase changed source code. Severity scale: blocker (task cannot be done), major (wrong or lost output, security-adjacent, or hits many users), minor (friction), polish. Effort: S under half a day, M one to three days, L more.

Id caveat: the dashboard audit reuses a few ids for more than one finding (`DASH-07` labels and unnamed buttons, `DASH-11` confirm patterns in Servers, Mods and typed dialogs, `DASH-13` load errors, job progress, toast overlap). This document keeps the ids and names the sub-issue where it matters. `DASH-19` (dark only), `DASH-24` (copy), `DASH-25` (nav grouping) exist only in the ranked table of Appendix A.

## 1. Scope, method, limits

| Item | Dashboard | Discord |
|---|---|---|
| Surface | `src/web/frontend` (Vue 3, PrimeVue), Fastify backend | `src/bot/commands`, `interactions`, `utils/embeds`, `logWatcher`, dispatch in `src/bot/index.ts`, both locale files, `docs/user/commands.md` |
| Method | Rendered in Edge via Playwright at 1440, 430, 360, dark theme, against a fake wrapper (1 server, 3 players, 12 mods, 6 backups, 4 mod config files). axe-core 4.10.2 on all 11 views, keyboard Tab walk, dirty-state probes, source reading of all views and composables. | Static reading plus four throwaway checks against discord.js 14.27.0 (subcommand `required`, `LabelBuilder` length limit, embed size, locale scan of 495 keys per language). |
| Benchmark | Mods tab and Mod Config | none (compared against Discord platform limits and the shared embed builders) |

What could not be verified, merged:

| Gap | Consequence |
|---|---|
| No live Discord gateway, nothing rendered | Embed width, mobile wrapping, button layout, webhook behaviour are judged from builder code and documented limits. Items marked "verify live" (webhook username restrictions, DISC-10) are unconfirmed. |
| No Discord token or OAuth app | Commands editor body, guild config editor, setup wizard steps 2 and 3 and guild cards were seen only in empty or error states. |
| Mod scripts and server actions need sudo or run for real | Install, update, remove, Apply all, the compat job and start, restart, backup progress were read in source, not run. |
| Dev auth is always sysadmin | Non-sysadmin and read-only roles were audited from source only (`ModConfigView.vue:178`, `App.vue:119`). |
| No real phone, no screen reader | Touch sizes are measured, not felt. A11y findings come from axe and DOM, not NVDA or VoiceOver. |
| No light theme exists | Light mode is "not applicable" (DASH-19). |
| German reviewed by reading; Discord reply JSON reconstructed from builder calls, not captured | Tone judgements on the German strings are a reviewer read, not native-speaker sign-off. |
| In-game `!` commands out of scope | Noted only where they share locale keys. |

Verification done in this phase (against the worktree at `refactor/w2-a-synth`): DISC-01 (German `wlapp.modalNote` is 53 characters, `de.ts:371`, used as label at `whitelistApplications.ts:277`), DISC-02 (no `deferReply` in `daily.ts`, `persistClaim` at `:162,208,239`), DISC-03 (literal English at `index.ts:471`), DISC-05 (`config.ts` is `withErrorHandling(requireServerAdmin(...))` with no `ephemeral`, default is public per `middleware.ts`), DISC-06 (`requireServerAdmin` throws after the defer, its own doc comment says so), DASH-01 (`App.vue:512-522`), DASH-08 (`relativeTime.ts:41-43`), DASH-11 (`ModsView.vue:800` `window.confirm`), DASH-12 (`ModsView.vue:5` `<h1>`, `ViewHeader.vue:4` `<h2>`), contrast numbers (recomputed). Two small corrections are listed in section 10.

## 2. Executive summary

Biggest risks first.

1. **A whole feature is broken in German.** The whitelist application modal label is 53 characters against Discord's 45 limit, so the apply button fails in every German guild that enables applications (DISC-01). The limit is not tested anywhere, so more of these can exist.
2. **`/config show` is public** and prints API URLs, guild and admin ids and a partial token to the channel (DISC-05). One-line fix.
3. **The dashboard is unusable on a phone.** Below 760px the sidebar becomes a 530px block, tab changes show nothing, Backups and Config scroll sideways, Mods actions are clipped, no control reaches 44px (DASH-01, 09, 10, 12).
4. **Users lose or corrupt data silently.** Mod Config edits vanish on file, server or tab switch; invalid raw JSON leaves without a prompt (DASH-03, 04). `/daily` saves the claim before it replies and never defers, so a slow RCON call shows a failure after the cooldown was spent (DISC-02).
5. **Time is wrong in both products.** `parseStamp` reads UTC stamps as local time, so audit entries read "2 h ago" two minutes after the event on UTC+2 and the rollback dialog prints UTC as local. The same function feeds bot embeds (DASH-08).
6. **Accessibility floor is missed everywhere.** Primary buttons are 2.15:1, focus rings are invisible on PrimeVue buttons, 10 critical unlabeled fields in Config, every one of 11 views fails `color-contrast` (DASH-05, 06, 07).
7. **The Mods tab is the best flow and the worst citizen.** It has the right data flow, states and consequence copy, but is a styling island (50 raw colours, own buttons, `<h1>`, `window.confirm`) and breaks at 360 and 1440 (DASH-12). Copy its behaviour, not its CSS.
8. **Errors and permissions have no shared language.** Discord has two denial shapes (one public), a hard-coded English fallback, "Success" and "Error" as titles, and 14 messages with no next step. The dashboard shows load errors as toasts and then renders a misleading empty state (DISC-03, 06, 12, 13, DASH-13).
9. **Alerts page people for recoveries.** "Server Back Online" and "Disk space recovered" ping the on-call role, TPS re-pings every 5 minutes with no closing message (DISC-09).
10. **Dashboard and Discord disagree on shared concepts and cannot share strings today.** The dashboard has no i18n, Discord is bilingual, and the German text mixes "Server", "Guild", "Gilde" and "Discord-Server". A shared vocabulary needs a decision on dashboard i18n first (section 5).

## 3. Benchmark: the Mods tab

What it does right (details and line refs in Appendix A section e):

| Quality | Evidence | Must spread to |
|---|---|---|
| Long job as first-class state: progress with `role="status"`, failure with `role="alert"`, "check again", stale-result note | `ModsView.vue:77-92,119-130` | Server actions, restore, config apply, `/server` progress embeds |
| Per-row busy lock, other rows stay usable | `ModsView.vue:235,380,388` | Backups (today one global flag disables every row) |
| Distinct empty states per cause (loading, searching, no results, none installed) | `ModsView.vue:186-187,260-262,318-340` | Audit, Backups, Config filter, Discord empty answers (`backup.none` is thrown as an error) |
| Consequence copy at the control ("takes effect on next restart") | `ModsView.vue:354,389-393,781` | Every confirm and toast, Discord success embeds |
| Reload after mutation, count badge on bulk action | `ModsView.vue:15-24` | Commands, Config |
| Capability-gated write controls, read-only explained | `ModConfigView.vue:178` | All write controls on both surfaces |
| Mod Config: stale banner with write note, queued edits, per-field conflict picker, per-snapshot revert, works at 360 | `ModConfigView.vue:3-50,82-110,140-290` | Config and Guild editor via a shared editor shell |
| Uniform feedback: flash after save | Mod Config save | One feedback pattern (section 8) |

Where it is itself flawed (do not copy):

| Flaw | Evidence | Id |
|---|---|---|
| Own palette: 50 raw colours, most views have 0 to 2 | `ModsView.vue:951-1380` | DASH-12 |
| Raw `<button>`, native `<select>`, own pager | `ModsView.vue:11-25,293-307` | DASH-12 |
| `<h1>` while 10 views use `ViewHeader` `<h2>`; Composition API where others use Options API (keep per file, do not convert) | `ModsView.vue:5` | DASH-12 |
| `window.confirm` for Remove, no consequence text | `ModsView.vue:800` | DASH-11 |
| Breaks at 360 (actions clipped) and 1440 (status pill wraps to "up / to / date") | `mods-mobile360-full.png`, `mods-desktop.png` | DASH-12 |
| List load failure is a toast; card stays on "Loading" or "No mods installed" | `ModsView.vue:318-321` | DASH-13 |
| Mod Config discards edits on file switch; label not bound; "Save 1 change(s)"; idle "Saved" is a disabled green button | `useModConfigs.ts:246-251` | DASH-03, DASH-07 |

## 4. Findings by flow and area

### 4.1 Dashboard (full text: Appendix A section c and d)

| Flow | Ids | Severity | One line |
|---|---|---|---|
| Shell and navigation | DASH-01 | blocker (mobile) | 530px sidebar block under 760px |
| | DASH-02 | major | No router, no deep links, refresh loses place |
| | DASH-16, DASH-20, DASH-25 | minor | Two server pickers, persistent bot-down banner, 11 flat nav items with a duplicate icon |
| Config editor | DASH-04 | major | Invalid raw JSON bypasses the dirty guard |
| | DASH-14 | major | 30+ flat fields, raw camelCase keys, no search, errors far from fields, actions scroll away |
| | DASH-15 | major | Secrets are plain text inputs |
| | DASH-07 | major | Labels not tied to inputs (10 axe critical), hint buttons all named "Help" |
| Mod Config | DASH-03 | major | Edits silently discarded on file, server or tab switch |
| Mods | DASH-11, DASH-12, DASH-07, DASH-13 | major | `window.confirm`, styling island, unnamed icon buttons, list error as toast |
| Backups | DASH-09 | major (mobile) | 530px table at 360, Restore and Delete look identical |
| | DASH-21 | minor | Unnamed row actions, no create, no tier filter, restore prerequisites unsaid |
| Servers and actions | DASH-11, DASH-13 | major | Three confirm styles, typed input unfocused, no progress for long actions, Start enabled when online |
| Console | DASH-23 | minor | Log not an accessible log, composer unlabeled, no history or wrap |
| | DASH-13 | major | Toast stack covers the Send button |
| Analytics | DASH-22 | minor | `0d 12h 0m 0s` durations, bare dashes, bold "Unknown" |
| Commands | DASH-13 | minor | Empty state keeps an active Save and four controls |
| Guilds and wizard | DASH-13, DASH-17 | major, minor | Discord 401 reads as "No guilds configured yet", flex on a `<p>` breaks the hint |
| Audit and history | DASH-08 | major | Timestamps off by the UTC offset |
| | DASH-18 | minor | Rollback only inside Audit, history load failure swallowed, no diff |
| Cross-cutting | DASH-05, DASH-06 | major | Invisible focus, primary button 2.15:1, dim text 3.2 to 3.7:1 |
| | DASH-10 | major | No control meets 44px |
| | DASH-19, DASH-24 | minor, polish | Dark only undocumented, 26 em dashes and "change(s)" in UI copy, no i18n |

### 4.2 Discord (full text: Appendix B section d)

| Area | Ids | Severity | One line |
|---|---|---|---|
| Modals and limits | DISC-01 | blocker | German modal label over 45 characters |
| Command lifecycle | DISC-02, DISC-03 | major | `/daily` saves before reply and never defers; dispatcher error hard-coded English; 13 commands unwrapped |
| Permissions and visibility | DISC-05, DISC-06 | major | `/config show` public; admin denial public for 10 commands, two denial shapes |
| | DISC-21 | minor | No guild-only contexts; 30 commands show in DMs |
| Output limits | DISC-04 | major | `/mods` breaks past about 110 mods (6000 char embed total) |
| Alerts and bridge | DISC-09, DISC-10 | major | Recoveries ping the role, TPS repeats; deleted webhook silently drops bridged chat |
| | DISC-17 | minor | Discord to game formatting (truncation, raw emoji and mentions, empty text) |
| Localisation | DISC-07, DISC-08, DISC-15 | major | English fragments in German sentences, wrapper alert grammar, wrong crash-loop recovery step |
| | DISC-23, DISC-24 | minor | No plural support ("(s)" in 36 strings), 120 dashes in locale files |
| Embed language | DISC-12, DISC-13 | major | 14 errors with no next step, "Success" and "Error" as titles |
| | DISC-16, DISC-22, DISC-25 | minor | Error red used for leave, death, stop; status embed always blue; "Requested by" footers, timestamp on everything |
| Destructive actions | DISC-14 | major | `/server stop` and `restart` have no confirmation, public countdown |
| Discovery and structure | DISC-11, DISC-18, DISC-19, DISC-20, DISC-26, DISC-27 | major, minor | `/help` misdescribes the tree, 45 commands with duplicates, bare emoji pagination, autocomplete gaps, option naming, description style |
| Backlog | DISC-28 to DISC-36 | polish | Status script output title, restart message sprawl, daily reply shape, deny reason, docs list in-game commands as slash, raw backup dir names, date styles |

## 5. Consistency between dashboard and Discord

Dashboard has no i18n layer; every string is an English literal. Discord is bilingual (`src/core/locales/{en,de}.ts`, 495 keys each, parity clean). Consequences: a German guild gets a German bot and an English dashboard; any term "shared" today is shared in English only; and German currently has three words for one concept (see Guild below). A shared vocabulary needs one source. The cheapest path is a small table of canonical terms in `@mcbot/core` locale files that both surfaces read (the dashboard through a minimal `t()`), with dashboard i18n scope decided separately (section 9, Q1). Without that decision, define the table in English and fix German in the bot only.

| Concept | Dashboard | Discord EN | Discord DE | Proposed single term or pattern |
|---|---|---|---|---|
| Minecraft server | "Servers", switcher "SERVER", key title-cased ("Dev") | "Server instance" option, "Server Status: x" | "Server" for both Minecraft and Discord server | "Server" for a Minecraft server everywhere; show the raw key, never title-case it. Option text: "Server to use (default: this Discord server's default)" |
| Guild | "Guilds" nav | "Discord server" and "guild" mixed | "Gilde", "Guild", "Discord-Server" | User text: "Discord server" / "Discord-Server". Keep "Guild" only where it names a config key (`guilds.<id>`) |
| Mods | "Mods", "hide client-only mods" | groups "Client + Server", "Optional (client)", "Server-only" | "Nur Server", "Optional (Client)", and "das Mod" in one string | Group names from one table: "Client and server", "Client only (optional)", "Server only". DE: "die Mod" |
| Players | player names, online counts | "players" (hard-coded in places) | "Spieler" | "players" through `t()`; unit passed to `describePlayers` |
| Backups | tiers "Hourly", "Daily", "Archive", "Pre-update", "Manual" | raw dir names ("hourly", "archives/x") | "Backup(s)" | One tier-label function in `@mcbot/schema`, used by both; ages via relative time util |
| Permissions and roles | "Sysadmin", capability gates (`server:read`), guild admin | "admin", "bot admin", "server admin" | "Admin", "Server-Admin" | "Bot admin" / "Bot-Admin" for the `adminUsers` and per-guild admin tier; never "server admin" (reads as the Discord role). Denial text: "This command is for bot admins only. Ask an admin if you need it." |
| Status words | "Online", "Not responding", "Offline", "State unknown" | same four; `/uptime` shows raw "online", "offline", "unknown" and has no "not responding" | "Online", "Antwortet nicht", "Offline", "Zustand unbekannt" | Four states, one table, `/uptime` uses `describeState` |
| State colour and icon | green, red, amber for both not responding and unknown | green, orange, red, grey (unknown grey) | same | Online green, not responding amber, offline red, unknown grey, on both. Colour is never the only signal: text label always present |
| Wrapper down | "API wrapper unreachable. Server controls, logs and stats are unavailable..." | three phrasings | "die API-Wrapper" (wrong gender) in 5 strings | One string table; German "der API-Wrapper" |
| Time, relative | "2 h ago" (wrong offset, DASH-08) | `relativeAge` "3 h ago" inside German text; `<t:ts:R>` in other embeds | English fragment in DE | Fix `parseStamp` first. Bot: Discord timestamps (`<t:ts:R>`) everywhere. Dashboard: relative text with absolute time on hover, one util |
| Time, absolute | `YYYY-MM-DD HH:MM` local | raw stored string, guild-timezone clock, `<t:ts:f>` (three styles, DISC-36) | same | Discord: `<t:ts:f>`. Dashboard: `YYYY-MM-DD HH:MM` in the viewer's zone, with zone shown once in the header |
| Duration and numbers | `0d 12h 0m 0s` (DASH-22) | "5m/3h/2d", "1 min, 5 min" hard-coded, integer hours in polls, `30m` in ban | "Tag(en)", "Minute(n)" | One `formatDuration`: two largest non-zero units ("12 h", "2 d 3 h"), localised units, in `@mcbot/core`. Plural via `Intl.PluralRules`, no "(s)" |
| Empty state wording | "No mods installed.", "Command manifest not written yet" | "No backups found." thrown as an error | "Keine Backups gefunden." | Pattern: what is empty + why + next step ("No backups yet. An admin can create one with /server backup."). Empty is an info state, never red |
| Error wording | toast "Failed to load guilds" then empty state | "Server not found.", "Failed to retrieve stats." | same, unlocalised fallback | Pattern: problem, cause if known, recovery ("Could not load the stats. Try again in a moment.") |
| Audit | "Audit Log" | "audit log" in `/kick`, `/ban` option text | "Audit-Log" | "Bot audit log", to avoid Discord's own Audit Log |
| Feature names | "Notifications", "Chat Bridge", "Leaderboard", "Status Embed", "Downtime Alerts", "TPS Alerts" | `/config show` prints raw keys (`chatBridge`, `tpsAlerts`) | partly localised | Render the dashboard names, from the same table |
| Command groups | grouped by source folder; "connection" means link and daily | `/help` has no groups | none | Rename groups for users ("Account", "Stats", "Server", "Admin"), use them in `/help` and the dashboard Commands view |
| Channel | n/a | "channel" | "Channel" and "Kanal" mixed | DE "Kanal" (matches Discord's German UI) |
| Waypoint | n/a | "Waypoint" | "Waypoint" and "Wegpunkt" | "Waypoint" |

## 6. Unified ranked issue list (top 30)

Ranking weighs: data loss or security first, then blockers, then breadth of users hit, then cost. "Layer" is where the fix is made once. "Needs first" names what must land before it can be done properly (empty means independent).

| # | Id | Sev | Effort | Who is affected | Layer | Needs first |
|---|---|---|---|---|---|---|
| 1 | DISC-01 | blocker | S | German guilds with applications, all applicants | locale, modal | none |
| 2 | DISC-05 | major (security) | S | everyone in the channel; leaks infra details | command (ephemeral) | none |
| 3 | DASH-01 | blocker (mobile) | M | every phone user | view (App shell) | interim fix is independent; final nav model waits on direction (section 8) |
| 4 | DASH-08 | major | S | all admins, all non-UTC zones, bot embeds | core util | none |
| 5 | DASH-03 | major | S | mod config editors | composable | none |
| 6 | DASH-04 | major | S | config editors | composable | none |
| 7 | DISC-02 | major | S | `/daily` users with slow RCON | command | none |
| 8 | DISC-03 | major | S (dispatcher) then M (13 commands) | all users, German guilds, multi-server guilds | dispatcher, middleware, locale | none for dispatcher; `replyError` helper for the 13 |
| 9 | DASH-05, DASH-06 | major | S | keyboard, low-vision, everyone (primary buttons) | design tokens, PrimeVue preset | none for the floor values; accent hue waits on direction but must keep ratios |
| 10 | DISC-06 | major | M | non-admins who try admin commands, channel noise | middleware, embed builder | error format (section 8) |
| 11 | DISC-09 | major | S | on-call role members | alert callers | none |
| 12 | DISC-04 | major | M | modpack servers | embed builder (`paginateFields`) | none |
| 13 | DASH-07 | major | M | screen reader and keyboard users, Config | base component (`FieldShell`) | tokens for error colour |
| 14 | DASH-09 | major (mobile) | M | phone users in Backups, Config | base component (`ResponsiveTable`, `ViewHeader` wrap) | breakpoint token, DASH-01 |
| 15 | DISC-14 | major | M | everyone online on a server | embed builder (`createConfirmRow`, `createProgressEmbed`) | confirm pattern (section 8) |
| 16 | DASH-11 | major | M | admins using destructive actions | composable (`useConfirmAction`) | confirm pattern |
| 17 | DASH-13 | major | M | admins, any load failure | base component (`InlineError`, `ActionJob`), toast position | feedback pattern |
| 18 | DISC-12, DISC-13 | major | S then M | all users | embed builder, locale | one change; error format |
| 19 | DASH-10 | major | M | touch users | design tokens (size under `pointer: coarse`) | tokens |
| 20 | DISC-07, DISC-08 | major | S | German guilds | locale, `requireCapability`, `describePlayers` | none |
| 21 | DISC-15 | major | S | German admins reading alerts | locale | none |
| 22 | DASH-15 | major | S | anyone entering a token | base component (schema field renderer), schema `format: password` | none |
| 23 | DASH-02 | major | M | everyone sharing or refreshing | view (App router) | nav model |
| 24 | DISC-10 | major | S | bridged channels | bridge | none |
| 25 | DASH-12 | major | L | Mods users on phones and small desktops | view migration | tokens, `AppButton`, confirm, DASH-09 components |
| 26 | DASH-14 | major | L | Config editors | base component (`EditorShell`), schema titles | `FieldShell`, tokens |
| 27 | DISC-11, DISC-19 | major, minor | M | all users discovering commands | embed builder (`buildHelpEmbeds`, pagination) | embed language |
| 28 | DISC-16, DISC-22, DISC-25 | minor | S | channel readers | embed builder, `EmbedColor` | colour semantics (section 8) |
| 29 | DISC-18 (with DISC-26, DISC-27) | minor | L | all users | command definitions | owner decision (section 9, Q3), alias window |
| 30 | DASH-24, DISC-24, DISC-23 | polish, minor | S to M | all | copy pass, locale, `t()` plurals | dashboard i18n decision (Q1) for the dashboard half |

Further items (not in the top 30, still real): DASH-16, DASH-17, DASH-18, DASH-19, DASH-20, DASH-21, DASH-22, DASH-23, DASH-25, DISC-17, DISC-20, DISC-21, DISC-28 to DISC-36. Their order is in the appendices.

## 7. Hotfix candidates

Independent of any visual direction unless marked. Each is small, testable and safe to ship before the redesign. Every change that is user visible also needs a `CHANGELOG.md` entry under `[Unreleased]` and, for the i18n ones, `npm run i18n:check`.

| Id | Direction independent | Exact fix | Files | Test | Risk |
|---|---|---|---|---|---|
| DISC-01 | yes | Change `wlapp.modalNote` (DE) to "Hinweis für die Admins (optional)" (33 chars). Then audit the 13 `setLabel` call sites (plus modal titles) in `src/bot` for the same limit (labels and modal titles 45, button labels 80, select options 100). | `src/core/locales/de.ts:371`, `src/bot/interactions/whitelistApplications.ts:277` | New locale test: for every key used as a modal label or title, assert length at most 45 in en and de. Plus a test that builds the application modal under `de` and calls `toJSON()` without throwing. | Very low. Text only. |
| DISC-05 | yes | Pass `{ ephemeral: true }` as the second argument of `withErrorHandling` for `/config`. This also makes `/config reload` replies ephemeral, which is acceptable. | `src/bot/commands/admin/config.ts` (the `execute` export) | Extend the existing config command test: `deferReply` is called with the ephemeral flag. | Low. Admins lose the public reload confirmation. Changelog under Security. |
| DASH-08 | yes | In `parseStamp`, for the space-separated stamp form (`YYYY-MM-DD HH:MM...`), parse as UTC: build the ISO string and append `Z` when it has no zone suffix. Verified writers: `formatDatetime()` defaults to UTC and no call in `src` passes another zone (`adminAudit.ts:95`, `configHistory.ts:54`, `whitelistAudit.ts:104,132`, `note.ts:159`, `dailyAdmin.ts:199`, `logger.ts:27`). | `src/core/utils/relativeTime.ts:41-43` | In `tests/core/relativeTime.test.ts` assert `parseStamp("2026-08-08 11:37:34").getTime() === Date.UTC(2026,7,8,11,37,34)`, which holds in any process zone; add a `relativeAge` case run under `TZ=Europe/Berlin` and `TZ=America/New_York`. | Low. Stamps with an explicit zone and numeric values are untouched. Side effect is the intended one: bot `mods.footerStale` and dashboard times change. Changelog under Fixed. |
| DASH-01 | partly (interim) | Under 760px keep the sidebar compact: brand row plus a menu button that toggles the nav list (default closed), nav list overlays instead of pushing content, and scroll `.content` to top on tab change. The final top bar and Drawer design waits on direction. | `src/web/frontend/src/App.vue:512-522` and the template | Component test that the nav is collapsed under the breakpoint and tab change calls scroll reset; manual check at 360 and 430 via `dev-up.mjs --only web`. | Low to medium. Layout only, no state change. |
| DASH-03 | yes | Register the pending-edits state with `registerDirtySource` in `useModConfigs`, and route file select, server select and tab change through `confirmLeave`. | `src/web/frontend/src/composables/useModConfigs.ts:246-251,167`, `ModConfigView.vue`, `useUnsavedGuard.ts` | Composable test: set a value, call `openFile`, expect the guard to ask; discard then proceeds. | Low. Adds a dialog where edits were silently lost. |
| DASH-04 | yes | Treat `rawText !== baselineText` as dirty, enable Discard and register with the guard. | `src/web/frontend/src/composables/useConfig.ts:135-141`, `useEditableDocument.ts:126-133`, `ConfigView.vue:19-26` | Composable test: invalid raw text makes `dirty` true and Discard enabled; leaving prompts. | Low. |
| DISC-02 | yes | Keep the cheap pre-checks (link, cooldown) as they are, then `deferReply` immediately before `getOnlinePlayers` (about `:131`), and change every later `reply` in `_execute` to `editReply`. The claim is still saved before the reply, but a slow RCON call no longer expires the interaction. Embed result shape (DISC-30) is a later change. | `src/bot/commands/connection/daily/daily.ts` | Unit test with a mocked interaction and a slow `getOnlinePlayers`: `deferReply` is called before it, the result goes through `editReply`, no second `reply`. | Medium. Touches the reward path, so keep the claim lock and cover the queue-full and error branches in the test. |
| DISC-03 | yes (dispatcher part) | In the dispatcher catch use `t("common.unexpectedError", {}, guildId)` instead of the literal and a recovery sentence in that key (both locales). Wrapping the 13 raw commands in `withErrorHandling` is a separate M change. | `src/bot/index.ts:468-481`, `src/core/locales/{en,de}.ts` | Extract the reply builder to a small function and unit test en and de output; `i18n:check`. | Low. |
| DASH-05, DASH-06 | floor values yes; accent hue depends on direction | `contrastColor` to `var(--mc-on-accent)` (`#06210f`, 7.6:1 on `#34c56a`, today `#eafff0` is 2.15:1). Lift `--mc-dim` from `#6b7280` to about `#8f96a1` (5.16:1 on `--mc-card` `#22252a`, 6.0:1 on `--mc-bg`; today 3.18 and 3.71). Add a PrimeVue `focusRing` preset (2px accent, 2px offset) and a global `:focus-visible` rule, plus a skip-to-content link. | `src/web/frontend/src/main.ts:51`, `src/web/frontend/src/style.css:13,27`, `index.html` or `App.vue` for the skip link | Re-run axe on all views (target: no `color-contrast` on these pairs, focus visible in a Tab walk screenshot). A vitest check that `main.ts` no longer contains the literal `#eafff0`. | Low. Visual change only, any later direction must keep these ratios, not these hexes. |

Not hotfixes although tempting: DISC-06 (needs the error format and a pre-defer guard, M), DISC-09 (small, but changes who gets paged, wants the owner's OK on the policy), DISC-15 (German grammar rewrite, wants a native read), DASH-15 (small, but needs the schema `format: password` change and a check of secret round-trip so a masked `•••••` is not saved back as the value).

## 8. Design requirements every direction must satisfy

Constraint that frames all of them: the frontend keeps its existing Vue paradigm per file (Options API stays Options, Composition stays Composition) and PrimeVue stays the component base. A direction restyles through the preset, tokens and shared components. It does not rewrite views into a new paradigm.

**8.1 States matrix.** Every data-backed flow documents and renders these states. A flow without a row is not done.

| State | Requirement |
|---|---|
| Loading | Explicit text or skeleton, never an empty panel |
| Empty | Says why it is empty and the next step; distinct from error |
| Error | Inline with problem, cause, retry; never toast-only |
| Partial or stale | Banner with a write-specific note (as `StaleBanner`) |
| Busy | Per-row or per-action lock, other rows usable |
| Success | One feedback pattern (below) |
| Read-only or no permission | Controls hidden or disabled with a reason |
| Conflict or dirty | Guard on leave, per-field marker, recovery actions |
| Long content, one item, 500 items | Wraps, paginates or truncates with access to the full value |

**8.2 Accessibility floor.**

| Item | Floor |
|---|---|
| Contrast | Text 4.5:1, large text and controls 3:1, focus indicator 3:1 against both adjacent colours; checked on computed values with axe on every view |
| Focus | Visible ring on every interactive element including PrimeVue buttons and nav, skip link, logical tab order |
| Targets | 44px minimum under `pointer: coarse`, tap-area padding on icon buttons |
| Labels | Every control has a programmatically bound label (`FieldShell` generates id, `label for`, `aria-describedby`); icon buttons have `aria-label` naming target ("Delete backup-2026-08-08"); hint buttons "Help for <name>" |
| Keyboard | Everything operable, dialogs trap and restore focus, typed-confirm input autofocused, Esc closes |
| Semantics | One `h1` per view, landmarks unique, log pane `role="log"` with `tabindex` and label, `aria-live` for toasts and job status |
| Colour | Never the only signal for state |

**8.3 Mobile floor 360 to 430.** No horizontal page scroll; tables become card lists under one breakpoint (760); header actions wrap; nav behind a top bar and drawer (or equivalent); toasts never cover primary controls; tested at 360, 430, 760, 1440 with real copy and 500-item lists.

**8.4 Token set.** Defined in `style.css` and the PrimeVue preset, with a lint rule banning raw hex in `.vue` files.

| Group | Required tokens |
|---|---|
| Colour roles | background, surface, surface-raised, border, text, text-dim (meets 4.5:1 on surface), accent, on-accent, focus, link |
| Status | online, not-responding, offline, unknown, info, success, warning, danger, each with a foreground that passes 4.5:1 on its tint |
| Spacing | `--mc-space-1..6` on a 4px base |
| Type | `--mc-text-xs..lg` plus heading sizes; body at least 14px on dense admin tables, 16px for inputs (prevents iOS zoom) |
| Radius, elevation | two radii, three elevations, z-index scale for toast and dialog |
| Breakpoint | one token (760), plus a wide breakpoint (1100 to 1280) for two-column layouts |
| Size | control height 32/40 pointer fine, 44 coarse |

**8.5 One confirm pattern.** One composable (`useConfirmAction({level, target, consequence, recovery})`) with three levels: inform (single click, toast), disruptive (confirm dialog, Stop, Restart, Disable), irreversible (typed confirm, Restore, Delete, Rollback). Every dialog names the target, the consequence, when it applies and how to recover. Native `window.confirm` is banned. The Discord counterpart is one confirm button row with expiry (DISC-14).

**8.6 One feedback pattern.**

| Situation | Pattern |
|---|---|
| Load failed | Inline `InlineError` (problem, cause, Retry) in the place the data would be |
| Action succeeded | Toast, top-right desktop and top-center mobile, 3 to 5 s, says what happened and when it applies; plus inline saved check for editors |
| Action failed | Inline near the control if recoverable there, else toast with a recovery sentence |
| Long-running | Job state in the card (running, finished, failed with log tail), not a spinner and "Done" |
| System condition (bot down, stale data) | One compact status bar, with link to the health view |
| Navigation away | Cleared view-specific toasts |

**8.7 Navigation model.** Hash router with deep links (`#/mods/<server>`, `#/modconfig/<server>/<fileId>`), Back works, refresh keeps place, `confirmLeave` on route change, one server selector (sidebar or header chip, not per view), nav grouped Monitor, Manage, Admin with distinct icons.

**8.8 Dashboard i18n story.** Decide first (Q1). Whichever answer, new strings go through a `t()` seam so a locale file can be added later, no sentence is built by concatenation, no "(s)" plurals, and the shared vocabulary table of section 5 is the single source. Document "dark only" in `docs/dev` or add light tokens (DASH-19).

**8.9 Discord embed language.**

| Topic | Rule |
|---|---|
| Colour semantics | Green success, red failure only, amber warning or degraded, blue info and neutral answers, grey unknown or events with no judgement, one accent for celebration (milestone, challenge). Leave, death and "Server Stopped" are events, not errors |
| Titles | Action or object ("Player banned", "Whitelist updated", "Could not ban player"). Generic "Success", "Error", "Info" only as fallback. Sentence case in both languages |
| Emoji | One leading emoji for status state only (state table), none decorative in titles; no emoji standing in for labels on buttons without text |
| Footers | Server id only when more than one server and not already in the title; one page format `Page n/m` via `pageFooter`; no "Requested by", no echo of the title, no raw server text |
| Timestamp | Off by default; on only for live data (status, alerts) |
| Time in text | Discord timestamps (`<t:ts:R>`, `<t:ts:f>`) |
| Ephemeral and public | Ephemeral: personal data, admin lookups, config, all errors and denials, confirmations. Public: results meant for the channel (status, stats, leaderboard, moderation outcomes). Admin check happens before the defer so denial is ephemeral |
| Error format | Problem plus recovery, one or two sentences, optional `hint` line. Never a config path or internal id to a non-admin |
| Mention policy | Role ping only on first failure and on severity increase; recoveries and repeats never ping; `allowedMentions` explicit on every bridge and alert message |
| Limits | Every builder that takes variable content guards 6000 total, 4096 description, 1024 field, 256 title, 45 modal label; a locale test enforces the static ones in both languages |
| Pagination | Page indicator on the row, buttons disabled (not removed) after 3 minutes on public and ephemeral replies |
| Language | du-form in German, "bot admin" terminology, glossary of section 5 |

## 9. Out of scope and open questions for the owner

| # | Question or out-of-scope item | Recommendation |
|---|---|---|
| Q1 | Does the dashboard get i18n (English and German), or stay English only? | Add a `t()` seam now with English only content and move strings gradually; commit to German only when the shared glossary exists. The cost of the seam is small, retrofitting later is not. |
| Q2 | Light theme or document dark only? | Document dark only for this wave (DASH-19), keep tokens role-based so a light set can be added later. |
| Q3 | Consolidate 45 slash commands into about 24 (DISC-18)? Renames break muscle memory and `commandPolicy` keys. | Not in this wave. Do the non-breaking parts first (`/help` categories, descriptions, deprecation notes), then a separate migration with an alias window. |
| Q4 | Hide admin commands in the picker via `setDefaultMemberPermissions`? | No. It would also hide them from config-listed admins who lack the Discord permission. Keep runtime check as authority, add `[Admin]` description prefix and guild-only contexts. |
| Q5 | Should the Discord and dashboard share one status and glossary source in `@mcbot/schema`? | Yes for state labels, tier labels, feature names, duration formatting. Contract-isolated, no cross-workspace imports needed. |
| Q6 | Role ping policy (DISC-09): ping on first failure and severity increase only? | Yes, plus a recovery message without ping and outage duration. Needs owner OK because it changes who is woken. |
| Q7 | Default for the chat bridge: webhook instead of one embed per line (DISC-10 area)? | Yes, with a plain-line fallback, not an embed. Behaviour change, so changelog and docs. |
| Q8 | Join and leave events on by default (loudest channel with 20 players)? | Keep, but offer a compact one-line form and merge bursts within 60 s. Do not change defaults silently. |
| Q9 | Real-device and screen reader verification | Out of scope here. Schedule a phone pass and one NVDA pass after the first build of phase B. |
| Q10 | Live Discord rendering check (embed width on mobile, button wrapping, webhook username limits) | Out of scope. Run once with a throwaway test guild before finalising embed layout. |
| Q11 | Commands editor body, guild editor, wizard steps 2 and 3, real mod install and server action running states | Out of scope. Needs the bot plus a Discord token and a Linux host; audit them in phase B with a real setup. |
| Q12 | In-game `!` commands and the German-only sleep prompt (DISC-35) | Out of scope for UX synthesis; track as a separate localisation item. |

## 10. Notes on the verification pass

| Item | Source audit said | Verified result |
|---|---|---|
| DASH-08 cause | SQLite UTC timestamps | The bot writes the space-form stamps itself through `formatDatetime()` (default zone UTC, no caller overrides it), not SQLite `CURRENT_TIMESTAMP`. The conclusion and fix stand; only the cause is reworded. |
| On-accent contrast | about 8:1 | 7.58:1 on `#34c56a`. Primary button today is 2.15:1 (audit said 2.14). Dim text on card is 3.18:1 (audit said 3.17). Rounding only. |
| Everything else repeated here | | Matches the code at the cited lines. DISC-06 per-command counts and DISC-04 the 111-mod threshold are taken from Appendix B and were not re-derived. |

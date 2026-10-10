# Direction 4: Hybrid

Mockups: open `index.html` (or `preview.html` for 1440 and phone frames side by side, with a state picker per screen). Static HTML and CSS with a little vanilla JS for the state picker, drawer, dialogs, tabs and filters. Sample data throughout. Fonts are the system stack, nothing is downloaded. Built by copying Evolve's pages and stylesheet, then changing them on purpose; every difference from the parents is listed in the decision table. Revision 2 (owner feedback: use the whole content area, bring back the mod images, prefer Polish's Backups view) changed the page width, the Mods page and the Backups page, and added three decision rows, a width measurement, a list of differences from the Polish Backups mockup, and the effort numbers below.

## Direction contract

- **THESIS.** The same app, on a system. Keep today's charcoal and green so existing admins see the same product, and give every screen Evolve's complete token roles, shaped status chips and shared components so it finally speaks one language. The first phases deliver the audit's must-fixes on that foundation, the later phases extend the same foundation, nothing is thrown away. Distinctive axes (operate mode, two at most): the shaped status system shared 1:1 with Discord, and density. Everything else is conventional on purpose.
- **WORLD.** Surfaces `#15171a` to `#2a2e34`, one green accent `#34c56a` with dark text on it, system fonts, 7 and 10 px radii, hairline borders, status chips with distinct shapes, flat, dark only. The content fills the area beside the sidebar and spends extra width on columns, not on longer lines.
- **STORY.** An admin opens a screen and sees what is wrong, unsaved, busy or applied, acts on one row without losing the others, and never reads a claim the system cannot back up.
- **FIRST VIEWPORT.** Sidebar (drawer under 760 px) with one server picker, h1 with a one-line purpose and the primary action, one status strip with the live state and the save controls, then filter and work area.
- **RISK.** A hybrid can inherit both parents' weaknesses: Polish's generic look and Evolve's wide migration. The answer is the phase plan: every phase ships alone and has a clean stop.

## Decision table

Where Polish and Evolve disagree, this is what Hybrid takes and why.

| Topic | Polish does | Evolve does | Hybrid takes | Why |
|---|---|---|---|---|
| Accent and overall look | Keeps today's charcoal and green, only fixes dim text and on-accent | Cool graphite and teal `#3cc8b4`, a new look | Polish: charcoal `#15171a` to `#2a2e34`, green `#34c56a` | Existing admins must see "the same app, correct". A new hue buys nothing an operator needs and costs recognition. |
| Type | System faces, 15 px body | IBM Plex Sans and Mono as local woff2, 14 px anchor | Polish: system faces, Evolve's scale names (`--text-xs` to `--text-3xl`) and the mono key line | Plex adds about 110 KB, a licence file and a FOUT decision for a cosmetic gain. The scale and the mono key line are what make Evolve's fields scannable, and they work in system fonts. Keys use the system mono. |
| Token architecture | One flat file of role tokens | Complete role system: surface roles, status roles, density, control sizes, z scale, motion tokens | Evolve's architecture with Polish's values | Components read role names only, so a light value set can be added later by changing `tokens.css`. `--surface-nav` was added so the sidebar keeps today's slightly different shade. |
| Status system | Four status colours plus info, text label always | Seven roles with distinct shapes (circle, diamond, ring, dash, dashed ring, check), same colours as Discord | Evolve's shapes and seven roles | Shape plus label survives colour blindness and greyscale screenshots, and one table drives dashboard and embeds. Cheap: it is CSS on one component. |
| State-edge motion | Colour fades and one drawer slide only | One signature motion: the sweeping state edge, a flash on resolve, a ring on the chip | Cut the motion, keep a static 3 px edge in the status colour for dirty, pending, running and failed | The sweep and flash are the part PrimeVue cannot express and the part reviewers would debate. The static edge carries the same information in any theme and under reduced motion. Moving things stay limited to spinners, progress and one 180 ms entrance. |
| Themes | Dark only, light "documented" | Dark and light first class, auto by default | Dark first and only in the first seven phases. Light is an optional late phase (3 to 4 days) | Light doubles contrast checks and screenshot work and no audit finding needs it except DASH-19. The role tokens make it a value swap later, so nothing is blocked. |
| Density | Not offered, 36 px controls, 44 px on touch | Comfortable and compact, stored per browser | Evolve's toggle | Three variables, one switch, already proven in Backups and Mods rows. It is the second distinctive axis and costs under a day. |
| Base components | Ten, lighter: `FieldShell`, `EditorShell`, `InlineError`, `ConfirmDialog`, `ActionJob`, `ResponsiveTable`, `StatusBadge` and others | Ten plus five composables: `SectionCard`, `FieldRow`, `StatusChip`, `InlineError`, `InlineBanner`, `ResponsiveTable`, `JobBlock`, `EditBar`, `useConfirmAction`, `useRowBusy`, `useDensity`, `useTheme` | `StatusChip`, `FieldRow` (wraps `FieldShell`), `InlineError`, `InlineBanner`, `ResponsiveTable`, `JobBlock`, `EditorShell` with `EditBar`, `AppShell`, and `useConfirmAction`, `useRowBusy`, `useDensity` | No `SectionCard` (a card is one CSS class, a wrapper adds nothing) and no `useTheme` (no theme switch). `JobBlock` is Evolve's name with Polish's lighter contract: title, status, bar, optional output, no step list. |
| Navigation and routing | Hash router, `vue-router`, deep links including filters, drawer on phones | Hash router, drawer on phones, route owns the server | Same in both, taken with `vue-router` (hash history) | They agree. Grouping follows Polish: Monitor (Overview, Analytics, Console, Audit log), Manage (Servers, Backups, Mods, Mod config), Admin (Config, Commands, Guilds). Audit log is read-only monitoring, Servers is control. |
| Mobile navigation | Top bar plus drawer | Top bar plus drawer (rejected a bottom tab bar) | Top bar plus drawer | Eleven destinations do not fit a tab bar. Checked only at the layout level, not on a real phone. |
| Config editor structure | Search, table of contents, groups, sticky action bar, "Review changes" | Group list left, filter, `FieldRow` with mono key line, dirty edge, old value, docked edit bar on phones, review dialog | Evolve's two-pane layout with Polish's save semantics | The group list is Polish's table of contents made persistent. Consequence lines ("Alerts will fire earlier") are shown only for fields whose schema carries an `effect` text, not for all 30 plus fields, so the content cost is optional per field. |
| Apply status | "Applied, pending, bot down" chip, "reloaded" signal assumed | Applied, pending, restart pending, bot down, with a dashboard restart button | The five states the backend already reports (`applied`, `pending`, `bot-down`, `restart-required`, `unknown`) | `ConfigApplyState` and `GET /api/config/status` exist (`src/schema/configStatus.ts`, `src/web/backend/routes/config.ts`). `restart-required` means a server connection setting, so the Restart tag sits on `servers.*.apiUrl` and `apiKey`, not on `webui.port`. The invented "Restart dashboard" button is dropped. |
| Mods tab (the benchmark) | Keeps two cards, installed first, blockers filter includes Unknown | Same cards on shared tokens, per-row busy, check with job steps and log | Installed first, check card on top, results with a Blockers filter that includes Unknown, per-row busy | Mods joins the shared tokens and base components without changing its flow. The check shows exactly what the compatibility job returns (progress done of total, partial results, summary, error string), so no steps, no log, no ETA and no Cancel are drawn. |
| Meaning of Unknown | Amber with a question mark in the update check, counted as a blocker | Grey dash, "could not be matched" | Amber diamond labelled Unknown in the check, grey dash for a server whose state is unknown | In an upgrade decision an unknown result means "do not upgrade yet", so it needs attention. The rule is stated once: unknown is grey when nothing can be done about it, amber when it blocks a decision. This is the one exception in the status system. |
| Confirm and feedback | Three levels, no `window.confirm`, inline error with retry, toasts that name what and when | Same three levels, `useConfirmAction`, job block for long work | Evolve's `useConfirmAction` and `JobBlock`, Polish's copy rule: target, when it applies, how to undo | The dialogs only claim what the code does. The restore dialog says there is no undo, because the restore script takes no safety copy. |
| Backups restore flow | Safety copy first, job steps, "Start smp" assumed | Stop smp, safety backup, steps, progress, log | The flow of the real restore script: the server must already be stopped (it exits 3 otherwise), one blocking call, exit code and output tail | See backend assumptions. The dialog shows a blocked variant when smp is online and a typed-name variant when it is stopped. |
| Discord embed language | Light-touch: keep the bot's old hues, change meaning, titles, footers | Full shared colour map, one leading emoji, footer empty, pager row, confirm row | Evolve's map and rules, on Polish's recognisable hues | Colours are the dashboard's status foregrounds, close to today's green, red, amber and blue, so members see no surprise. Pending violet is the one new hue. The teal celebration colour is dropped (accent is green, success is green), so there are seven colours, not eight. |
| Discord footers | `Page n/m` through `pageFooter`, timestamp on live data | Footer empty, `Page n/m` as a disabled pager button | Evolve | Footers stay free for a real id (Application 41) and the pager row survives message edits and expiry. |
| Dashboard i18n | `t()` seam now, English only, glossary in `@mcbot/schema`, German later | Same | Same, seam in the shell phase | They agree. Glossary and status table live in `@mcbot/schema` so the bot and dashboard read one source. |
| Content width and density | `.content` is `width:100%` up to 1440 px, 24 px side padding, left aligned, two columns on Mods | `.page` capped at 1180 px and centred | Fluid: the page fills the area beside the sidebar up to a 2400 px ceiling (above 2560 minus the sidebar), 24 px side padding. Extra width becomes columns: Config groups flow in 1, 2 (from 1800 px) and 3 (from 2400 px) columns, Mods is list plus check summary plus catalog (2 columns from 1280 px, 3 from 1900 px), Backups is list plus latest-per-type (2 columns from 1360 px) | The owner liked Hybrid but saw unused space on wide screens. Polish only fills to 1440 and leaves the rest of a 1920 screen empty, so matching Polish exactly would still waste space. Measured numbers are in "Content width, measured". Text blocks keep their `ch` limits (lede 64ch, help 56ch, empty states 62ch), so wide screens get more columns, never longer lines. |
| Mod images | Initials tile on every row, search hits show Modrinth icons | None in the mockup | Image per mod wherever a mod is listed: installed rows, check progress and result rows, Modrinth catalog (the only place the real app shows icons today), version picker, remove dialog, loading skeleton, plus an initials tile on a stable tint when there is no icon or it fails to load | The real view shows `iconUrl` only for search hits, proxied through `/api/servers/:id/mods/icon` (raster only, 1 MB cap, Modrinth CDN only). Installed mods carry no icon data today, so icons on installed and check rows are new backend work, listed in the effort table. |
| Backups screen source | Own list view with summary tiles, type chips, Restore plus delete icon, typed confirms, job card with steps | Own flow with job steps and safety backup | Polish's view as the base (same layout, information order, filter, row actions, typed confirms, states), restyled with Hybrid tokens, chips and dialogs, and corrected where it showed something the code cannot do | The owner prefers it. Twelve differences, each listed under "Differences from the Polish backups mockup". |
| Backend assumptions | Pre-restore safety copy, job steps, "reloaded" signal, per-field conflict data | Wrapper job step reporting, restart button, reachability probe, `backup:write` capability | Fewer: see the next section | Every assumption the hybrid keeps was checked against code in this branch or in the setup suite. |

## Backend assumptions, checked

Verified in this repository and in `minecraft-server-setup` while building the mockups:

| Assumption | Verdict |
|---|---|
| Apply states (applied, pending, bot down, restart required, unknown) | Exist: `src/schema/configStatus.ts`, `GET /api/config/status`. Hybrid needs nothing new. |
| Update check shape | Exists: `ModCompatJob` has `state`, `progress {done,total}`, `partial`, `summary`, `complete`, `error`. Hybrid needs nothing new. The existing view already has the check and a blockers filter. |
| Backup list: tier, size, time, cursor paging, stale flag | Exist: `BackupFileInfo`, `nextCursor`, `stale`. The mockup uses "Load more", not page numbers. |
| Create backup | Exists as the `backup` server action (`SERVER_OPERATOR_ACTIONS`). It returns when the script ends, so there is no progress to show. |
| Restore | One blocking call with a 10 minute timeout that returns `{ ok, exitCode, output, stderr }` (last 4000 characters). `restore.sh` refuses to run while the server is online (exit 3) and does not stop it. It unpacks next to the server folder and swaps on success. It takes no safety copy. The mockup is built on exactly this. |
| Capability names | `backup:create`, `backup:restore`, `backup:delete`, `bot:config` (sysadmin only). Evolve's `backup:write` does not exist. |
| 30 second shutdown warning on `/server stop` | Real: `shutdown.sh` announces 30 seconds, counts down, saves, stops. |
| Mod icons | Search hits carry `iconUrl`, proxied by `GET /api/servers/:id/mods/icon` (`src/web/backend/iconProxy.ts`: raster types only, 1 MB cap, 8 s timeout, 24 h cache of 200 entries, Modrinth CDN only). `InstalledMod` has only `slug`, `filename`, `enabled`, `versionId`, so icons for installed rows and check rows need a lookup by project and the same proxy. New work, about 1 day. |
| Backup list fields | `BackupFileInfo` is `id`, `mtimeMs`, `name`, `sizeBytes`, `tier`. No note, no author. `BackupSummary.dirs` gives count, latest file, latest time and size per folder, which is what the "Latest per type" card shows. |
| Reachable chip with latency | Not verified, dropped. Server rows show the existing online or offline state. |
| Update progress per mod ("3 of 4 steps") | Not verified, dropped. |
| Still needed and unverified | A free-space figure and a "needs N GB" prerequisite (the summary only has total bytes), a bot restart control in the dashboard (the config banner only says what to do), and per-field `effect` and `reload` metadata in the schema, which is new content in `@mcbot/schema` and optional per field. |

## Design system in brief

Source of truth: `tokens.css`. Components read role names only.

### Colour roles

| Role | Token | Value | Notes |
|---|---|---|---|
| Page | `--bg` | `#15171a` | |
| Nav | `--surface-nav` | `#191b1f` | Sidebar, top bar |
| Surface | `--surface` | `#22252a` | Cards, dialogs |
| Raised | `--surface-raised` | `#2a2e34` | Table header, hover, chips at rest |
| Border | `--border` | `#2f343b` | Decoration only |
| Control border | `--border-strong` | `#6f7885` | 3.4:1 on surface, 4.0:1 on bg |
| Text | `--text` | `#e7e9ec` | 12.6:1 on surface |
| Dim text | `--text-dim` | `#9aa1ac` | 5.9:1 on surface, 5.2:1 on raised (today 3.2:1) |
| Accent | `--accent` | `#34c56a` | 6.8:1 on surface, primary action and selection |
| On accent | `--on-accent` | `#06210f` | 7.6:1 on accent (today 2.15:1) |
| Focus | `--focus` | `#8cc8ff` | 2 px ring, 2 px offset. Blue so it stays visible next to green |
| Link | `--link` | accent | |
| Danger | `--danger-solid`, `--on-danger` | `#e05858`, `#1d0707` | 5.3:1 |

### Status roles (the system)

Foreground on its tint is 4.7:1 or better (computed). The shape carries the state as well as the colour.

| Status | Meaning | Shape | Foreground | Tint | Discord colour |
|---|---|---|---|---|---|
| online | running, answering | filled circle | `#4ade80` | `#263933` | `0x4ADE80` |
| degraded | not responding, warning, needs a look | diamond | `#fbbf24` | `#3a3629` | `0xFBBF24` |
| offline | stopped, failed, denied | ring | `#f87171` | `#3a2d32` | `0xF87171` |
| unknown | no data, plain event | dash | `#9aa1ac` | `#2f3338` | `0x9AA1AC` |
| pending | not finished, waiting for you or the bot | dashed ring | `#b7a1ff` | `#323341` | `0xB7A1FF` |
| applied | done and live (same hue as online) | check | `#4ade80` | `#263933` | `0x4ADE80` |
| info | running job, neutral answer | circle, spins when busy | `#7cb4ff` | `#2c3541` | `0x7CB4FF` |

### Type, space, shape

| Group | Values |
|---|---|
| Type | System UI stack and system mono. 12 (chip labels, table headers, key lines), 14 (help, table cells), 15 body, 16 (inputs on touch), 18 (card titles), 24 (h1), 30 (readouts). Tabular numerals on. |
| Spacing | 4, 8, 12, 16, 24, 32, 48 (`--space-1..7`) |
| Radius | 7 (controls, chips), 10 (cards, dialogs) |
| Elevation | Separation by border, never shadow. One overlay shadow for dialog, toast, drawer |
| Z scale | sticky 10, nav 30, dialog 50, toast 60 |
| Density | Comfortable: control 36, row padding 10. Compact: 30 and 5. Under 760 px or coarse pointer: 44 either way |
| Breakpoints | 760 (nav, tables to cards, edit bar docks bottom), 1100 (group list becomes a select) |
| Motion | 120 ms colour changes, one 180 ms entrance (drawer, dialog, toast), spinners and progress. All off under `prefers-reduced-motion` |

## Navigation and URL model

- Hash routes with `vue-router`: `#/overview`, `#/servers`, `#/mods/<server>`, `#/mods/<server>?check=1.21.4&filter=blockers`, `#/modconfig/<server>/<fileId>`, `#/backups/<server>?tier=daily`, `#/config?q=apiUrl`, `#/config/raw`, `#/guilds/<id>`, `#/audit`. Back works, refresh keeps place, `confirmLeave` runs on every route change and on `beforeunload`. The old tab state is the fallback for one release.
- One server picker (sidebar, or a chip in the top bar). The route owns the server. No per-view pickers.
- Under 760 px: 56 px top bar with a 44 px menu button, the view title and the server chip. The sidebar becomes a drawer: Esc and the scrim close it, focus moves in and returns. The edit bar docks to the bottom edge.
- Bot down is one status line under the top of the content, not a persistent paragraph.

## Dashboard i18n proposal

Add the seam now and ship English only. `src/web/frontend/src/i18n.ts` exports `t(key, params)` with plurals through `Intl.PluralRules` (no "(s)"). Flat `<area>.<name>` keys in `src/web/frontend/src/locales/en.ts`, the same convention as `src/core/locales`. The glossary (state labels, tier labels, feature names, duration format) and the status table (name, shape, colour) live in `@mcbot/schema` as plain data with `en` and `de`, read by both the bot and the dashboard. German ships once the audit's term list is agreed. Cost of the seam: 1 to 2 person-days, inside the shell phase.

## Discord embed language

Shown in `discord.html`, English and German for every message type.

| Topic | Rule |
|---|---|
| Colour | Status only, the seven values above, identical to the dashboard. No separate celebration colour |
| Titles | Object or action, sentence case, both languages. "Success" and "Error" only as a last fallback. Server name in the title |
| Emoji | One leading circle for server state. None elsewhere, none instead of a button label |
| Fields | Identity first, then measures, then free text. At most 3 inline. 25 fields, 1024 per field, 4096 description, 256 title, 6000 total, 45 for a modal label, guarded in the builder |
| Footer | Empty by default. `Page n/m` is a disabled pager button. A server id only for multi-server guilds when the title does not say it. No "Requested by" |
| Timestamp | Only on live data (status, alerts). Times in text are Discord timestamps |
| Errors | Problem plus recovery in one or two sentences, no paths or ids for non-admins, always ephemeral |
| Ephemeral or public | Ephemeral: errors, denials, confirmations, personal data, config. Public: status, lists, moderation outcomes, bridge. Admin check before the defer |
| Mentions | Ping the role on the first failure and when severity rises. Recoveries and repeats never ping. `allowedMentions` explicit on every send |
| Confirm | One row, danger button plus Cancel, 60 second expiry noted in the footer |
| Pagination | Previous, disabled `Page n/m`, Next. Disabled, not removed, after 3 minutes |
| German | du-form, "Server" for Minecraft, "Discord-Server" for the guild, "Bot-Admin", "Kanal", "der API-Wrapper". A proposal for a native read |

The panes are an HTML approximation of Discord's dark theme, not a capture.

## What the mockups show

| Page | States |
|---|---|
| `config.html` | clean (applied), dirty with per-field marker and old value, validation error inline with group counts, conflict with per-field picker, saving, applied (toast), waiting for the bot, bot restart needed, bot down, read-only with reason. Also filter with empty result, raw JSON tab, review dialog, history dialog |
| `mods.html` | installed list with icons, loading skeleton with icon tiles, per-row busy and pending restart, update check running ("Checking 14 of 62") beside the list, results with Ready, No build and Unknown, blockers filter (works), check failed, empty, load error with retry, remove confirmation with the mod icon. The catalog shows search results with icons, one open version picker, an installed hit, and a skeleton. One row has an icon that fails to load and one has none, both show the initials tile |
| `backups.html` | Polish's view in Hybrid tokens. List, stale list, loading, creating (list stays), created, row busy (deleting), typed delete, restore blocked (server online), typed restore (server stopped), restoring (other rows disabled), restore finished, restore failed, empty, load error, read-only. The type filter works on the sample rows |
| `discord.html` | Colour map, rules, /backup (new, mirrors the Latest per type card), /status (online, offline), /server stop confirmation and public notice, error with recovery, denial, /players page 1, /mods page 1, downtime alert and recovery with mention policy, chat bridge and events, /daily, whitelist application. EN and DE switch on every message |

Why Backups is the third screen (same as both parents, so the three directions stay comparable): it carries the most findings that can be fixed visibly (DASH-09, 11, 21), the hardest confirm level, the long-job pattern, and its restore flow is where the parents' invented behaviour was largest, which makes it the best test of the "no unverified claims" rule.

## Content width, measured

Method: Edge via Playwright, vertical scrollbar present, used width is the content box of `.content` (Polish) or `.page` (Hybrid) after side padding, with the same 232 px sidebar. Identical on Config, Mods and Backups.

| Viewport | Polish | Hybrid before | Hybrid now |
|---|---|---|---|
| 1440 | 1145 px | 1116 px | 1145 px |
| 1920 | 1392 px (capped at 1440, left aligned) | 1116 px | 1625 px |
| 2560 | 1392 px | 1116 px | 2265 px |

At 1440 Hybrid now equals Polish: the 29 px gap was Hybrid's wider side padding (32 against 24 px) plus the 1180 px cap. Above 1440 Polish itself stops growing, so Hybrid is now wider than Polish at 1920 and 2560 on purpose. How the extra width is used: Config shows two group columns from 1800 px and three from 2400 px. Mods at 1440 shows the list with the check card and the Modrinth catalog beside it, from 1900 px the check card and the catalog become separate columns next to the list. Backups from 1360 px puts the list beside the Latest per type card, and from 2200 px caps the list at 1700 px. The Mods table hides the "Runs on" column when the list is narrower than 820 px (container query) so the Update and Remove buttons never clip. No horizontal overflow at 1440, 1920, 2560, 390 and 360.

## Differences from the Polish backups mockup

Layout, information structure, filter, row actions, typed confirms and every Polish state are kept. These elements changed because the code cannot do what Polish drew, or because of the Hybrid system.

| Polish shows | Hybrid shows | Reason |
|---|---|---|
| Restore job as a step list (stopped, safety copy saved, restoring world files 62%, starting) | One indeterminate bar, elapsed time and, when it ends, the exit code and the last 4000 characters of output | Restore is one blocking call with no steps and no percentage |
| Pre-restore safety copy named in the dialog and the job (`smp-pre-restore-...`) | "There is no undo. Create a backup of the current state first if you may want it back." | `restore.sh` takes no safety copy |
| Restore stops smp, disconnects players, starts it again in about 4 minutes | Restore is refused while smp is online (blocked dialog with the reason and a link to Servers), and smp stays stopped afterwards | The script exits 3 when the server is up and never stops or starts it |
| `backups:write` capability in the read-only banner | `backup:create`, `backup:restore`, `backup:delete`, named per action | Those are the real capability names |
| Sub-line under the name ("Before Fabric API 0.113.0 to 0.114.0", "Created by domenic") | Removed | `BackupFileInfo` has no note or author |
| "Showing 1 to 8 of 18", Previous and Next | "Showing 10 of 18" and "Load 8 more" | The list pages forward with a cursor, there is no previous page |
| Creating card says the server stays online and saving pauses briefly | Says the script reports no progress, the bar only shows it is running | The pause claim is not verified |
| "You can leave this page. The restore keeps running." | "Keep this tab open: the result is reported here." | The result arrives on the same request, leaving is not verified |
| Tier badges coloured per type (Pre-update blue, Manual amber) | Neutral tags, an info tint for Pre-update, an accent outline for Manual | Amber means "needs a look" in the status system, so it is not used for an origin label |
| Names without file extension | Names as the wrapper returns them (`.tar.zst`) | Show what the file is called |
| No stale list, no blocked restore, no failed restore | Stale list, blocked restore, restore finished and restore failed states added | They follow from the same facts and Polish had no place for them |
| (nothing) | "Latest per type" card beside the list from 1360 px | Real data (`BackupSummary.dirs`), and it gives wide screens a second column. `/backup` in Discord shows the same fields |

## Findings fixed and not

### Dashboard

| Id | Status | How |
|---|---|---|
| DASH-01, 02, 16, 20, 25 | fixed | Top bar and drawer, hash routes, one server picker, one status line, grouped nav with eleven distinct icons |
| DASH-03, 04, 14, 15 | fixed | `EditorShell` with dirty count, per-field marker, guard on leave including invalid raw text, groups, filter, secrets masked ("current key is never sent to the browser") |
| DASH-05, 06, 07, 10 | fixed | Token pairs verified, focus ring, bound labels, named icon buttons, 44 px targets on phones and coarse pointers |
| DASH-09, 12, 21 | fixed | `ResponsiveTable` used by Mods and Backups, create backup, tier filter, Restore and Delete named and visually distinct, restore prerequisites in the dialog |
| DASH-11, 13 | fixed | Three confirm levels, inline error with retry, job block |
| DASH-22, 24 | partly | Duration helper and copy fixed. Analytics durations are applied in the remaining-views phase |
| DASH-08 | hotfix | `parseStamp`, independent of this direction |
| DASH-17, 18, 19, 23 | not fixed | Wizard hint layout, rollback entry and diff, light theme (late optional phase), Console log semantics beyond the shared components |

### Discord

| Id | Status |
|---|---|
| DISC-04, 05, 06, 09, 12, 13, 14, 16, 19, 22, 25 | fixed (limit-aware pager, ephemeral config and denials before defer, mention policy, problem plus recovery, real titles, one confirm row, status colours, footer and timestamp rules) |
| DISC-07, 08, 15, 23 | partly, German grammar needs a native read |
| DISC-01, 02, 03 | hotfixes, independent |
| DISC-10, 17, 18, 20, 21, 24, 26 to 36 | not fixed (bridge logic, command consolidation, autocomplete, guild-only contexts, backlog) |

## Implementation impact

### (a) Effort in person-days, derived from the parents' phase tables

Parents' phases, from their own `direction.md`: Polish C0 3, C1 5 to 7, C2 5 to 7, C3 5 to 7, C4 8 to 11, C5 10 to 15, C6 2 to 3 (total 38 to 53 including the hotfixes). Evolve phases 1 to 6: about 8, 5, 7, 8, 14, 3 (range 35 to 55, most likely 44, hotfixes excluded).

| Hybrid phase | Taken from | Arithmetic | Days (most likely) |
|---|---|---|---|
| P0 Hotfixes | Polish C0 kept | 3 as in Polish (Evolve also treats them as independent) | 3 |
| P1 Tokens, preset, status roles, density | Polish C1 token part, plus Evolve's full role set | Polish tokens 1.5 to 2, plus 0.5 to 1 for the seven status roles, density and the hex lint. Evolve's fonts, light preset and theme composable are dropped | 2 to 3 (2.5) |
| P2 Shell, router, drawer, i18n seam | Merged Polish C1 shell and Evolve phase 2 | Polish shell 3 to 4 and Evolve 4 to 6 are the same work, take 4 to 5, plus the i18n seam 1 to 2, plus 0.5 for the fluid content width (one `--page-max` token, container and column rules shared by the views) | 5.5 to 7.5 (6.5) |
| P3 Base components, with Backups as the pilot | Merged Polish C2 and Evolve phase 1 components, Backups added from both | Components: Polish 5 to 7 for ten, Evolve about 5 to 8 after removing its token share. Hybrid builds eight components and three composables: 5 to 7. Backups 2 to 3 in both parents, moved here so the components ship with a visible use | 7 to 10 (8.5) |
| P4 Config and Mod Config on `EditorShell` | Polish C3 and Evolve phase 3 | Polish 5 to 7, Evolve 6 to 8. Consequence copy for all fields is dropped (optional per field), the apply states are already served by the backend: 5.5 to 7.5. Plus 0.5 to 1 for the group columns at 1800 and 2400 px (multi-column flow, per-field break rules, checks of dirty and conflict markers in each column count) | 6 to 8.5 (7) |
| P5 Discord builders | Polish C4 (8 to 11) and Evolve phase 4 (about 8) | Evolve's shared colour table in `@mcbot/schema` adds about 0.5, no celebration colour and no footer variants save about 0.5, German review included: 7 to 10 | 7 to 10 (8.5) |
| P6 Mods migration and remaining views | Polish C5 (10 to 15, minus Backups 2 to 3 and i18n 1 to 2 moved elsewhere) and Evolve phase 5 | Mods 3 to 4 (behaviour kept, markup replaced, check UI on existing job data), seven lighter views 5 to 7, plus 1 for mod icons: a `ModIcon` component with the initials fallback, and `iconUrl` on installed mods through the existing proxy (new backend lookup by project, installed rows and check rows only; the catalog already has icons) | 9 to 12 (10.5) |
| P7 Verification | Polish C6 | axe on every view, 360 to 1440, keyboard walk: 2 to 3 | 2 to 3 (2.5) |
| P8 Light theme (optional, not counted) | Evolve | A second value set plus a second axe and screenshot pass: 3 to 4 | not in total |
| **Total** | | Low 3+2+5.5+7+6+7+9+2 = 41.5. High 3+3+7.5+10+8.5+10+12+3 = 57 | **41.5 to 57, most likely 49** (38.5 to 54, about 46, without the hotfixes). Revision 2 added 2 days to the low end, 2.5 to the high end and 2 to the most likely figure (0.5 + 0.5 + 1) |

Reading it against the parents: Polish is 38 to 53 including the hotfixes, Evolve 35 to 55 plus 3 for hotfixes, so 38 to 58. The hybrid lands in the same band, at its upper half after revision 2. The Backups change costs nothing extra: P3 already rebuilds Backups, Polish's layout is the same size of job as the first Hybrid layout, and the stat tiles reuse the Mods metric style. It is not cheaper than Evolve in total: what it saves (fonts, light theme, edge motion, consequence copy for every field, about 4 to 6 days) is spent on the visible Backups pilot in P3, the stale and blocked-restore states, and the optional per-field metadata. What it buys is a lower risk profile and an earlier visible result, not a smaller bill. The estimate excludes native German review and a real-device pass.

### (b) Risks

| Risk | Mitigation |
|---|---|
| Half-migrated product, some views on tokens and some on old colours | Land tokens first with no visible change, add the hex lint rule before the first migrated view, migrate by flow (Backups, then Config, then Mods) |
| Wide blast radius of the PrimeVue preset | P1 is one PR that only changes values (contrast, focus, radii, control height) behind the existing layout, with screenshot diffs before any component work |
| Router changes the unsaved guard and bookmarks | One store keeps tab state and route in sync, keep `useUnsavedGuard`, route-leave tests before merge, tab state as fallback for a release |
| Mods rewrite regresses the best flow | Characterisation tests for `useMods` and `useModCompat` first, migrate markup only, behaviour stays |
| Backups copy overpromises | Every sentence in the restore dialog is traced to the restore script or the route. Re-check when the wrapper changes |
| Mockups are not PrimeVue, pixels will differ | The HTML is the contract for tokens, states and copy, not for exact spacing. P3 includes a PrimeVue `DataTable`, `Dialog` and `Select` spike before the rest |
| Embed colour change and mention policy surprise guilds | Changelog entry and a `docs/user` note, one colour map so a per-guild override is possible later, mention change behind a config flag until the owner signs off |
| Per-field `effect` and `reload` metadata is new content | Optional: a field without it shows only the key line and help |

### (c) Component layer

New in `src/web/frontend/src/components/ui/`: `StatusChip` (merges `ConfigStatusChip` and `StatusDot`), `FieldRow` (wraps `FieldShell`), `InlineError`, `InlineBanner` (extends `StaleBanner`), `ResponsiveTable`, `JobBlock`, `EditorShell` with `EditBar`, `AppShell` (top bar, drawer, sidebar). New: `ModIcon` (image with width and height, lazy loading, decorative or named alt, initials tile on a tint derived from the slug when the image is missing or fails). New composables: `useConfirmAction` (extends `useTypedConfirm`, three levels), `useRowBusy`, `useDensity`. `ViewHeader`, `EmptyState`, `TypedConfirmDialog`, `FieldHint` are extended, not replaced. Paradigm per file stays.

| View | Change | Notes |
|---|---|---|
| `App.vue` (524 lines) | L | Shell, router, drawer, server picker, skip link |
| `style.css`, `main.ts` | M | Tokens file, preset values, focus ring, `contrastColor` replaced by `--on-accent` |
| `ConfigView.vue` | L | `EditorShell`, groups, filter, `FieldRow`, apply status from the existing endpoint |
| `components/schema/*` | L | `SchemaField` renders `FieldRow`, secrets as password fields, titles and help from schema |
| `ModConfigView.vue` | M | Same shell, guard on file switch (DASH-03) |
| `ModsView.vue` (1,574 lines, 25 raw hex values) | L | Shared buttons and tokens, one confirm, `JobBlock` and blockers filter on existing job data, list plus check plus catalog columns, `ModIcon` in installed, check, catalog, picker and remove dialog, `iconUrl` on installed mods |
| `BackupsView.vue` | M | `ResponsiveTable`, per-row busy, create, type filter, blocked and typed restore, stale state, summary tiles, Latest per type card, Polish's layout |
| `StatusView.vue`, `OverviewView.vue` | S to M | `StatusChip`, readouts on the type scale |
| `ConsoleView.vue`, `CommandsView.vue`, `GuildsView.vue` and `SetupWizard.vue`, `AnalyticsView.vue`, `AuditView.vue` | S to M each | Headers, inline errors, labels, durations, empty states |

PrimeVue preset: colour roles, two radii, focus ring, control heights, coarse-pointer sizes, toast position. No second UI library. New dependencies: `vue-router` (hash history, about 20 KB), the only one, because a hand-rolled router would reimplement `beforeEach` and back handling. No font, icon or UI library is added. Raw hex in `.vue` files today: 6 files, 25 values in `ModsView.vue`.

### (d) Bot builders and replies

Greps re-run on `src/bot` in this worktree: `createEmbed(` 61 call sites in 38 files, `new EmbedBuilder` 1, `createErrorEmbed(` 23, `createSuccessEmbed(` 18, `createInfoEmbed(` 3, `EmbedColor.` 61 references in 30 files, `setFooter` 14, `createPaginationButtons` 15 (14 plus the definition), `handlePagination` 14, `allowedMentions` 4, files with `new ButtonBuilder` 4, `ephemeral` 44, `setLabel(` 13, `.reply(` plus `.editReply(` 125, files using `withErrorHandling` or `requireServerAdmin` 35. Locale files: 673 lines (en) and 669 (de).

Functions to change, in `src/bot/utils/embeds/embedUtils.ts`, `embedColors.ts`, `serverStateDisplay.ts`, `alertUtils.ts`:

- `EmbedColor`: values come from the status table in `@mcbot/schema` through `statusColor(state)`. Same hues, new exact values. Brand colours stay only where external (Modrinth).
- `createEmbed`: timestamp off by default, optional state for the leading circle. `createErrorEmbed`: takes `{ problem, recovery }`, red, ephemeral by construction. `createSuccessEmbed` and `createInfoEmbed`: no default titles or footers.
- New: `replyError`, `replyDenied` (localised, ephemeral), `createConfirmEmbed` plus `createConfirmRow` (danger button, Cancel, 60 s expiry), `createProgressEmbed`, `paginateFields` (limit-aware), `pageFooter` (a disabled pager button), `statusCircle`, `describeState`, `safeMentions(kind)`, `shouldPing(previous, next)` in `alertUtils.ts`. In `@mcbot/core`: `formatDuration`, plural helper over `Intl.PluralRules`. In `@mcbot/schema`: status table, tier labels, glossary keys.
- Dispatcher in `src/bot/index.ts` and `middleware.ts`: admin check before the defer, one denial shape, localised fallback.

Call sites that change: about 30 command and interaction files for colour and title, 14 footers, 14 pagination, 35 for the error wrapper, 4 for mentions plus the alert callers. Roughly 90 to 110 edits in total, about 40 mechanical. Locale impact: about 70 to 100 existing keys edited per language, about 25 to 30 new keys per language (confirm, recovery, pager, glossary), a new test for the 45 character modal label and the 256 character title limit. `npm run i18n:check` stays green because both files change together.

### (e) Phase plan for Phase C

Each phase is one PR (P3 and P6 may split) and ends in a shippable state. The "stop here" column says what the owner has if work ends there.

| Phase | Content | Days | Ships as | Stop here means |
|---|---|---|---|---|
| P0 | Audit hotfixes (DASH-03, 04, 05, 06, 08, DISC-01, 02, 03, 05) | 3 | Bug fixes, no redesign | The must-fix list is closed, the app looks as before |
| P1 | Tokens, PrimeVue preset values, focus ring, 44 px targets, density, hex lint | 2 to 3 | Same app with correct contrast and focus | Recognisable app, accessibility floor met, token foundation in place |
| P2 | `AppShell`, `vue-router`, drawer, grouped nav, one server picker, i18n seam, fluid content width | 5.5 to 7.5 | Phone navigation works, deep links, back button, wide screens filled | DASH-01, 02, 16, 20, 25 closed |
| P3 | Base components, Backups on them (pilot, Polish layout) | 7 to 10 | Backups rebuilt, components live | DASH-09, 11, 21 closed, a proven component layer exists for later work |
| P4 | `EditorShell`, Config and Mod Config, apply status chip, group columns on wide screens | 6 to 8.5 | Config editor with groups, filter, markers, guard, conflict picker | DASH-03, 04, 14, 15 closed, the largest daily editor is done |
| P5 | Discord builders, colour table, confirm row, pager, mention policy, locale keys (parallel with P2 to P4) | 7 to 10 | Bot messages in one language | Discord side finished independently of the dashboard |
| P6 | Mods migration (with mod icons and catalog layout), remaining views | 9 to 12 | Every view on tokens and components | No half-migrated screens |
| P7 | Verification: axe on every view, 360 to 1440, keyboard walk, phone and NVDA pass, test guild pass | 2 to 3 | Report and fixes | Release candidate |
| P8 (optional) | Light theme | 3 to 4 | Auto, Dark, Light switch | Only if the owner wants it |

Sequencing rule that makes the stops clean: P1 never blocks on the router, P5 touches only `src/bot` and shared packages, and P3 includes a real use (Backups) so the components are never shipped unused.

### (f) What it would not fix

- The look is still a standard admin shell (see the review gate). No light theme before P8. DASH-17, 18, 19.
- Discord command sprawl (DISC-18), `/help`, autocomplete, bridge edge cases (DISC-10, 17), German grammar rewrites without a native reader.
- Icons on installed and check rows are a mockup of a feature the API does not support yet (see the effort table). Real icons use the existing proxy, which serves raster images only, so the sample SVG tiles in `img/` would be PNG or WebP in the product.
- Free-space and "needs N GB" statements for restore, a bot restart control in the dashboard, and live progress of backups and restores: the wrapper and scripts do not report them, so the mockups do not draw them.
- Nothing here was tested on a real phone, with a screen reader, in PrimeVue or in live Discord.

## Comparison

Against **Polish**: the Backups screen is now Polish's own layout and flow in Hybrid's tokens, so the two differ there only in the twelve items listed above, and Hybrid fills wide screens where Polish stops at 1440. Hybrid gains a complete token system with a light-ready role set, shaped status chips shared with Discord (Polish only colours by meaning), density, a shared component layer instead of a lighter ad hoc one, and a Backups restore flow that is built on the real script. It gives up Polish's smaller surface (about 10 components and no density) and, in the first phases, a slightly cheaper path: P1 plus P2 cost 7 to 10 days where Polish's C1 costs 5 to 7. Visually it is almost the same app, so the weakness Polish names (generic look, no voice) stays.

Against **Evolve**: Hybrid gains recognisability (same colours and faces), lower risk (no webfont, no light theme to verify, no motion PrimeVue cannot reproduce, no migration to a new hue), and many fewer unverified wrapper assumptions (steps, safety backup, restart button, ETA, cancel, capability name). It gives up Evolve's Plex type, which is the most distinctive thing Evolve has, the light theme until P8, the state-edge animation (resolve flash, sweep) and consequence lines on every field. Evolve looks more designed on a screenshot; Hybrid looks like today's app with the faults gone. Total cost is about the same.

## Review gate

**Cover the logo.** It fails the same way both parents do: with the logo covered this is a dark charcoal admin panel. What is specific is content (smp and creative, Fabric 1.21.x, real config keys) and meaning (shaped status chips, the key line under every field, the apply states). That is deliberate for an operate surface and for owner recognition, and it is the main weakness.

**Three decisions a model would not make by default.**
1. Cut the state-edge animation but keep a static edge. The default is to keep the signature motion that made Evolve distinctive. The edge keeps its information in any theme and under reduced motion, and removes the one thing PrimeVue cannot do.
2. Every claim in Backups and Mods follows existing code: the restore dialog says "no undo" and shows a blocked variant when the server is online because `restore.sh` exits 3 then, and the check shows no steps because `ModCompatJob` has none. The default is a satisfying step list and a safety backup.
3. Unknown is amber in the update check and grey on a server, with the rule stated once. The default is one consistent grey; here consistency would hide the "do not upgrade yet" signal.
Also: apply states named after `ConfigApplyState`, and the Restart tag moved to server connection settings.

**States matrix.**

| State | Config | Mods | Backups |
|---|---|---|---|
| Loading | not shown (schema is bundled) | yes | yes |
| Empty | filter with no result | yes | yes |
| Error with retry | validation errors yes, load failure not shown | yes | yes |
| Stale or partial | waiting for the bot, bot down, restart needed | partial results while checking | stale list |
| Busy | saving | per row, check running | creating, row deleting, restoring |
| Success | applied toast | pending restart row | created toast, restore finished |
| Read only | yes | not drawn | yes |
| Conflict or dirty | yes | n/a | n/a |
| Blocked | n/a | n/a | restore with the server online |
| 500 items | not shown | filter only | "Load more", 500 rows not rendered |

**Squint test.** The status strip and the green primary action read first, then the group list, then fields. Status chips are the only small coloured shapes. In Mods results the three tiles and the amber banner compete a little, the banner wins.

**What is weak.** The look (above). The mockups are not PrimeVue, so chip shapes, dialogs and tables are an assumption until the P3 spike. The state picker is a mockup device and takes vertical space. The sidebar footer (density, user) sits below the fold at 900 px height. German is unreviewed. Embed rendering is an approximation. Light theme is not designed, only made possible. At 2560 the Mods list column is wider than a six-column table needs, and Config groups are balanced by CSS column flow, so a short group can leave a gap at the foot of a column. Icons on installed rows depend on backend data that does not exist yet.

**Verification done (revision 2).** Edge, own tab, 1440, 1920, 2560, 390 and 360: Config (clean, dirty, error, conflict), Mods (installed, results, busy, loading, checking, empty, error, remove, check failed) and all 15 Backups states. One fix round: Mods table clipped the Update button at 1440 (Runs on column now hides below 820 px list width, cell padding 10 px), catalog title links were 23 px tall on phones (now 44 px), the icon-only delete button stretched across the card on phones (now 44 px square), long file names stretched a mobile card (now wrap), a loading skeleton had an `aria-label` on a div without role (now `role=status`), side padding 32 to 24 px to match Polish at 1440. Confirm round: no horizontal overflow, no target under 44 px on phones. axe-core (wcag2a, wcag2aa, wcag21aa, best-practice) at 1440 on Mods (installed, results, remove, loading), Backups (list, typed restore, blocked restore, restoring, read-only, created) and Config (dirty): no violations after the fix. The console shows one expected 404 for the icon that is meant to fail. Not verified in revision 2: 430 px, a keyboard walk, a screen reader, a real phone, whether the Modrinth CDN images behave like the sample tiles. Earlier verification (revision 1, rest of the pages): Rendered in Microsoft Edge (Playwright) at 1440, 390 and 360 for every state of Config (10), Mods (9), Backups (15), plus Discord, index and preview. One fix round: inline links in the status strips were under 44 px on phones, the preview scaffold overflowed horizontally on phones (a desktop review tool, now scrollable), and one transient contrast failure was re-checked after the dialog entrance finished. A confirm run showed no horizontal overflow and no remaining undersized targets. axe-core 4.10.2 (wcag2a, wcag2aa, wcag21aa, best-practice) on Config (dirty, error, conflict), Mods (results, remove), Backups (list, restore, restore failed), Discord, index and preview at 1440: no violations after the fix round. Not verified: 430 px visually, a keyboard walk, a screen reader, a real phone, live Discord, PrimeVue fidelity, German by a native speaker. Reference screenshots are in `shots/`.

# Wave 2 UX audit: admin dashboard (phase A)

Surface mode: Operate. Scope: `src/web/frontend` (Vue 3 + PrimeVue, Fastify backend). No source file was changed.
Internal benchmark: Mods tab (`views/ModsView.vue`) and Mod Config (`views/ModConfigView.vue`).
Screenshots are in `shots/` (referenced by file name below). Paths are relative to `src/web/frontend/src/` unless stated.

## a) Method and limits

| Item | What was done |
|---|---|
| Build under test | Branch `refactor/w2-a-dashboard` (from `refactor/wave2`), `node scripts/dev-up.mjs --id w2-dashboard --only web`, dev auth bypass (sysadmin), dark theme (only theme that exists). |
| Data | A throwaway fake wrapper (real wrapper `dist`, scaffolded instance outside the repo, fake RCON responder): 1 server `dev` online, 3 players, 12 mods listed from `downloaded_versions.json`, 6 hourly backups, 4 mod config files (toml, properties, json, 400-item json), 400-line log with very long lines, 12 players with stats. Wrapper and dev instance were stopped by recorded PID / `dev-down.mjs`. |
| Viewports | 1440x900, 430x932, 360x740, Microsoft Edge via Playwright, every nav tab at every viewport (screenshots + metrics: horizontal overflow, interactive elements under 44px). |
| Mechanical checks | axe-core 4.10.2 injected on all 11 views at 1440 (violations only), keyboard Tab walk with computed focus styles, console/network errors, dialog focus and Esc behaviour, dirty-state probes (edit, leave, switch file). |
| Source reading | App.vue, all 11 views, `components/ui`, `components/schema`, `useEditableDocument`, `useUnsavedGuard`, `useModConfigs`, `useConfigHistory`, `useServerActions`, `TypedConfirmDialog`, `main.ts`, `style.css`. |

Could NOT be seen or verified:

| Gap | Why | Consequence |
|---|---|---|
| Real mod install/update/remove, Apply all, compat-check job running state | Mod scripts need sudo, unsupported on this Windows host | Mods write paths and the job progress UI were read in source only (`ModsView.vue:78-92`), not run. |
| Mods list uses live Modrinth search | Network search worked (catalogue shown) but installs were not attempted | Installed table was populated from the manifest only. |
| Commands editor body, Guild config editor, Setup wizard steps 2 and 3, guild cards | Needs the bot process (command manifest) and a live Discord token; Discord returns 401 here | Only empty/error states of these three were audited. Wizard step 1 error state seen on 360 (`guilds-mobile360-wizard-error.png`). |
| Server action running states (start, restart, backup in progress) | Stub scripts exit immediately | Long-running behaviour judged from `useServerActions.ts:56-90`. |
| Real-phone check, screen reader speech output | Not available | Touch sizes are measured, not felt; AT findings are from axe + DOM, not NVDA/VoiceOver. |
| Light theme | None exists (`index.html:2,12` hardcode `class="dark"`, `main.ts:104` `darkModeSelector: ".dark"`) | Light-mode review is "not applicable, finding DASH-19". |
| Permission-restricted roles (non-sysadmin grants) | Dev auth is always sysadmin | Read-only/no-permission states audited from source (`ModConfigView.vue:178`, `App.vue:119`), not rendered. |

Console: two 502s at load (`/api/guilds`, `/api/setup/guilds`) from Discord 401, expected in this setup; no JS exceptions.

## b) Inventory

Verdict scale: ok / weak / bad. "vs Mods" compares against the benchmark (better / equal / worse).

| View | Purpose | Who (gate in App.vue:237-258) | States covered | States missing | Mobile | A11y (axe, 1440) | vs Mods |
|---|---|---|---|---|---|---|---|
| Login gate | Discord OAuth entry | anyone | single state | error after failed OAuth, expired session | ok | not scanned | n/a |
| No-access shell | Signed in, no grants | `hasNothing` | empty with next step (`App.vue:119`) | n/a | ok | n/a | equal |
| Overview | Glance: stats, health, servers, guilds, recent activity | `server:read` | populated, stale bot, empty guilds/activity | loading skeleton, per-card error | weak (6px overflow at 360) | contrast x2, no h1 | equal |
| Servers (StatusView) | Status, start/stop/restart/rollback/backup, logs | `server:read` | online card, tooltips, alerts | running action progress, offline card not seen, many servers | ok | aria-prohibited-attr x2, contrast x6 | worse (no job state) |
| Guilds | Configured guilds, config editor, wizard | `guild` | empty, loading, Discord error (toast only) | populated card, per-guild error, partial failure | weak (hint layout broken) | contrast x4 | worse |
| Console | Live log (SSE) + command line | `server:read` | live, disconnected label, empty, filtered-empty, blocked command | reconnecting detail, huge buffer, command history | weak (7 targets under 44) | scrollable-region-focusable, contrast x3 | equal |
| Analytics | Uptime, players, leaderboard, command usage | `server:read` | empty chart, "Unknown", leaderboard fallback copy | error, loading | ok | contrast x7 | equal |
| Commands | Enable/disable commands per scope | sysadmin | empty ("manifest not written"), retry | populated, conflict, partial save | not verifiable (body not rendered) | aria-input-field-name, contrast x5 | n/a |
| Backups | List, download, restore, delete | `server:read` + `backup:*` | list, empty, stale banner, load more, typed confirm | create backup, filter by tier, in-progress restore | bad (530px wide at 360) | contrast x8, empty th | worse |
| Mods | Browse Modrinth, install, update, disable, remove, compat job | `mods:read` / write | loading, empty, no results, job progress, job failed, job stale, per-row busy | list error (toast only), remove undo | weak (table actions clipped at 360) | contrast x17, button-name x2, select-name | benchmark |
| Mod Config | Edit mod config files as forms | `config:read` / write | stale, queued edits, conflicts, truncated list, read-only, filter-empty, no-file, source view, history revert | unsaved guard (missing) | ok (best on mobile) | label x2, contrast x2 | benchmark |
| Config | Edit `config.json` (schema form + raw JSON) | sysadmin | loading, load error + retry, stale after save, errors, warnings, conflicts, raw parse error, new-feature banner | sticky actions, search, section nav, discard of raw edits | bad (638px wide at 360) | label x10 critical, button-name, nested-interactive, contrast | worse |
| Audit Log | Actions list, config history, rollback | `audit:read` | empty, filter, paginate | load error, history load error (swallowed) | ok | contrast x2 | equal |

## c) Per-flow findings

Severity: blocker (task cannot be done on a target device), major, minor, polish. IDs map to section f.

### c1. Shell and navigation (all flows)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-01 | blocker (mobile) | Below 760px the sidebar becomes a 530px block (72% of a 740px viewport): the 11-item nav stacks vertically, "Add to Server" floats mid-block, content starts at y=530. Tapping a tab does not scroll, so the user changes tab and sees nothing change. | `App.vue:512-522`; `backups-mobile360-full.png`, `config-mobile360-full.png`; measured sidebar 530px, content top 530px | Under 760px render a top bar (brand, server switcher, menu button) plus a Drawer for nav; scroll `.content` to top on tab change. |
| DASH-02 | major | No router. Tab is an `activeTab` ref (`App.vue:226`, comment in `useUnsavedGuard.ts:1-8`). No deep link to a view/server/file, refresh returns to the first tab, browser Back leaves the app, a rollback or mod-config location cannot be shared in a ticket. | `App.vue:226`, `App.vue:309-327` | Hash router (`#/mods/dev`, `#/modconfig/dev/<fileId>`); drive `activeTab` from it; keep `confirmLeave` on route change. |
| DASH-16 | minor | Two server pickers: sidebar switcher sets `activeServer`, and Backups/Console/Analytics/Mod Config each render their own Button row when more than one server exists. Mods follows only the sidebar. Two sources of truth. | `App.vue:37-56`; `BackupsView.vue:25-34`, `ConsoleView.vue:15-27`, `ModConfigView.vue:62-73` | Remove in-view pickers; show current server as a header chip in `ViewHeader`. |
| DASH-20 | minor | "Bot looks down" banner is a full-width bold orange block on every page (66px desktop, 100px at 360), repeated above every view even where irrelevant, and gives no action. Copy has an em dash and "heartbeat stale" jargon. | `App.vue:103-111`; every screenshot | One compact status bar linking to Overview health, copy like "The bot has not reported in for N min. Changes you save are applied when it restarts." |
| nav | minor | Config and Mod Config share one icon (`pi-sliders-h`); order mixes monitoring, tools and admin without grouping (11 flat items, over the 5-7 working-memory guidance). | `App.vue:253-256` | Group nav: Monitor (Overview, Servers, Analytics, Console), Manage (Backups, Mods, Mod Config), Admin (Guilds, Commands, Config, Audit). Distinct icons. |

### c2. Config editor (ConfigView, SchemaField, MapField, ArrayField)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-04 | major | Raw JSON edits that do not parse are invisible to the dirty model: Discard is disabled and leaving the tab shows no "Discard unsaved changes?" dialog. Verified: typed garbage, clicked Backups, left without prompt. | `useConfig.ts:135-141`, `useEditableDocument.ts:126-133`, `ConfigView.vue:19-26`; `config-desktop-raw-invalid.png` | Track `rawText !== baselineText` as dirty; enable Discard and the guard. |
| DASH-15 | major | Secret fields are plain text inputs. The stored secret is shown as the literal string `•••••` and a newly typed token is visible in clear. | `config-desktop-dirty-secret-plaintext.png` (token shows `100000000000000009`) ; `SchemaField.vue:46-56` | Schema `format: password` renders a Password input with reveal toggle and `autocomplete="new-password"`. |
| DASH-14 | major | Form is 30+ flat fields with raw camelCase keys as labels (`tpsPollIntervalMs`, `leaderboardPostDay`), no search, no section jump, empty number inputs with no unit or default. Validation errors and warnings (for example the plaintext-HTTP warning, capitalised "ONLY") render as stacked messages at the top while the field is far below. The save/discard bar scrolls away with the header (Commands already has a sticky bar). | `SchemaField.vue:15,30,46`; `ConfigView.vue:4-33,52-70`; `CommandsView.vue:509`; `config-mobile360-full.png` | Schema `title`/`description` for display names, grouped sections with a TOC and filter (Mod Config pattern), sticky action bar, errors attached to the field with scroll-into-view. |
| DASH-07 | major | Labels are not programmatically tied to inputs: `<label class="fname">` has no `for`, inputs have no id. axe: label (critical) x10, aria-input-field-name, nested-interactive in the chips input. `FieldHint` buttons all announce "Help". | `SchemaField.vue:15-70`, `FieldHint.vue:4-9` | One `FieldShell` component generating id, `label for`, `aria-describedby` for hint/error; hint label `Help for <name>`. |
| conflict | ok | Conflict, stale-after-save and load-error states exist with recovery actions ("Discard my edits and reload", "Reload", "Retry"). Save label pluralises correctly. | `ConfigView.vue:36-80` | Keep; copy to other editors. |
| servers map | minor | Map entry row shows a stray trash icon above the entry (what does it delete?), entry label is title-cased key ("Dev" for server `dev`), `Configured` tag is the only status. | `config-desktop.png` | Label the trash button, show the raw key, move delete into the row. |
| saving | minor | Save completes in under 300ms here so a loading state could not be captured; the success toast says "Written to config.json. The status chip shows when the bot has applied it." which is specific and good. After save the warnings list remains at the top. | `useConfig.ts:111` | Keep toast; add saved check inline next to the button for 2s (see Mod Config). |

### c3. Mod config (benchmark)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-03 | major | Edits are silently discarded: clicking another file calls `openFile`, which resets `pending = {}`; the dirty state is not registered with `useUnsavedGuard`, so tab switch and server switch lose it too. Verified: toggled a value ("Save 1 change(s)"), opened `lithium.properties`, button read "Saved", no dialog. | `useModConfigs.ts:246-251`, `useModConfigs.ts:167`; no `registerDirtySource` outside `useEditableDocument.ts:154` | Register `dirty` with the guard; route file select, server select and tab change through `confirmLeave`. |
| label | minor | `<label>` not bound to control (axe label x2); "Save 1 change(s)" uses the "(s)" pattern; the idle "Saved" is a disabled green button that reads as a status but looks like an action; filename path shown as `config/example-mod.toml` with no server context. | `ModConfigView.vue:38-46,257-260`; `modconfig-desktop-dirty.png` | Reuse `FieldShell` (DASH-07), plural helper, show saved state as text + check icon. |
| good | ok | See section e. This view already has stale, queued, conflict, truncated, read-only and filter states and works at 360 (`modconfig-mobile360-full.png`). | | |

### c4. Mods (benchmark, but not clean)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-11 | major | Remove uses native `window.confirm`, no typed confirm, no undo, inconsistent with every other destructive action. | `ModsView.vue:800` | Use the shared confirm composable (DASH-11), include "removes <file>, takes effect on restart". |
| DASH-12 | major | Mods is a design island: raw `<button class="btn">`, native `<select>`, own palette (50 hard-coded hex/rgba values; most views have 0 to 2), `<h1>` while all others use `ViewHeader` `<h2>`, no `ViewHeader`/`StaleBanner`/`EmptyState`, composition API while others are options API. It also breaks at both ends: at 1440 the two-column grid squeezes the installed table so the status pill wraps to "up / to / date" and versions break mid-word; at 360 the status and action columns are clipped inside the card, so Update, Disable and Remove are unreachable without an inner horizontal scroll. | `ModsView.vue:1-30,323-420,951-968,1363-1380,1566-1574`; `mods-desktop.png`, `mods-mobile360-full.png` | Rebuild on shared components keeping the job logic; installed list becomes a card list under 760px; `.pill { white-space: nowrap }`; grid breakpoint 1100 to 1280. |
| DASH-07 | major | axe: button-name x2 (pager chevrons), select-name (sort), search input unlabeled, icon-only Remove has only `title`. Contrast 17 nodes (grey `#6a6a70` on `#141416` = 3.42:1). | `ModsView.vue:148-153,293-307,406-414` | `aria-label`s; tokens instead of hex. |
| load error | minor | Installed-list failure surfaces as a toast; the card stays on "Loading…" or "No mods installed." (indistinguishable from a real empty list). | `ModsView.vue:318-321` | Inline `InlineError` with Retry in the card. |

### c5. Backups

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-09 | major (mobile) | Table is 530px wide at 360 (420 at 430): filename uses `word-break: break-all` (breaks every 3 characters), three text buttons side by side, no card layout, no `@media`. Restore and Delete sit adjacent with identical red styling. | `BackupsView.vue:255-266`; `backups-mobile360-full.png` | Shared responsive list: card per archive under 760px, actions in an overflow menu; differentiate Restore (warning) from Delete (danger). |
| DASH-21 | minor | Row actions are unnamed for AT ("Delete" x6, no file name); Download is a grey text button at 3.71:1; no "Create backup" (the empty state sends users to the Servers page); no tier filter or sort; no total across tiers (only "6 of 6 archives, 29 KB shown"); restore dialog does not say whether the server must be stopped or whether a pre-restore snapshot is taken. | `BackupsView.vue:45-52,83-114`; `backups-desktop.png`, `backups-desktop-restore-dialog.png` | `aria-label="Delete <name>"`; add Create backup; copy: "Restore replaces the world on dev with <file>. Stop the server first. A copy of the current world is not kept." (state the real behaviour). |
| good | ok | Typed-confirm for Restore and Delete, stale banner with a write note, load more. | `BackupsView.vue:3-6`, `TypedConfirmDialog.vue` | Keep. |

### c6. Servers and server actions

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-11 | major | Three confirm styles for four actions: Stop and Restart get a plain confirm ("Really stop "dev"?"), Rollback and Backup get a typed confirm with generic copy ("This will rollback "dev" and cannot be undone." never names what it rolls back to). Typed dialog does not focus its input (focus lands on the disabled-looking accept button). Typed phrase shown without monospace in the screenshot. | `useServerActions.ts:40-72`, `TypedConfirmDialog.vue:9-18`; `servers-desktop-stop-dialog.png`, `backups-desktop-restore-dialog.png` | One confirm composable with three levels (inform, disruptive, irreversible); every dialog states target, consequence, recovery; autofocus the typed input. |
| DASH-13 | major | Long-running operations have no progress: the button spinner plus a 3s toast "Done" or "Exit code 137". Start is enabled on an online server. Compare Mods compat job (progress text, status role, cached result). | `useServerActions.ts:76-83`; `servers-desktop.png` | Action job state in the card (running, finished, failed with the log tail), disable invalid actions by server state, plain failure copy ("Backup failed (exit 137). Open the log.") . |
| a11y | minor | `aria-prohibited-attr` x2 on disk metric spans (aria-label on span without role); metric contrast 3.17:1 (`--mc-dim` on card). | `StatusView.vue:109-115` | Add `role="img"`, raise the dim token. |

### c7. Console

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-23 | minor | Log pane is a scrollable region without `tabindex`/`role="log"`/`aria-label` (axe serious), no aria-live announcements, composer input unlabeled, blocked-command message does not say which rule or why, no copy/clear/download, no command history, long lines scroll horizontally with no wrap toggle. | `ConsoleView.vue:52-96`; `console-desktop-toast-overlap.png` | `role="log" tabindex="0" aria-label`, wrap toggle, Up-arrow history, message "`op` is blocked here (admin commands are disabled in the dashboard)". |
| DASH-13 | major | Bottom-right toast stack overlaps the composer Send button (stale error toast "Failed to load guilds" from another view stays visible over Send). | `console-desktop-toast-overlap.png`; `App.vue:151` | Toast region above the composer (or top-right) and clear view-specific toasts on tab change. |
| good | ok | SSE with reconnect copy, level filter, text filter, empty and filtered-empty text, follow toggle with sticky scroll. | `useConsole.ts:51-132` | Keep. |

### c8. Analytics

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-22 | minor | Durations render as `0d 12h 0m 0s` (zero units, seconds on a 14-day board); uptime shows five bare dashes and a bold "Unknown" with "0 / 0 checks"; no loading or error state seen; server picker is a button row even for one server. | `analytics-desktop.png`, `AnalyticsView.vue:51-72` | `formatDuration` util (largest two non-zero units); explain "No health checks recorded yet. The bot records one every N minutes."; contrast fix. |

### c9. Commands

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-13 | minor | Empty state ("Command manifest not written yet, start the bot once…") is the right idea but offers only Retry and keeps an active "Save changes" button and four controls above it. Copy has an em dash. Has the only sticky action bar in the app. | `commands-desktop-empty.png`, `CommandsView.vue:509` | Hide toolbar when there is no manifest; link to Overview health. |

### c10. Guilds, guild config editor, setup wizard

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-17 | minor | The "Not listed? Use Add to Server…" hint is `display:flex` on a `<p>` so inline text and `<strong>` become separate columns ("Not listed? Use" / "Add to Server" / "in the sidebar…"). | `GuildsView.vue:206-209`; `guilds-desktop-broken-hint.png` | Remove flex from the `<p>`; keep the icon absolutely positioned or in a wrapper. |
| DASH-13 | major | Discord failure is toast-only ("Failed to load guilds / Discord API error (401)"); the page then reads "No guilds configured yet." and invites setup. In the wizard the error is the whole body: only Retry and Cancel, no hint that the bot token is wrong, no manual guild-ID entry. | `useGuilds.ts:20-33`, `guilds-desktop-broken-hint.png`, `guilds-mobile360-wizard-error.png` | Inline error with cause and recovery ("Discord rejected the bot token (401). Check `token` in Config."), allow entering a guild ID. |
| wizard | ok | Wizard is responsive at 360 (dialog fits, stepper intact, focus on Close). | `guilds-mobile360-wizard-error.png` | Keep. |

### c11. Audit log and config history rollback

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| DASH-08 | major | Timestamps are wrong in non-UTC zones. SQLite `YYYY-MM-DD HH:MM:SS` (UTC) is parsed as local time, so an entry made 2 minutes ago reads "2 h ago" on UTC+2 (observed) and the rollback dialog prints the UTC clock time as if local ("13:48:04" at 15:48). Negative offsets would show "just now" for hours. | `src/core/utils/relativeTime.ts:41-43`; `audit-desktop-history.png`, `audit-desktop-rollback-dialog.png` | In `parseStamp`, treat the space-separated form as UTC (append `Z`); add tests for UTC+2 and UTC-5. This is shared with Discord embeds. |
| DASH-18 | minor | Config rollback lives only inside Audit Log; the Config editor has no link to it. History load failure is swallowed (`catch { entries = [] }`) so the section silently disappears; rollback dialog shows no diff or summary of what changes; heading says "restoring one is reversible" but the audit table lists no entry type distinguishing a rollback. | `AuditView.vue:12-48`, `useConfigHistory.ts:35-41,46-56` | "History" button in the Config header opening a drawer with diff preview; `InlineError` on failure. |
| audit | minor | Filter only appears once entries exist; sort only on two columns; detail text is `humaniseIds` output with no raw link; paginator at 360 not verified beyond no overflow (360 ok). | `AuditView.vue:4-9,52-76` | Server and actor filters. |

## d) Cross-cutting findings

| Area | Finding | Evidence | Fix (component layer) |
|---|---|---|---|
| Design tokens | `style.css` defines 20 colour tokens but views bypass them: Mods 50 raw colours, StatusView 2, ConfigView 2. No spacing scale (padding values 7, 9, 11, 14, 26 px hard-coded), no type scale (13, 13.5, 15, 18, 22 px mixed with `.small` 13px), no z-index or shadow tokens. | `style.css:5-47`, `ModsView.vue:951-1380` | Add `--mc-space-1..6`, `--mc-text-xs..lg`, `--mc-focus`, lint rule banning raw hex in `.vue`. |
| Contrast | Primary button label `#eafff0` on `#34c56a` is 2.14:1 (every primary button: Save config, Add to Server, Set up a guild). `--mc-dim` `#6b7280` on `#15171a` is 3.71:1, on card 3.17:1 (secondary text buttons, metric labels, Download). All 11 views fail `color-contrast` (serious). Dark-only so the pairs are fixed. | `main.ts:51` (`contrastColor: "#eafff0"`), `style.css:13`; axe output | `contrastColor` to `var(--mc-on-accent)` (`#06210f`, already defined, about 8:1); lift `--mc-dim` to at least `#8f96a1` on `--mc-card`. |
| Focus | PrimeVue buttons: `outline: rgba(0,0,0,0) solid 1px` on `:focus-visible` (invisible). Sidebar nav items: browser default ring colour `rgb(16,16,16)` on `#191b1f` (about 1.1:1). No skip link; 12 sidebar stops precede content. | measured Tab walk; `focus-primevue-button.png`, `focus-sidebar-nav.png`; `App.vue:471-481` | Preset `focusRing` (2px accent, 2px offset) plus a global `:focus-visible` rule; skip-to-content link. |
| Touch targets | Of about 130 interactive controls measured on 11 views, nearly all PrimeVue `size="small"` buttons are 33 to 39px high, toggle switches 24px, chips 37px, Mods `.mini` buttons under 34px. Zero views meet 44px. Mods alone reports 67 to 74 small targets. | metrics run; `Button size="small"` used in every view | Preset size tokens: `min-height: 44px` under `@media (pointer: coarse)`; tap-area padding on icon buttons. |
| Mobile layout | Only 6 of 25 `.vue` files contain a media query. Shell breaks (DASH-01); Backups and Config overflow (DASH-09); Mods table clips; `ViewHeader` actions never wrap (`flex: none`). Only Mod Config, wizard, Audit, Console, Analytics, Servers avoid overflow. | media-query grep; overflow metrics at 360/430 | `ViewHeader` wraps and stacks; `ResponsiveTable`/`CardList` component; one breakpoint token (760). |
| Buttons | Three button systems: PrimeVue `Button` (sizes mixed small/normal in one header: Config normal, Mod Config small, Backups small), raw `.btn/.mini/.pg/.add` in Mods, plain `<button class="nav-item">`. Severity use is inconsistent (Restore and Delete both `danger text`). | `ConfigView.vue:19-32`, `ModConfigView.vue:38-50`, `ModsView.vue:11-25` | One `AppButton` wrapper with `intent` (primary, neutral, warning, danger) and fixed header size. |
| Dialogs | Four confirm patterns: `ConfirmDialog` plain, typed dialog, native `window.confirm`, leave-guard dialog. Escape works on PrimeVue ones; focus handling differs. | `useServerActions.ts`, `ModsView.vue:800`, `App.vue:309`, `useConfigHistory.ts:46` | One `useConfirmAction({level, target, consequence, recovery})`. |
| Feedback | Mix of toast (22 call sites), inline `Message`, `StaleBanner`, ad-hoc `<p class="msg err">`. Load errors are often toast-only (Guilds, Mods, audit history). Success toasts are 3s with "Done". No `aria-live` region for toasts verified. Toast stack covers bottom-right controls (Console Send, Save on mobile). | `grep toast.add` = 22; `App.vue:151` | `InlineError` (message, cause, retry) for loads; toasts only for confirmations; `Toast` `position="top-right"` on desktop, top-center on mobile. |
| Navigation model | Flat 11-tab sidebar, no router, no breadcrumbs, unsaved guard only through `useEditableDocument` (Config, Commands, Guild editor); Mod Config and raw-JSON edits bypass it. `beforeunload` fires for the dev reload. | `useUnsavedGuard.ts`, `App.vue:309` | Hash router, all editors register dirty state (see DASH-03/04). |
| Density | Overview and Servers are sparse at 1440 (content ends at y=550 of 900, one card); Config is a single 480px column on a 1170px canvas; Mods is dense and good. `content-max` is 1720px so cards stretch. | `overview-desktop.png`, `config-desktop.png`, `style.css:45` | Max-width 1200 for forms; multi-column sections. |
| Headings and landmarks | `ViewHeader` renders `<h2>`; no `<h1>` on 10 of 11 views (axe moderate); `<main>`, `<nav>`, `<aside>` present; `landmark-unique` on Mod Config; empty `<th>` in Backups and Mods. | axe output; `ViewHeader.vue:3` | `ViewHeader` renders h1 (and sections h2). |
| Copy | 26 UI strings contain an em dash (banner, Commands, wizard help). "Save 1 change(s)". "Bot not running" chip next to a page-level "looks down" banner (two phrasings). Config subtitle is 2 lines of jargon ("schema-driven"). Server key title-cased ("Dev"). All dashboard strings are English literals: no `t()`, no locale switching, although config has `language` and the Discord side is bilingual. | `grep` count; `App.vue:109`, `ConfigView.vue:5-8` | Strings through a small `t()` over `@mcbot/core` locale files (decision needed: scope of dashboard i18n). |
| Theming | Dark only: `class="dark"` in `index.html`, `meta theme-color #15171a`; no `prefers-color-scheme`, no toggle, no `color-scheme` meta; scrollbars hand-styled for dark only. | `index.html:2,7,12`, `style.css:58-66` | Decide: document "dark only" in `docs/dev` or add light tokens (PrimeVue already has `darkModeSelector`). |

## e) What the Mods tab does right (spread these)

| Pattern | Where | Spread to |
|---|---|---|
| Long-running job as a first-class state: progress line with `role="status"`, failure with `role="alert"` naming the checked version, "Check again" to bypass cache, "results are stale, check again" note. | `ModsView.vue:77-92,119-130` | Server actions (start/restart/backup), backup restore, config apply. |
| Consequence copy at the control: "Disable without uninstalling (takes effect on next restart)", post-action toast "Restart the server to apply." | `ModsView.vue:354,389-393,781` | All confirms and toasts: say when and how a change applies. |
| Summary tiles that double as status (installed, version, loader, updates available with warn style). | `ModsView.vue:100-135` | Backups (count, newest, total size), Console, Analytics. |
| Per-row busy lock, so one slug cannot be double-submitted while others stay usable. | `ModsView.vue:235,380,388` | Backups (currently global `restoring/deleting` disables every row). |
| Distinct empty states per cause: loading, searching, no results, no mods, no blockers for version X. | `ModsView.vue:186-187,260-262,318-340` | Config filter results, Audit (filter empty vs none), Backups. |
| Count badge on the bulk action ("Apply all 3"). | `ModsView.vue:15-24` | Config "Save N changes" (already there), Commands. |
| Mod Config: `StaleBanner` with a write-specific note, queued edits banner with "Apply now", per-field `ConflictPicker`, "too many files" notice, read-only explanation, per-field dirty marker, filter with explanatory note, collapsible sections with `aria-expanded`, per-snapshot revert, range and default hints, display-label disambiguation. | `ModConfigView.vue:3-50,82-110,140-290`, `fieldLabels.ts` | Config editor and Guild editor (shared `EditorShell`). |
| Mod Config on 360px: file list stacks above the form, no overflow, inputs full width. | `modconfig-mobile360-full.png`, `ModConfigView.vue` media query | The pattern for every list+detail view. |
| Sticky action bar (Commands) and `view-fill` panes that own the scroll (Console, Mod Config). | `CommandsView.vue:509`, `App.vue:424-440,507` | Config, Backups. |

## f) Ranked top 25

Effort: S under half a day, M one to three days, L more than three. "Layer" is the component or shared module that fixes it once.

| Rank | ID | Sev | Issue | Effort | Fix layer |
|---|---|---|---|---|---|
| 1 | DASH-01 | blocker | Mobile shell: 530px sidebar block, tab change shows nothing | M | `App.vue` shell: top bar + Drawer nav, scroll reset |
| 2 | DASH-03 | major | Mod Config silently discards edits on file/server/tab switch | S | `useModConfigs` registers dirty; all selects use `confirmLeave` |
| 3 | DASH-04 | major | Raw JSON edits invisible to dirty guard, Discard disabled | S | `useConfig` / `useEditableDocument` raw baseline |
| 4 | DASH-05 | major | Invisible focus ring on all PrimeVue buttons and sidebar nav | S | Preset `focusRing` + global `:focus-visible` |
| 5 | DASH-06 | major | Primary button contrast 2.14:1; dim text 3.2 to 3.7:1 | S | `main.ts` preset `contrastColor`, `--mc-dim` token |
| 6 | DASH-08 | major | Audit/history timestamps off by the UTC offset | S | `core/utils/relativeTime.ts` `parseStamp` + tests |
| 7 | DASH-07 | major | Labels, icon buttons, hints unnamed (axe critical) | M | `FieldShell` for schema/mod fields; `FieldHint` label; `aria-label` lint |
| 8 | DASH-09 | major | Backups and Config overflow on phones; header actions never wrap | M | `ViewHeader` wrap + `ResponsiveTable`/`CardList` |
| 9 | DASH-10 | major | No control meets 44px touch size | M | Preset size tokens under `pointer: coarse` |
| 10 | DASH-11 | major | Four confirm patterns, native `confirm` in Mods, vague copy, typed input unfocused | M | `useConfirmAction` + `TypedConfirmDialog` autofocus |
| 11 | DASH-13 | major | Load errors toast-only; long actions have no progress; toasts cover controls | M | `InlineError`, `ActionJob` state, toast position |
| 12 | DASH-14 | major | Config editor: raw keys, 30+ flat fields, no search/TOC, errors far from field, actions not sticky | L | Schema titles + shared `EditorShell` (filter, sections, sticky bar) |
| 13 | DASH-12 | major | Mods is a styling and behaviour island and breaks at 360 and 1440 | L | Migrate to `ViewHeader`, `AppButton`, tokens, card list |
| 14 | DASH-02 | major | No deep links, refresh loses place, Back leaves app | M | Hash router in `App.vue` |
| 15 | DASH-15 | major | Secrets typed and shown in clear text | S | Schema `format: password` field renderer |
| 16 | DASH-20 | minor | Persistent bold banner on every page, jargon, no action | S | Compact `BotStatusBar` |
| 17 | DASH-21 | minor | Backups: unnamed row actions, no create, no tier filter, restore prerequisites unsaid | S | `BackupsView` + shared confirm copy |
| 18 | DASH-18 | minor | Config history hidden in Audit, load error swallowed, no diff | M | History drawer in Config; `InlineError` |
| 19 | DASH-23 | minor | Console log pane not an accessible log, composer unlabeled, no history/wrap | S | `ConsoleView` roles, wrap toggle |
| 20 | DASH-16 | minor | Two server pickers (sidebar and per view) | S | Remove in-view pickers, header chip |
| 21 | DASH-17 | minor | Guilds hint layout broken by flex on `<p>` | S | `GuildsView` CSS |
| 22 | DASH-22 | minor | `0d 12h 0m 0s` durations, bare dashes and "Unknown" in Analytics | S | `formatDuration` util |
| 23 | DASH-19 | minor | Dark-only, no theme decision documented | M | Tokens + doc, or light preset |
| 24 | DASH-24 | polish | 26 em dashes in UI copy, "change(s)", mixed bot-down phrasing, no dashboard i18n | S/M | Copy pass + `t()` decision |
| 25 | DASH-25 | polish | Nav: 11 flat items, duplicate icon for Config and Mod Config, no grouping | S | Grouped nav model in `App.vue` |

## Persona walk (short)

| Persona | Broke at |
|---|---|
| Alex (power user, keyboard) | 12 sidebar tab stops before content, no skip link, no shortcuts; Console has no command history; Mod Config file switch loses edits; no deep link to a server/file. |
| Sam (accessibility) | Invisible focus (DASH-05), 2.14:1 primary buttons (DASH-06), unlabeled fields (DASH-07), hint buttons all named "Help", log pane not focusable as a log. |
| Casey (phone) | Cannot see content after tapping nav (DASH-01), Backups and Config scroll sideways (DASH-09), Mods actions clipped, 33px buttons next to each other (Restore/Delete). |
| Riley (stress) | Raw JSON garbage leaves without a prompt (DASH-04), mod config edits vanish (DASH-03), Discord 401 reads as "No guilds configured yet." (DASH-13), history/rollback timestamps wrong (DASH-08). |

## Specificity and heuristics

Specificity: product-specific are the typed-confirm restore, stale-data banners with write notes, queued edits and conflict picker, per-snapshot revert, environment labels in Mods. Category-interchangeable are the sidebar shell, tile rows, Overview cards, and PrimeVue default controls. Heuristic read (0 to 4, 10 heuristics, no n/a): status visibility 2, real-world match 3, user control 2 (silent discards), consistency 1, error prevention 3 (typed confirms), recognition 2, flexibility 1, minimalist 3, error recovery 2, help 2. Total 21/40 = 53%, "acceptable, significant improvements needed". Mod Config alone would score about 30/40.

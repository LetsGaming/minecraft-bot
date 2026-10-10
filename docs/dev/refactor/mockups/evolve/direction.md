# Direction 2: Evolve

Wave 2, phase B. Static mockups in this folder, sample data throughout. Open `index.html` or `preview.html` (desktop and phone frames side by side, with a state picker per screen). Fonts are IBM Plex Sans and Plex Mono as local woff2 files under `fonts/` (SIL Open Font License, `fonts/OFL-IBM-Plex.txt`); without them the stack falls back to Segoe UI and system fonts.

## Direction contract

- **THESIS:** Same product, one visual language. The Mods tab's qualities (honest states, consequence copy, per-row busy) become tokens and components everywhere. Status is the system, and one motion, the state edge, shows what is changing. It refuses a redesign for its own sake: same navigation, same views, PrimeVue underneath.
- **WORLD:** Cool graphite neutrals, one teal accent, IBM Plex Sans and Plex Mono, 1px borders and no shadow except on overlays, status chips with distinct shapes (circle, diamond, ring, dash, dashed ring, check). Light and dark are both first class.
- **STORY:** An admin sees what is saved, what is applied, what waits for a restart, and trusts that each control says what it will do.
- **FIRST VIEWPORT:** Sidebar with one server picker. Breadcrumb, h1, a sticky edit bar with live state. Settings grouped on the left, filter on top, fields with label, key, help and inline error.
- **RISK:** It touches every view. Token migration is dull work and invites half-migrated screens.

Mode: Operate. Two distinctive axes: the status system with its state-driven motion, and the typographic scale. Everything else is conventional on purpose (sidebar, cards, tables, dialogs).

## What the mockups show

| Page | States demonstrated |
|---|---|
| `config.html` | clean, dirty with per-field marker and old value, validation error inline with group counts, conflict with per-field picker, saving, applied (edge flash plus toast), saved with restart pending, bot down status bar, read-only with reason. Plus filter with empty result, group navigation, secret field, raw JSON tab, review-changes dialog, history dialog |
| `mods.html` | installed list, loading, per-row busy and per-row applied, update check running ("Checking 14 of 62"), results with Ready, No build, Unknown badges and the blockers filter (functional), check failed with log tail, empty, load error with retry, remove confirmation (disruptive confirm) |
| `backups.html` | list with tier filter, loading, creating (job block), created (new row flash and toast), row busy (one row deleting), delete confirm (disruptive), restore confirm (irreversible, typed name), restoring (job with steps, sidebar shows server stopped), restore failed with recovery actions, empty, load error, read-only |
| `discord.html` | colour map, nine rules, then /status (online and offline), /server stop confirmation plus progress, error with recovery, permission denial, /players page 1, /mods page 1, downtime alert plus recovery with mention policy, chat bridge and events, /daily, whitelist application. EN and DE toggle; DE exists for status, stop, error, denial, alerts, daily and whitelist |

Third screen chosen: **Backups**. It carries the most audit findings that can be fixed visibly: DASH-09 (530px table on a phone), DASH-21 (unnamed row actions, no create, no tier filter, unstated restore prerequisites), the single confirm pattern at its hardest level (irreversible restore), the job-progress pattern for a long operation, per-row busy instead of one global flag, and the Discord twin of the same flow (`/server backup`, `createProgressEmbed`). Console would only show DASH-13 toast overlap and DASH-23. The guild wizard needs a Discord login to audit honestly.

All pages are static HTML with one stylesheet (`style.css`) on top of `tokens.css`, and a 100 line `app.js` for the state picker, drawer, dialogs, tabs and the theme and density toggles. The nav links to views that are not mocked (Overview, Servers, Console, Analytics, Mod config, Commands, Guilds, Audit) are rendered `aria-disabled` with a title, because their structure does not change.

## Design system in brief

Values live in `tokens.css`. Components read role names only.

### Colour roles

| Role | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0e1214` | `#f2f5f6` | page |
| `--surface` | `#151b1e` | `#ffffff` | cards, sidebar |
| `--surface-raised` | `#1c2428` | `#f7f9fa` | table header, inputs at rest, chips, code |
| `--border` | `#2a353b` | `#d0d9de` | one-pixel separators |
| `--border-strong` | `#5f7882` | `#7b8d96` | control outlines (3:1 or better) |
| `--text` | `#e9eef0` | `#12201f` | body |
| `--text-dim` | `#9fadb4` | `#4a5b62` | help, meta (7.5:1 and 7.1:1 on surface) |
| `--accent` | `#3cc8b4` | `#0b7468` | primary action, selection, dirty marker |
| `--on-accent` | `#04201b` | `#ffffff` | text on accent (8.2:1 and 5.7:1) |
| `--focus` | `#7fd9ff` | `#0b5fc4` | 2px focus ring with 2px offset |
| `--link` | `#7cc4ff` | `#0b5fc4` | links |

### Status roles (the system)

Each status has a foreground (text, dot) and a tint. Foreground on tint is 4.98:1 or better in both themes. The shape of the dot carries the state too, so colour is never the only signal.

| Status | Meaning | Shape | Dark fg | Light fg | Discord embed colour |
|---|---|---|---|---|---|
| online | running and answering | filled circle | `#4cd47a` | `#13783a` | `0x4CD47A` |
| degraded | not responding, warning, partial | diamond | `#f0b440` | `#8a5a00` | `0xF0B440` |
| offline | stopped, failed, denied | ring | `#ff6b66` | `#c0262d` | `0xFF6B66` |
| unknown | no data, plain event | dash | `#a3afb6` | `#566870` | `0xA3AFB6` |
| pending | waiting for you or for a restart | dashed ring | `#b7a1ff` | `#6a45d1` | `0xB7A1FF` |
| applied | done and live (same hue as online and success) | check | `#4cd47a` | `#13783a` | `0x4CD47A` |
| info | running job, neutral answer | filled circle, spins when busy | `#6bb8ff` | `#0b5fc4` | `0x6BB8FF` |

The accent (`#3cc8b4`) is a separate role. It is used for actions and for one Discord case, celebration. Embeds use the dark-theme foreground values because Discord renders embeds on a dark surface for most users.

### Type scale

IBM Plex Sans for UI, Plex Mono for keys, ids, file names and logs. Tabular numerals on everywhere. Ratio about 1.2, anchored on 14px because this is a dense admin tool. Inputs go to 16px under 760px so iOS does not zoom.

| Token | Size | Use |
|---|---|---|
| `--text-xs` | 12 | chip labels, table headers (caps, 0.06em), key lines |
| `--text-sm` | 13 | help text, secondary rows |
| `--text-md` | 14 | body, table cells, controls |
| `--text-lg` | 16 | touch inputs, mobile row titles |
| `--text-xl` | 19 | card titles |
| `--text-2xl` | 23 | page h1 (19 on phones) |
| `--text-3xl` | 28 | readouts: counts, uptime, TPS |

### Spacing, radius, elevation, motion

| Group | Rule |
|---|---|
| Spacing | `--space-1..7` = 4, 8, 12, 16, 24, 32, 48. Tight inside groups (4 to 8), 24 between cards, 12 to 16 inside cards |
| Radius | Two steps: 6 for controls and chips, 10 for cards and dialogs. Full for dots and switches |
| Elevation | One rule: surfaces are separated by a 1px border, never a shadow. Only overlays (dialog, toast, drawer) get a shadow. Two overlay shadows exist as one token |
| Z scale | sticky 10, nav 30, dialog 50, toast 60 |
| Density | Comfortable: control 36, row padding 10. Compact: control 30, row padding 5. Under `pointer: coarse` or 760px: control 44 regardless. Toggle in the sidebar footer, stored per browser |
| Breakpoints | 760 (nav becomes top bar and drawer, tables become cards, edit bar docks to the bottom), 1100 to 1180 (group navigation collapses to a select) |
| Motion signature | **The state edge.** Anything whose state is changing carries a 3px leading edge in its status colour. Running: the edge sweeps. Resolved: the edge flashes once at 6px and fades to rest in 900 ms, and the chip dot sends out one ring. Failed: the edge holds red. Pending or dirty: the edge holds. Nothing else animates, except the toast and dialog entrance (280 ms) and skeletons. `prefers-reduced-motion` turns the edge sweep into a static edge and removes the ring |

### Component set (mockup class, proposed Vue name)

| Component | Mockup | Proposed name |
|---|---|---|
| Page header with breadcrumb, h1, lede, actions | `.page-head`, `.crumbs` | extend `ViewHeader` |
| Section card | `.card` | `SectionCard` |
| Field row: label, key line, help, control, error, dirty marker, was-value | `.field` | `FieldRow` (wraps `FieldShell`) |
| Status chip with shape | `.chip--*` | extend `ConfigStatusChip` and `StatusDot` into `StatusChip` |
| Busy row and per-row edge | `tr.edge` | `useRowBusy` plus a CSS class |
| Empty state, error state with retry | `.state` | extend `EmptyState`, add `InlineError` |
| Confirm dialog, three levels | `dialog.dialog` | `useConfirmAction` over PrimeVue `Dialog`, `TypedConfirmDialog` becomes level 3 |
| Toast and inline banner | `.toast`, `.banner` | PrimeVue `Toast` with a position rule, `InlineBanner` (extend `StaleBanner`) |
| Data table, sticky header, card layout under 760 | `table.data` | `ResponsiveTable` |
| Job progress block | `.job` | `JobBlock` (steps, progress, log tail, retry) |
| Edit bar | `.editbar` | `EditBar` inside `EditorShell` |
| Filter chips, segmented control, search | `.filter`, `.seg`, `.search` | thin wrappers on PrimeVue `ToggleButton`, `SelectButton`, `InputText` |

## Navigation and URL model

Structure is unchanged: the same 11 views, sidebar on desktop. What changes is that it becomes addressable.

- Hash router, one route per view, server in the path where it applies: `#/overview`, `#/mods/smp`, `#/modconfig/smp/<fileId>`, `#/backups/smp`, `#/config`, `#/guilds/<guildId>`, `#/audit`. Back works, refresh keeps place, a link can be pasted into Discord. `confirmLeave` runs on route change.
- One server picker, at the top of the sidebar (a chip on the phone top bar). It replaces the per-view pickers (DASH-16). The route owns the server.
- Nav grouped Monitor (Overview, Servers, Console, Analytics), Manage (Mods, Mod config, Backups, Commands), Admin (Config, Guilds, Audit log). Eleven distinct icons (DASH-25).
- Breadcrumbs only where there is nesting: Manage / Mods, Admin / Config, and for the Mod config editor Manage / Mod config / smp / `lithium.properties`.
- Phone: sidebar becomes a drawer behind a 44px menu button in a sticky top bar that shows the page name and the server chip. Esc and outside click close it. I chose a top bar over a bottom tab bar because eleven destinations do not fit a tab bar and a drawer keeps one model.
- Edit bar docks to the bottom edge on phones so Save never scrolls away (DASH-14). Toasts go top center on phones and top right on desktop, and never over the dock.

## Dashboard i18n proposal

Add a `t()` seam now, English content only, in the frontend (`src/web/frontend/src/i18n.ts`) reading from the same flat `<area>.<name>` key scheme as `src/core/locales`. Strings with counts use `Intl.PluralRules`, no "(s)". Shared vocabulary (state labels, tier labels, feature names, durations) comes from one table in `@mcbot/schema` that both the bot and the dashboard read. Ship German for the dashboard only after the glossary of the audit (section 5) is agreed; until then the table is defined in English and German is fixed in the bot. This follows Q1 of the synthesis. The mockups are English only on the dashboard.

## Discord embed language

Shown in `discord.html`. Rules in brief:

1. **Colour is status**, 1:1 with the dashboard (table above). Green success and online, amber warning and not responding, red failure and offline and denial, grey unknown and plain events (join, leave, death), violet pending (confirmations, applications), blue info and running, teal accent for celebration only (challenge, reward).
2. **Titles** name the object or the action, sentence case, English and German. "Server stopped", "Could not reach smp". "Success" and "Error" only as a fallback.
3. **Emoji:** one leading emoji, only for server state (green, yellow, red, white circle). None in other titles, none replacing a button label.
4. **Fields:** answer first, then facts. Numbers inline, text full width. Limits guarded in the builder: 25 fields, 1024 per field, 4096 description, 256 title, 6000 total, 45 modal label.
5. **Footer:** empty by default. Server id only for multi-server guilds when the title does not say it. "Page n/m" sits on the pager row as a disabled button. No "Requested by".
6. **Timestamp:** only on live data (status, alerts). Times in text are Discord timestamps.
7. **Errors:** problem plus recovery in one or two sentences, no paths or ids for non-admins, always ephemeral.
8. **Ephemeral or public:** ephemeral for errors, denials, confirmations, personal data, config. Public for status, stats, leaderboards, moderation results. The admin check runs before the defer so a denial is never public.
9. **Mentions:** the alert role is pinged on first failure and when severity rises. Recoveries and repeats do not ping. `allowedMentions` is explicit on every alert and bridge message.
10. **Confirm pattern:** one button row (danger action plus Cancel) with a 60 s expiry noted in the footer. Pagination buttons turn disabled after 3 minutes instead of disappearing.
11. **German:** du-form, one word per concept ("Server" for Minecraft, "Discord-Server" for the guild, "Bot-Admin", "Kanal", "der API-Wrapper"). The German in the mockups is a proposal for a native read.

## Audit findings

### Fixed or visibly addressed by this direction

| Area | Ids | How |
|---|---|---|
| Shell and nav | DASH-01, DASH-02, DASH-16, DASH-20, DASH-25 | top bar and drawer under 760, hash routes, single server picker, grouped nav with distinct icons, bot-down as one status bar on the page rather than a persistent banner |
| Editors | DASH-03, DASH-04, DASH-14, DASH-15 | `EditBar` with dirty count, per-field marker, guard on leave including invalid raw text, grouping, filter, inline errors, secret fields masked with Reveal and a "never sent to the browser" line |
| A11y floor | DASH-05, DASH-06, DASH-07, DASH-10 | token pairs verified (below), 2px focus ring on every control, labels bound with generated ids, named icon buttons (`aria-label="Delete smp-daily-..."`), 44px under 760 and coarse pointers, axe clean on 14 states in both themes at 1440 and 390 |
| Confirm and feedback | DASH-11, DASH-13 | three confirm levels, inline error with retry, job block for long operations, toast position rule |
| Tables | DASH-09, DASH-12, DASH-21 | one `ResponsiveTable`, Mods and Backups on the same components, Restore and Delete visually distinct and named, create backup, tier filter, restore prerequisites in the dialog |
| Copy and misc | DASH-19, DASH-22, DASH-24 | light theme exists, duration format ("2 d 7 h"), no em dashes, "Save 3 changes" instead of "change(s)" |
| Discord | DISC-04, DISC-05, DISC-06, DISC-09, DISC-12, DISC-13, DISC-14, DISC-16, DISC-22, DISC-25 | embed paginator with limits, ephemeral config and denials before defer, mention policy, problem plus recovery, real titles, one confirm row, colour semantics, footer and timestamp rules |
| Discord, partly | DISC-07, DISC-08, DISC-11, DISC-15, DISC-19, DISC-23, DISC-24 | glossary and `formatDuration`, plural rule, pager row; the German grammar rewrites in DISC-08 and DISC-15 still need a native read |

DASH-08 (UTC stamps) and DISC-01 (German modal label) are hotfixes in the synthesis, independent of this direction. DISC-02 and DISC-03 are lifecycle fixes, also independent.

### Not fixed

DISC-10 (deleted webhook), DISC-17 (Discord to game formatting), DISC-18, 26, 27 (command consolidation and option naming, owner decision Q3), DISC-20 (autocomplete gaps), DISC-21 (guild-only contexts), DISC-28 to DISC-36 beyond the colour, footer and timestamp rules, DASH-17 (wizard hint layout, only incidentally), DASH-18 (rollback outside Audit, no diff), DASH-23 (console log semantics, composer label) except what falls out of the base components. The views Overview, Servers, Console, Analytics, Commands, Guilds, Audit and Mod config are not mocked; they inherit tokens and components and are assumed to follow without new design.

### Contrast, measured

Computed with the WCAG formula from the token values (not estimated): text on bg, surface and raised 13.5 to 16.8:1 in both themes; dim text 6.5 to 8.2:1; on-accent on accent 8.24:1 dark, 5.66:1 light; accent on surface 8.38 and 5.66; focus ring on surface 10.99 and 6.09; strong border on surface 3.45:1 in light and 3.72:1 in dark (3.37:1 on raised); every status foreground on its tint 4.98 to 6.79 dark, 4.85 to 5.34 light. axe-core 4.10.2 (wcag2a, wcag2aa, wcag21aa, best-practice) found no violations on config (dirty, error, conflict, pending), mods (results, checking, remove), backups (list, restore, delete, restore failed), discord, index and preview, dark and light, at 1440 and 390.

## Implementation impact

### (a) Effort estimate

**35 to 55 person-days**, most likely about 44. Reasoning, in person-days:

| Work | Days |
|---|---|
| Tokens, PrimeVue preset (dark and light), density, base components (`SectionCard`, `FieldRow`, `StatusChip`, `InlineError`, `InlineBanner`, `ResponsiveTable`, `JobBlock`, `EditBar`, `useConfirmAction`) with component tests | 7 to 10 |
| Router, shell, drawer, one server picker, deep links, leave guard on routes | 4 to 6 |
| Config editor shell (`EditorShell`, grouping, filter, schema titles and help, conflict, secret fields), Mod Config on the same shell | 6 to 8 |
| View migration: Mods (1574 lines, 25 raw colours, own buttons) 3 to 4, Backups 2 to 3, the other eight views 1 to 2 each (about 9 to 12) | 14 to 19 |
| Dashboard i18n seam and shared vocabulary table in `@mcbot/schema` | 2 to 3 |
| Discord builders and call sites (section d), locale keys EN and DE, German native review | 6 to 9 |
| Accessibility, phone pass, axe across all views, docs and changelog | 3 to 5 |
| Contingency inside the range for PrimeVue theming surprises | included |

The range is wide because the cost is dominated by the view migration and by how much of PrimeVue's own theming has to be bypassed. It is more work than Polish, which fixes the same floor values without a new component layer.

### (b) Risks

| Risk | Mitigation |
|---|---|
| Half-migrated product: some views on tokens, some on old colours, which looks worse than either | Land tokens and base components first behind no visible change, then migrate by flow, and add the lint rule banning raw hex in `.vue` files before the first migrated view |
| Light theme doubles contrast and screenshot testing | Contrast is already computed from the token table; run axe in both themes in CI for every view; ship light as "Auto" default only after one full pass |
| PrimeVue preset cannot express the chip shapes and edge motion | They are plain CSS on our own components; the preset only supplies colours, radius and focus ring |
| Plex fonts add about 110 KB and a licence file | Self-hosted woff2, `font-display: swap`, system fallback; drop to Segoe UI if size matters |
| Embed colour change surprises guilds used to green and red only | Changelog entry and a note in `docs/user`; colours come from one map so a guild-level override is possible later |
| Router change breaks bookmarks and the setup wizard flow | Keep tab state as the fallback for one release, map old URLs, test the wizard route |
| German strings are a proposal | Native read before release; the locale parity check and the new length test catch limits |
| Compact density and 44px coarse override conflict in tables | One variable (`--control-h`) drives both; verify at 760 with real row counts |

### (c) Component layer changes

New base components in `src/web/frontend/src/components/ui/`: `SectionCard`, `FieldRow` (with `FieldShell`), `StatusChip` (merges `ConfigStatusChip` and `StatusDot`), `InlineError`, `InlineBanner` (extends `StaleBanner`), `ResponsiveTable`, `JobBlock`, `EditBar`, `EditorShell`, `AppNav` and `TopBar`. New composables: `useConfirmAction`, `useRouteState`, `useRowBusy`, `useDensity`, `useTheme`. Existing `ViewHeader`, `EmptyState`, `TypedConfirmDialog`, `FieldHint` are extended, not replaced. Paradigm per file stays (Options stays Options, Composition stays Composition); new files follow the surrounding convention.

| View | Change | Notes |
|---|---|---|
| `App.vue` (524 lines) | L | shell, router, drawer, server picker, theme and density, skip link |
| `style.css` (75 lines) | M | replaced by `tokens.css` plus a small global layer |
| `main.ts` | M | PrimeVue preset for dark and light, focus ring, `contrastColor` removed |
| `ConfigView.vue` | L | `EditorShell`, groups, filter, `FieldRow`, `EditBar` |
| `components/schema/*` | L | `SchemaField` renders `FieldRow`, `format: password`, titles and help from schema |
| `ModConfigView.vue` | M | same shell, dirty guard (DASH-03), existing conflict picker kept |
| `ModsView.vue` | L | largest view, drop 25 raw colours and own buttons, single confirm, `JobBlock` for the compat check |
| `BackupsView.vue` | M | `ResponsiveTable`, per-row busy, create, tier filter, job block, typed confirm |
| `GuildsView.vue`, `SetupWizard.vue` | M | `FieldRow`, error state instead of "No guilds configured", hint layout |
| `CommandsView.vue` | M | empty state, dirty bar |
| `StatusView.vue`, `OverviewView.vue` | S to M | `StatusChip`, readouts on the type scale |
| `AnalyticsView.vue` | S to M | duration format, chart colours from status tokens |
| `ConsoleView.vue` | S to M | `role="log"`, labelled composer, toast position |
| `AuditView.vue` | S | table, relative time with absolute on hover |

PrimeVue: a custom preset (colour roles, two radii, focus ring, control heights) for dark and light. No second UI library.

New dependencies: **none required.** IBM Plex files are self-hosted assets (OFL), not an npm dependency. A `@fontsource` package would be optional if the team prefers npm to vendoring, at the same size.

### (d) Bot embed and reply builder changes

Existing code in `src/bot/utils/embeds/`: `embedColors.ts` (`EmbedColor`), `embedUtils.ts` (`createEmbed`, `createErrorEmbed`, `createSuccessEmbed`, `createInfoEmbed`, `createEmbedWithThumbnail`, `createPlayerEmbed`, `createPaginationButtons`, `handlePagination`, `addFieldsBulk`), `serverStateDisplay.ts` (`describeState`, `describeHealth`, `describePlayers`), `statEmbeds.ts` (`buildLeaderboardEmbed`, `buildStatsEmbeds`), `alertUtils.ts` (`roleMention`).

Changes:

- `embedColors.ts`: replace the mixed palette (`Success 0x55ff55`, `Error 0xff5555`, `Info 0x00bfff`, `Critical`, `Gold`, `Challenge purple`, brand colours) with the status map above plus `statusColor(state)`. Keep brand colours only where they are external (Modrinth). Colours move to `@mcbot/schema` so the dashboard reads the same values.
- `embedUtils.ts`: `createErrorEmbed` takes `{problem, recovery, hint?}` and always sets red; `createSuccessEmbed` and `createInfoEmbed` stop adding default "Success"/"Info" titles and footers; add `createDeniedEmbed`, `createConfirmEmbed` plus `createConfirmRow` (danger button, Cancel, 60 s expiry), `createProgressEmbed`, `paginateFields` (limit-aware), `pageFooter` and a disabled-after-3-minutes rule in `handlePagination`.
- `serverStateDisplay.ts`: `describeState` returns colour from `statusColor`, the single leading emoji, and the label; `/uptime` and `/status` both use it.
- `alertUtils.ts`: `roleMention` gains severity memory (`shouldPing(previous, next)`) and returns explicit `allowedMentions`; recovery embeds never ping.
- Shared helpers added to `@mcbot/core`: `formatDuration` (two largest units, localised), `replyError`/`replyDenied` (ephemeral by construction), plural helper over `Intl.PluralRules`. In `@mcbot/schema`: status table, tier labels, feature names, glossary keys.
- Call sites, counted by grep on `src/bot` at the time of writing: 62 `new EmbedBuilder` or `createEmbed(` in 38 files, 61 `EmbedColor.` references, 68 `createErrorEmbed`/`createSuccessEmbed`/`createInfoEmbed` calls, 14 `setFooter`, 19 `ephemeral` flags, 4 `ButtonBuilder` files, 4 `allowedMentions` sites. Expect about 90 to 110 call-site edits; roughly 40 are mechanical (error and success helpers get the new shape), about 25 need a human decision on title and recovery text.
- Locale impact: about 60 to 90 new or rewritten keys per language (error recovery sentences, confirm text, state labels, glossary), and the 14 footer strings and about 20 generic titles removed. The existing 495 keys stay in parity. A new test asserts modal labels and titles at most 45 characters and builds each modal under `de`. `npm run i18n:check` stays the gate.

### (e) Proposed phase breakdown for Phase C

Each phase is one PR, mergeable on its own.

1. **Tokens and base components (about 8 days).** `tokens.css`, PrimeVue preset, fonts, theme and density composables, `StatusChip`, `FieldRow`, `SectionCard`, `InlineError`, `InlineBanner`, `ResponsiveTable`, `JobBlock`, `useConfirmAction`, the lint rule for raw hex. No view changes yet except the shell skip link and focus ring.
2. **Shell and navigation (about 5 days).** Router, top bar and drawer, server picker, grouped nav. Interim hotfix for DASH-01 is replaced here.
3. **Config editing (about 7 days).** `EditorShell`, `EditBar`, grouping, filter, secret fields, conflict, dirty guard; then Mod Config on the same shell.
4. **Discord builders (about 8 days).** Colour map, `createErrorEmbed` shape, confirm row and progress embed, `paginateFields`, mention policy, glossary, EN and DE keys, limits test. Can run in parallel with phases 2 and 3 because it touches only `src/bot` and shared packages.
5. **Remaining screens (about 14 days).** Mods, Backups, then Guilds, Commands, Status, Overview, Analytics, Console, Audit. Ends with a full axe pass in both themes, a phone pass, docs and changelog.
6. **Dashboard i18n seam (about 3 days),** can slot in after phase 1.

### (f) What it would not fix

- Anything about command structure: the 45 commands, duplicates and renames (DISC-18, 26, 27) stay as they are.
- Webhook failure handling, Discord to game formatting, autocomplete gaps (DISC-10, 17, 20).
- Real-device and screen reader behaviour; those need a phone pass and one NVDA pass.
- Live Discord rendering of embeds (width, wrapping, button layout on phones).
- Back-end behaviour: long actions still need the wrapper to report steps for `JobBlock` to be truthful; the mockup assumes it does, and where it only returns done or failed the block shows two steps.
- The German copy is a proposal, not reviewed by a native speaker.

## Review gate

**Cover the logo.** The sidebar, cards and tables are a standard admin shell, so with the logo covered it could be many tools. What is ours is the combination: shaped status chips, the key line under every field, the edge on rows and bars, the Plex type. That is a modest amount of identity. It is deliberate (Operate mode), and also a weakness: a screenshot alone does not say "Minecraft bot".

**Three decisions a model would not make by default.**
1. One motion only, the state edge, applied to rows, the edit bar, job blocks and fields, instead of fades on everything. It makes "changing" and "just resolved" readable without text, and everything else stays still.
2. Status chips carry shape as well as colour (circle, diamond, ring, dash, dashed ring, check), and the same seven colours are the Discord embed colours. Colour-blind users and screenshots without colour keep working, and a status means the same thing in the channel and in the panel.
3. Every field shows its real config key in mono under the label, and a dirty field shows the old value with a Reset link and a consequence line ("Alerts will fire earlier"). A default design would hide the key as noise; for an admin who edits `config.json` by hand it is the thing they search for.
4. (Extra) Two separate states for "saved but waiting for restart" (pending, dashed ring) and "applied" (check), because a config editor that says "Saved" when `webui.port` has not taken effect is lying.

**States matrix.** Config: loading is not shown (the schema is bundled, so there is none), empty is the filter-no-result state, error, partial (pending), busy (saving), success (applied), read-only, conflict and dirty are all shown, long content shows in the key lines and the admins textarea. Mods and Backups: loading, empty, error, busy, success, read-only (Backups), conflict (n/a) and the long-list case (10 of 62 and 10 of 18 rows shown; 500 rows only reasoned about, not rendered). Weak spots: no 500-item render, no config loading skeleton, Mods read-only is not drawn.

**Squint test.** Desktop: the edit bar and the active card read first, then the left group list, then fields. Status chips pop as the only small coloured things. Mobile: the docked edit bar is the strongest element, which is right. On the Mods results page the three metric tiles and the amber banner compete; the banner is the right winner but the tiles are close.

**Numbers.** Every count is sample data and internally consistent (47 + 9 + 6 = 62; 18 backups listed as 3 + 7 + 2 + 1 + 5; "Showing 10 of 62" says it is a sample). No uptime or latency claims beyond the labelled sample values.

**Links and buttons.** The nav entries for unmocked views are disabled and say why. Most action buttons are inert by design (static mockup). `Open health`, `Open project`, `Backup schedule` and similar are `#`.

**Weak or unverified.**
- The 360 and 430 widths were checked for horizontal overflow (none) and 44px targets; 430 got no separate visual review.
- The mobile top bar has no bottom tab bar, so reaching Backups takes two taps. I judge that acceptable for an admin tool but have not tested it on a phone.
- The mock bar and state picker are not part of the product and take vertical space in screenshots.
- Light theme is exercised by axe and screenshots, but less looked at than dark; the teal accent in light (`#0b7468`) is a heavier green than the dark one.
- PrimeVue fidelity: the mockups are plain HTML. How closely a PrimeVue `DataTable`, `Dialog` and `Select` can match these shapes is an assumption, not a test.
- Discord panes are an approximation. German is unreviewed. The `/mods` and `/players` pages show one page only.

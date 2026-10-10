# Direction 1: Polish

Mockups: open `index.html` (or `preview.html` for 1440 and phone frames side by side). Everything here is static HTML and CSS with a little vanilla JS for the state switcher, drawer, dialogs and filters. Sample data throughout.

## Direction contract

- **THESIS.** The same app, but correct. The owner should recognise it at once: dark charcoal, green accent, sidebar, PrimeVue vocabulary. The change is that tokens, states, labels, touch targets and navigation stop failing. Refuses the redesign: no new identity, no new layout paradigm. Distinctive axes (operate mode, two at most): precision of states, and density.
- **WORLD.** Surfaces `#15171a` to `#22252a`, one green accent `#34c56a` with dark text on it, status colours that each mean one thing, system fonts, 10px radius, hairline borders, flat (no gradients, no glass).
- **STORY.** An admin opens a screen, sees what is wrong, unsaved or busy at a glance, acts on one row without losing the others, and always knows whether the bot has applied the change.
- **FIRST VIEWPORT.** Sidebar (drawer under 760px), view title with a one-line purpose and the primary action top right, a state chip or banner directly under it, then search and filters above the work area. A sticky action bar carries unsaved work.
- **RISK.** It keeps the current identity's weaknesses (see "What this direction keeps"). If the owner wants the product to feel designed rather than corrected, this is a lateral move that costs 30 or more person-days.

## What I deliberately did NOT change

| Kept as is | Why |
|---|---|
| Dark theme only, same surface ramp, same green | Owner familiarity, lowest risk. Light tokens stay possible because roles are named by meaning (DASH-19 is documented, not solved). |
| Left sidebar on desktop | It works at 1440. Only the phone model changes (top bar and drawer). |
| System font stack, 15px body | No webfont cost, no licence, no FOUT. Distinctive type would be a third axis; the mode (operate) does not need it. |
| Card-on-surface structure, 10px and 7px radii, hairline borders | Same visual density the owner already uses. Only the border colour of controls changes (3:1 rule). |
| Two-card Mods concept (catalogue plus installed) | Same concept and vocabulary. Only the order changed (installed first), see decision 1 below. |
| Discord embed shapes and the bot's current palette (`EmbedColor`: success `0x55ff55`, error `0xff5555`, info `0x00bfff`, warning `0xffaa00`) | The messages must look the same to members. Changes are meaning (which colour for which state), titles, footers and error text. |
| Discord command tree (45 commands) | DISC-18 needs an owner decision (Q3). |
| PrimeVue as component base, Options or Composition per file | Hard project constraint. |

Where I stayed conventional on purpose: palette (only the dim text and on-accent values change), type, icons (outline set, one per nav item), layout grid, motion (120 ms colour transitions, one drawer slide, all disabled under `prefers-reduced-motion`), table styling. Each of these is a place where spending budget would not help an admin finish a task.

## What this direction keeps (honest weaknesses)

1. **Generic admin look.** Cover the logo and this could be any self-hosted dashboard. Nothing says Minecraft or this bot. That is the cost of "same app".
2. **Dark only.** Documented, not solved. Anyone in a bright room or on a phone outdoors gets the same low-luminance UI.
3. **Dense, text-heavy screens.** Config remains a long list of settings. Search, grouping and the table of contents make it navigable, they do not make it light.
4. **No brand voice.** Copy gets cleaner (problem plus recovery, no em dashes, no "(s)"), but there is no personality layer.
5. **Dashboard and Discord still look unrelated.** They share vocabulary and status meaning, not a visual language.
6. **PrimeVue's look underneath.** Inputs, dialogs and the data table still inherit PrimeVue structure; the preset only tunes them. Pixel parity with these mockups needs per-component overrides (listed under impact).

## Design system in brief

Source of truth: `tokens.css`. Values below are what it defines.

### Colour roles

| Role | Token | Value | Meaning and contrast |
|---|---|---|---|
| Background | `--bg` | `#15171a` | Page |
| Surface | `--surface` | `#191b1f` | Sidebar, top bar |
| Card | `--card` | `#22252a` | Cards, dialogs |
| Raised | `--raised` | `#2a2e34` | Sticky bar, toasts, hover |
| Border | `--border` | `#2f343b` | Decoration only |
| Control border | `--border-control` | `#6f7885` | Edge of inputs, toggles, buttons. 3.2:1 on card, 3.8:1 on bg |
| Text | `--text` | `#e7e9ec` | 13.6:1 on card |
| Dim text | `--text-dim` | `#9aa1ac` | 5.9:1 on card, 6.9:1 on bg (today `#6b7280`, 3.2:1) |
| Accent | `--accent` | `#34c56a` | Primary action, selection, 7.0:1 on card |
| On accent | `--on-accent` | `#06210f` | Text on accent fill, 7.6:1 (today `#eafff0`, 2.15:1) |
| Focus | `--focus` | `#8cc8ff` | Ring. 3:1 or more against bg, card, accent and danger fills. Blue on purpose, so it stays visible on a green button |
| Link | `--link` | accent | |

### Status colours (meaning is fixed, text label always present)

| Meaning | Foreground | Tint | Used for |
|---|---|---|---|
| Online, success, ready, applied | `--ok` `#4ade80` | `#16301f` | Online, Up to date, Ready, Applied |
| Not responding, warning, pending | `--wait` `#fbbf24` | `#33290f` | Not responding, conflict, saved but not reloaded, Unknown (needs a look) |
| Offline, failure, blocker | `--bad` `#f87171` | `#351a1a` | Offline, errors, Missing |
| Unknown, disabled, neutral | `--unknown` `#9aa1ac` | `#2a2e34` | State unknown, Disabled, tier labels |
| Info, edited | `--info` `#7cb4ff` | `#172335` | Not saved yet, update available |
| Danger fill | `--danger` `#e05858` | text `--on-danger` `#1d0707`, 4.9:1 | Destructive confirm button |

### Type, space, shape

| Token group | Values |
|---|---|
| Type scale | xs 12 (labels, badges only), sm 14 (dense tables, hints), md 15 (body), lg 18 (card titles), xl 24 (`h1`), 2xl 30 (stat figures). Inputs 16px under 760 |
| Spacing | 4, 8, 12, 16, 24, 32 (`--space-1..6`) |
| Radius | 10px (cards, dialogs), 7px (controls) |
| Elevation | 1: none (flat on page), 2: `0 4px 12px` (sticky bar, toast), 3: `0 12px 32px` (dialog, drawer) |
| z-index | sticky 10, drawer 40, dialog 50, toast 60 |
| Control height | 36px fine pointer, 44px under `pointer: coarse` or under 760px |
| Breakpoints | 760 (nav and tables), 1180 (editor and wide layouts), 1700 (Mods two columns) |
| Motion | 120ms ease-out for colour and transform, one drawer slide (180ms), progress and spinner only. Removed under `prefers-reduced-motion` |

### One confirm pattern, one feedback pattern

- Confirm levels: inform (single click, then toast), disruptive (dialog: Remove mod, Stop, Restart, Leave without saving), irreversible (dialog plus typed word: Restore, Delete, Rollback). Every dialog states target, when it applies, and how to undo. See `mods.html?state=confirm`, `backups.html?state=restore`, `config.html?state=guard`. No native `window.confirm`.
- Feedback: load failure is inline with Retry in the place the data belongs, success is a toast that says what and when it applies, failure is inline near the control, long jobs are a card with steps, a bar and a log tail, system conditions are one status bar line. Toasts sit top right on desktop and top centre under the top bar on phones, so they never cover the Send or Save controls.

## Navigation and URL model

- Under 760px: 56px top bar with a menu button (44px), the view title and one server chip. The sidebar becomes a drawer (`aria-expanded`, Esc closes, scrim closes, focus moves in and returns). Nothing renders as a 530px block.
- One server selector: the chip in the sidebar (desktop) or top bar (phone). No per-view pickers.
- Nav grouped Monitor (Overview, Analytics, Console, Audit log), Manage (Servers, Backups, Mods, Mod config), Admin (Config, Commands, Guilds). Eleven distinct icons.
- Hash routes with deep links: `#/overview`, `#/servers/<server>`, `#/mods/<server>`, `#/mods/<server>?check=1.21.5&filter=blockers`, `#/modconfig/<server>/<fileId>`, `#/backups/<server>?tier=daily`, `#/config?q=apiUrl`, `#/config/raw`, `#/guilds/<id>`, `#/audit`. Back works, refresh keeps place, one `confirmLeave` guard on every route change and on `beforeunload`.
- Bot-down and stale data are one compact status line under the top of the content, with a link to Overview, not a persistent paragraph.

## Dashboard i18n proposal

Answer to Q1 within this direction: add the seam now, ship English only.

- `src/web/frontend/src/i18n.ts` exports `t(key, params)` and plural support through `Intl.PluralRules` (no "(s)").
- Flat `<area>.<name>` keys in `src/web/frontend/src/locales/en.ts`, same convention as `src/core/locales`.
- Shared glossary (server, Discord server, bot admin, four states, tier labels, feature names, duration format) lives in `@mcbot/schema` as plain data with `en` and `de`. Both the bot and the dashboard read it, so the terms in section 5 of the audit stop drifting.
- Language comes from a per-user setting later; until a German dashboard file exists the dashboard resolves to English. No concatenated sentences.
- Cost of the seam is about 1 to 2 person-days; moving all existing literals is a gradual follow-up.

## Discord embed language (what `discord.html` shows)

| Topic | Rule |
|---|---|
| Colour | Green success and online, red failure and offline only, amber warning, needs a decision and not responding, blue info and neutral answers, grey events (join, leave, death, stop) and unknown, one purple celebration accent (challenge advancement). Same hues as today. |
| Titles | Action or object, sentence case, both languages ("Could not load stats", "Stop smp?"). "Success" and "Error" only as fallback. |
| Emoji | One leading status circle for server state in `/status` and alert titles. None decorative. Buttons carry text, never emoji only. |
| Footers | `Page n/m` through one `pageFooter` helper, or an id that is needed (Application 41). No "Requested by", no title echo. Timestamp only on live data (status, alerts, whitelist application). |
| Field order | Identity first (who, what), then measures, then free text last. At most 3 inline per row. |
| Ephemeral vs public | Ephemeral: errors, denials, confirmations, personal results (`/daily`, `/stats` errors). Public: status, lists, moderation outcomes, bridge. Admin check runs before the defer so denials are ephemeral. |
| Error format | Problem, cause if known, recovery, one or two sentences. No config path or internal id to non-admins. |
| Mentions | Role ping on first failure only. Recoveries, repeats and the bridge never ping. `allowedMentions` explicit on every send. |
| Confirm | `/server stop` and `restart` show an ephemeral amber confirmation with a danger button and Cancel, expiring in 60 seconds. |
| Pagination | `Previous`, `n/m` (disabled), `Next`, text labels; buttons disabled (not removed) after 3 minutes. |
| German | du-form, "Bot-Admin", "Discord-Server" for the Discord side, "Server" for Minecraft, "Kanal", "der API-Wrapper". |

Rendering in `discord.html` is an HTML approximation of Discord's dark theme, not a capture. German is shown for nine of the eleven message types.

## Findings fixed, and not

### Dashboard (DASH)

| Id | Status | How |
|---|---|---|
| DASH-01 | fixed | Top bar and drawer under 760, no 530px block, scroll reset on navigation |
| DASH-02 | fixed in design | Hash routes with deep links (needs the router work in impact) |
| DASH-03 | fixed in design | Mod Config uses the same editor shell: dirty marker, guard on file, server and tab switch |
| DASH-04 | fixed | Raw JSON state: invalid text counts as dirty, Discard enabled, guard on leave (`config.html?state=raw`) |
| DASH-05, 06 | fixed | `--on-accent`, `--text-dim`, `--focus` ring, skip link, verified |
| DASH-07 | fixed | Every field has a bound label, `aria-describedby` for hint and error; icon buttons name their target ("Remove 3120...", "Revert tpsWarningThreshold") |
| DASH-08 | not a design item | Hotfix in `parseStamp`; times shown in the viewer's zone with the zone printed once (Backups header) |
| DASH-09, 10 | fixed | Rows become cards under 760, header actions wrap, 44px targets under 760 or coarse pointer |
| DASH-11 | fixed | Three-level confirm, typed confirm autofocus, no `window.confirm` |
| DASH-12 | fixed in design | Mods uses shared tokens, shared button, one `h1`, no raw hex, works at 360 and 1440 |
| DASH-13 | fixed | Inline `InlineError` with Retry, per-state empties, toasts moved |
| DASH-14 | fixed | Search, groups, table of contents, inline errors, dirty markers, sticky action bar, "Save 5 changes" |
| DASH-15 | fixed | Secrets are password fields with Show, "Stored. Type a new value to replace it" |
| DASH-16, 20, 25 | fixed | One server chip, one status line, grouped nav with distinct icons |
| DASH-21 | fixed in Backups | Named row actions, create, tier filter, restore prerequisites in the dialog |
| DASH-24 | fixed in the mockups | No em dashes, no "change(s)" |
| DASH-17 | not shown | Guild wizard not mocked; the hint fix is a one-line CSS change |
| DASH-18 | partly | History link exists on Config; rollback entry point and diff not designed |
| DASH-19 | documented only | Dark only |
| DASH-22, 23 | not shown | Analytics durations and Console are not mocked. `formatDuration` and the `role="log"` pattern (used in the restore log tail) apply, nothing else is designed |

### Discord (DISC)

| Id | Status | How |
|---|---|---|
| DISC-01 | fixed (locale) | Shorter DE label; length test. Shown in the whitelist message note |
| DISC-02 | fixed in code, not visible | Defer before RCON, noted on the `/daily` message |
| DISC-03, 12, 13 | fixed | Error format, specific titles, localised fallback |
| DISC-04 | fixed | `paginateFields` with 6000 guard (shown on `/mods`) |
| DISC-05, 06 | fixed | Ephemeral config and one denial shape before the defer |
| DISC-09 | fixed | Ping on first failure only, recovery states duration |
| DISC-14 | fixed | Confirmation with expiry |
| DISC-16, 22, 25 | fixed | Colour semantics, status colours by state, footers and timestamps |
| DISC-19 | fixed | Text button labels and a page indicator |
| DISC-23 | partly | Plural through `Intl.PluralRules`; the 36 strings still need a pass |
| DISC-07, 08, 15 | not fixed here | German grammar and wrapper wording need a native read |
| DISC-10, 17 | not fixed | Deleted-webhook handling and Discord-to-game formatting are bridge logic, not visual |
| DISC-11, 18, 20, 21, 24, 26, 27 | not fixed | `/help` structure, command consolidation (Q3), autocomplete, guild-only contexts, locale dashes, option naming |
| DISC-28 to 36 | not fixed | Backlog, except colours and timestamp style where touched |

## Implementation impact

### (a) Effort in person-days

| Block | Days | Reasoning |
|---|---|---|
| Tokens, PrimeVue preset, focus, targets, hex lint | 1.5 to 2 | One preset and one CSS file, then fix visible breakage in 11 views |
| App shell: top bar, drawer, grouped nav, hash router, `confirmLeave` | 3 to 4 | `App.vue` is 524 lines with the current tab switch; router plus guards plus tests |
| Base components (list in (c)) | 5 to 7 | Ten components with tests and a11y checks |
| Config and Mod Config on `EditorShell` | 5 to 7 | Search, groups, markers, conflict picker, raw state, schema titles in `@mcbot/schema` |
| Mods migration (1,574 lines) | 3 to 5 | Behaviour kept, markup and styles replaced, update-check progress UI added |
| Backups | 2 to 3 | Cards under 760, row busy, restore job card, typed confirm |
| Remaining views (Overview, Servers, Console, Analytics, Commands, Guilds, Audit) | 4 to 6 | Light pass: headers, inline errors, labels, copy, durations |
| Dashboard i18n seam and glossary | 1 to 2 | |
| Discord builders and call-site sweep | 6 to 8 | See (d) |
| Discord locale (EN and DE) and tests | 3 to 4 | New keys, limit tests, German read |
| Verification: axe on 11 views, 360 to 1440, keyboard walk | 2 to 3 | |
| **Total** | **35.5 to 51** | **Plan for 38 to 48, call it 8 to 10 working weeks for one person.** |

The hotfix list in audit section 7 (about 3 days) is separate and should ship first. This estimate excludes the C0 hotfixes (the phase table adds them as 3 days, so phases C0 to C6 sum to 38 to 53) and does not include native German review or a real-device pass.

### (b) Risks

| Risk | Mitigation |
|---|---|
| Wide blast radius: tokens and preset touch every view | Land tokens and preset first behind the existing layout, run axe and screenshot diffs before any component work |
| Hash router changes `App.vue` state flow and the unsaved guard | Keep tab state and route in sync through one store; keep `useUnsavedGuard`; add route-leave tests before merging |
| Mods rewrite regresses the best flow | Characterisation tests for `useMods` and the compat job first; migrate markup only |
| Schema titles and groups need content for 30 plus fields | Fallback to humanised key plus raw key; add titles in `@mcbot/schema` gradually |
| Discord colour and footer change touches about 30 files | Do it through `createEmbed` defaults and a few helpers, not by hand-editing each call |
| Role ping policy changes who is woken (Q6) | Needs owner sign-off before it ships; make it a config flag with the new behaviour default |
| Mockups are not PrimeVue; pixels will differ | Treat the HTML as the contract for tokens, states and copy, not for exact spacing |
| Restore safety copy and job steps are proposals, not existing wrapper behaviour | Confirm with the wrapper API before building the dialog copy |

### (c) Component layer

New base components (dashboard, `src/web/frontend/src/components/ui/`):

`AppShell` (top bar, drawer, sidebar), `NavGroup`, `StatusBar`, `FieldShell` (id, label, hint, error, dirty marker, revert), `EditorShell` (search, table of contents, groups, sticky action bar, guard), `InlineError`, `EmptyState` (exists, extend with cause and next step), `ConfirmDialog` plus `useConfirmAction` (extends `useTypedConfirm`, three levels), `ActionJob` (steps, progress, log tail), `ResponsiveTable` (table to card list at 760), `StatusBadge` (four states plus ok, warn, bad, info, with icon and text), `ConfigStatusChip` (exists, extend with applied, pending, bot down).

Existing views:

| View | Change | Notes |
|---|---|---|
| `App.vue` | L | Shell, router, drawer, status line |
| `ConfigView.vue` | L | Editor shell, groups, search, raw state, schema titles |
| `ModConfigView.vue` | M | Shared editor shell, guard on file switch (DASH-03) |
| `ModsView.vue` | L | Replace 50 raw colours and own buttons, `h1` to `ViewHeader`, confirm, inline error, installed first |
| `BackupsView.vue` | M | Cards, per-row busy, create, tier filter, job card, typed confirm |
| `StatusView.vue` | M | Four states, job progress for start, stop, restart |
| `OverviewView.vue` | S | Header, states |
| `ConsoleView.vue` | M | Log role, labelled composer, toast position |
| `AnalyticsView.vue` | S | Durations, empty values |
| `CommandsView.vue` | M | Empty state, labels, guard |
| `GuildsView.vue`, `SetupWizard.vue` | M | Error versus empty, hint fix |
| `AuditView.vue` | S | Timestamps, history load failure inline |
| `components/schema/*` | M | `FieldShell` through `SchemaField` |

PrimeVue preset and theme (`main.ts`, `style.css`): `contrastColor` to `--on-accent`; `focusRing` 2px `--focus` with 2px offset; `formField.borderColor` to `--border-control`; coarse-pointer size overrides on button, input and select; dim text token; toast position and breakpoint config; ESLint rule banning raw hex in `.vue` files.

New dependencies: `vue-router` (hash history, route guards, about 20 KB) is the only one recommended; a hand-rolled router would reimplement `beforeEach` and back handling. No icon, font or UI library is added (PrimeIcons plus the existing set cover the 24 icons used).

### (d) Bot builders and replies

Counts from `src/bot` (grep, current branch): `createEmbed(` 60 call sites, `createErrorEmbed` 32, `createSuccessEmbed` 29, `createInfoEmbed` 4, `EmbedColor.` 61 references in 30 files, `setFooter` 14, `createPaginationButtons` 14, `handlePagination` 13, `setLabel(` 13, `allowedMentions` 4, `.reply(` and `.editReply(` 125, command files using `withErrorHandling` or `requireServerAdmin` 34 of 47.

Functions to change in `src/bot/utils/embeds/embedUtils.ts` and `embedColors.ts`:

- `createEmbed`: default `timestamp` to false (today true), accept a state for the status circle.
- `createErrorEmbed`, `createSuccessEmbed`, `createInfoEmbed`: require a specific title, error variant takes `{ problem, recovery }`.
- New: `replyError(interaction, { title, problem, recovery })` (ephemeral, localised), `createConfirmRow` with expiry, `createProgressEmbed`, `pageFooter(page, total, noun)`, `paginateFields` with 6000 guard, `statusCircle(state)`, `describeState`, `formatDuration` in `@mcbot/core`, `safeMentions(kind)` for `allowedMentions`.
- `EmbedColor`: keep values, add `Event` (grey) semantic alias and move leave, death, stop off `Error`.
- Dispatcher in `src/bot/index.ts` and `middleware.ts`: admin check before defer, one denial shape, localised fallback.

Call sites that change: roughly 30 command and interaction files for colour and title, 14 for footers, 13 for pagination, 34 for the error wrapper, 4 for mentions plus alert callers. Locale impact: about 70 to 100 existing keys edited per language (titles, error text, de fixes) and about 25 new keys per language (confirm, recovery, page footer, glossary terms), plus a new locale test for the 45 character modal limit and the 256 title limit. `npm run i18n:check` stays green because both files change together.

### (e) Phase breakdown for Phase C

| Phase | Content | Days |
|---|---|---|
| C0 | Audit section 7 hotfixes (independent, ship first) | 3 |
| C1 | Tokens, PrimeVue preset, focus ring, hex lint, skip link, shell with drawer and hash router, `confirmLeave` | 5 to 7 |
| C2 | Base components (`FieldShell`, `InlineError`, `ConfirmDialog`, `ActionJob`, `ResponsiveTable`, `StatusBadge`, `StatusBar`) with tests | 5 to 7 |
| C3 | Config and Mod Config on `EditorShell`, schema titles, raw state, conflict picker, DASH-03 and 04 | 5 to 7 |
| C4 | Discord builders: `createEmbed` defaults, `replyError`, confirm row, pagination, mention policy, locale keys and tests | 8 to 11 |
| C5 | Mods, Backups, then the remaining views, dashboard i18n seam | 10 to 15 |
| C6 | Verification: axe on every view, 360 to 1440, keyboard walk, phone and screen reader pass (Q9), test guild pass (Q10) | 2 to 3 |

Each phase is PR-able on its own and leaves the app working. C1 and C4 are independent and can run in parallel.

### (f) What this direction would not fix

- The product still has no identity (weakness 1) and no light theme.
- Config is still long. Search and grouping help; progressive disclosure of rare settings is not designed.
- Discord command sprawl (DISC-18), `/help` structure, autocomplete gaps, DE grammar rewrites (DISC-07, 08, 15) and bridge logic (DISC-10, 17).
- Wrapper and backend behaviour the mockups assume: the pre-restore safety copy, job step reporting, a "bot has reloaded" signal for the Applied and Pending chip, the per-field conflict data.
- Nothing here was checked against a screen reader, a real phone or live Discord.

## Review gate

**Cover the logo.** Fails, and that is the honest answer. The Backups page could belong to any admin panel. What is specific is content (smp, creative, Fabric 1.21.x, the real config keys) and meaning (the status colours, the "Applied" chip), not form.

**Three decisions a model would not have made by default.**
1. Installed mods come first on desktop, catalogue second. A model copies the current two-column layout; at 1440 that left the installed table clipped (found in the verification round), and for an operator the list of what is installed is the job. Two columns return only above 1700px.
2. The focus ring is blue, not accent green. The default would be a green outline; on a green primary button it would vanish. Blue passes 3:1 against bg, card, accent and danger fills.
3. "Unknown" is amber with a question mark, and the blockers filter includes it. The default is grey for unknown. In an update check an unknown result means "do not upgrade yet", so it needs attention, and the filter counts 21 (missing 5 plus unknown 16).
Also: keeping the bot's old embed hues and changing only meaning; "Edited, was X, Revert" per field plus "Review changes" before save.

**States matrix.**

| State | Config | Mods | Backups |
|---|---|---|---|
| Loading | not shown (config loads with the shell) | yes | yes |
| Empty | search no results | yes | yes |
| Error with retry | not shown (validation errors yes) | yes | yes |
| Stale or partial | pending reload, bot down, conflict | stale note on results | not shown |
| Busy | saving | per row, check progress | restore running, creating |
| Success | toast on save | toast on remove | toast on create, delete |
| Read only | yes | yes | yes |
| Conflict or dirty | yes, with guard dialog | n/a | n/a |
| 500 items | not shown | pager, filter | pager, filter |

Gaps: config load failure, backups stale state, and 500-item behaviour is claimed by the pager, not rendered.

**Squint test.** Primary action (green) and the sticky bar read first, the status chip second, groups third. In Mods, the green update button and badges compete a little with the blue "update to" badges.

**What is weak.** The mockups are not PrimeVue, so spacing will differ in the build. Config at 1440 is a long page and the table of contents is the only wayfinding. The state selector is a mockup device; a few states (loading, conflict) are hard to feel statically. Discord is an approximation. The number of invented backend behaviours (safety copy, steps, reload signal) is nonzero and is listed above. The effort estimate is wide because the audit's scope is wide.

**Verification done.** Rendered in Microsoft Edge (Playwright) at 1440, 390 and 360: no horizontal overflow on 15 page and state combinations; axe-core 4.10.2 (wcag2a, wcag2aa, wcag21aa, best-practice, including `color-contrast`) reports no violations on Config (dirty, error, conflict, raw, read only, guard, saving, clean), Mods (results, busy, confirm, error), Backups (list, restore) and Discord; interactive targets under 760px are at least 44px outside the mockup control bar. One fix round was run: Mods overflow at 1440, duplicate form ids across state variants, an invalid ARIA attribute on a checkbox, and 24px touch targets. Not verified: keyboard walk with a screen reader, real phone, live Discord rendering, the mockups' `prefers-reduced-motion` behaviour beyond the CSS rule.

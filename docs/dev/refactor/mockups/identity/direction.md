# Direction 3: New identity

Wave 2 phase B. Highest-effort option. A full redesign of the dashboard and the Discord embed language, built as static mockups in this folder (open `index.html`, or `preview.html` for desktop and mobile side by side). Every number, name, size and time in the mockups is sample data. Inputs: [wave2-ux-audit.md](../../wave2-ux-audit.md), its appendices, and the shots in `wave2-audit/shots/`.

## 1. Direction contract

```
THESIS: A control room organised around what needs a human, not around a tab list or KPI tiles.
        Colour means state and nothing else, in the dashboard and in Discord. Refuses the
        green-accent dark card grid and the Minecraft pixel look.
WORLD:  Warm graphite ground, hairline rules instead of cards, system sans plus mono for real
        config keys, four lamp shapes (circle, triangle, square, dashed ring) always paired with
        a word, off-white primary buttons, a four-row consequence ledger in every dialog.
STORY:  In three seconds the admin knows whether friends can play, what waits on them, and what
        is running, and acts from the same row.
FIRST VIEWPORT: 34px verdict sentence, server board (state, players, TPS, backup age), then
        "Needs you" with the action inline; rail in three groups, jobs tray at its foot.
RISK:   Every existing tab moves. Wrong if admins live in one tab all day, and the aggregated
        "needs you" queue needs a new backend read model.
```

### How the direction was derived

Reading: operate surface for a small group of admins who run Minecraft servers for friends, often at night or from a phone when something breaks. Needs: calm, glanceable health, trust before destructive actions, long jobs that do not lie, and two surfaces (dashboard, Discord) that feel like one product.

Refused, by name:

| Refused | Why |
|---|---|
| The category default: dark ground, neon or Minecraft-green accent, glass cards, KPI tiles, "1/1 servers online" | It is today's dashboard (see `overview-desktop.png`) and it makes four equal-weight boxes out of one verdict |
| The predictable rebellion: pixel font, blocky grass-block motifs, terminal green | Subject cliche. The audience knows the game; the tool is operations, not decoration |
| Brutalist mono dashboard | The reflex opposite of the default, equally generic |
| Warm paper with a terracotta accent | The most common generated look, and wrong for a night-time tool |

Seven systems from the audience's world that were considered: a ward handover board, an airline status page with inhibited alerts, a railway signal frame, a ship's watch log, a stage manager's cue sheet, a kitchen pass with order tickets, a lighthouse log. They span clinical, aviation, rail, maritime, theatre, domestic and civic families. What survived: the **signal lamp** (rail and aviation: a state is a lamp with a shape and a legend, never colour alone) and the **handover board** (ward and watch: first the verdict, then what is outstanding, then what is running). Scored on audience identification and product clarity, the lamp plus handover pairing beat the cue sheet (clear for confirmations, weak for monitoring) and the kitchen pass (good queue metaphor, no health).

### The two distinctive axes (everything else is conventional on purpose)

1. **Status-first layout.** The home screen is a verdict sentence, a server board and a "Needs you" queue (pending settings, stale backups, mod updates, a stopped server), not an overview of tiles. Navigation follows: Watch (all servers), Server (the one you picked), Bot. A running-jobs tray follows you on every page.
2. **Colour reserved for state.** Neutrals carry everything else. The primary action is the lightest object on the dark screen (darkest on light). Four lamps and four state colours, plus one slate for "in progress or neutral answer". The Discord stripe uses the same palette, so a message and a dashboard row for the same server look related.

Deliberately conventional: system font stack, one radius pair, borders instead of shadows except for floating things, ordinary tables that turn into rows below 760px, PrimeVue dialogs and inputs, 120 to 200 ms transitions, no signature animation.

## 2. Design system in brief

Source of truth: [`tokens.css`](tokens.css) and [`style.css`](style.css). Roles, not swatches. Dark is the default; a light set exists to prove the roles remap (DASH-19), and was run through axe on four screens.

| Group | Tokens (dark values) | Notes |
|---|---|---|
| Surfaces | `--surface-canvas #131412`, `--surface #1a1b19`, `--surface-raised #222320`, `--surface-sunken #0e0f0d` | Warm graphite, held for the whole product |
| Lines | `--border #2d2e2a`, `--border-strong #5a5b55` | Strong border is for controls (3:1 on surface) |
| Text | `--text #ecebe6`, `--text-dim #a8a69e`, `--text-disabled #6f6d66` | Dim passes 4.5:1 on every surface; disabled is exempt and never carries information alone |
| Action | `--action #ecebe6`, `--on-action #131412`, `--action-hover #fff`, `--focus #8cb8ff`, `--link` | No brand accent. Focus is the only blue on the page. Ring is 2px with 2px offset on every element |
| Status | `--ok #5ccf8e`, `--warn #e8a640`, `--bad #f47a6e`, `--unknown #a8a69e`, `--info #9fb4cc`, each with `-bg` tint | Colour is never the only signal: lamp shape (circle, triangle, square, dashed ring) plus a word |
| Type | `--text-xs 12` (labels, meta), `sm 14` (dense cells), `md 15` (body), `lg 17`, `xl 20`, `2xl 26`, `verdict 34`, input 16 | One system sans plus mono for keys, files and ids. Tabular numerals on. Body 15, tables 14, inputs 16 so iOS does not zoom |
| Spacing | `--space-1..7` = 4, 8, 12, 16, 24, 32, 48 | |
| Radius | `--radius-1 4px` (controls, chips, rows), `--radius-2 8px` (dialogs, popovers, strip) | |
| Elevation | none for panels (hairline border), `--shadow-1` popover and toast, `--shadow-2` dialog | Border or shadow, never both |
| Motion | `--dur-fast 120ms`, `--dur 200ms`, `--ease cubic-bezier(.2,.7,.2,1)` | Reduced motion collapses all durations and freezes the indeterminate bar |
| Size | `--control-h 36px`, 44px under `pointer: coarse`, `--topbar-h 56px` | |
| Breakpoints | 760px (drawer, rows), 1180px (aside column) | Custom properties cannot be read in media queries, so these are documented constants |
| z-index | sticky 10, rail 20, popover 40, dialog 60, toast 80 | |

Contrast was checked by axe 4.10.2 (rules wcag2a, wcag2aa, wcag21aa, best-practice) on Watch, Settings, Mods, Backups and Discord in dark, and on four pages in light. See the review gate for results.

### Component language (maps to the audit's base components)

| Mockup element | Becomes (Vue) | Audit requirement |
|---|---|---|
| `.lamp`, `.badge` | `StatusLamp`, `StatusBadge` (extends today's `StatusDot`) | 8.4 status tokens |
| `.field` with title, mono key, hint, error, left marker | `FieldShell` | DASH-07, DASH-14 |
| `.changebar` and the sticky status line | `ChangeBar` inside `EditorShell` | DASH-14, 8.1 dirty |
| `.notice` | `InlineError`, `StaleBanner` (generalised) | DASH-13, 8.6 |
| `.job` with named steps | `ActionJob` | 8.6 long-running |
| `dialog.dlg` with ledger | `ConfirmDialog` driven by `useConfirmAction` | 8.5 |
| `.rows` and `.row.mods`, `.row.baks` | `ResponsiveList` (table on wide, rows under 760) | DASH-09 |
| `.strip` | `ServerStrip` | DASH-16 one server selector |
| `.jobs-tray` | `JobsTray` in the shell | 8.6 |

## 3. Information architecture, navigation and URL model

### What moves where (old to new)

| Today (11 flat items) | New home | Notes |
|---|---|---|
| Overview | **Watch** (all servers) | Verdict, board, Needs you, Running now, Recent changes |
| Servers (start, stop, restart) | Server strip on every server page, and the Watch board | Actions live where the state is |
| Console | Server > Console | Not mocked |
| Backups | Server > Backups | Mocked |
| Mods | Server > Mods | Mocked |
| Mod Config | Tab inside Mods (planned, same editor shell as Settings) | Fixes the "edits vanish on file switch" family because it is one editor with one guard |
| Analytics | Server > Players and stats | Not mocked |
| Guilds | Bot > Discord servers | Label follows the glossary |
| Commands | Bot > Commands | Not mocked |
| Config | Bot > Settings | Mocked |
| Audit Log | Bot > Change history (settings changes and rollbacks) | Not mocked |

Navigation: top bar (status lamp mark that shows the worst state across servers, one server switcher, bot status chip, user), a rail with three groups (Watch, Server `<key>`, Bot) under 760px becomes a drawer behind a menu button. Nine items instead of eleven, grouped, no duplicate icons because the rail is text only (see weak points).

URL model (hash router, `vue-router` in hash mode):

```
#/watch
#/s/<server>/console | backups | mods | stats
#/s/<server>/mods/settings/<fileId>
#/bot/settings            #/bot/settings?q=tps
#/bot/guilds             #/bot/guilds/<guildId>
#/bot/commands           #/bot/history
```

The server is part of the path, so there is exactly one server selector, Back works, a refresh keeps the place, and `confirmLeave` hooks `beforeEach`. Old tab ids map to new routes for bookmarks.

### Migration and orientation plan

This direction changes mental models. Do three things, in this order:

1. **One-time "What moved" overlay** on first load after the upgrade (the mockup has it: `watch.html?tour=1`, or the rail link "What changed"). It lists the table above in four lines, offers "Use the classic layout", and is dismissed per user (stored server side per account, not in `localStorage`, so it survives browsers).
2. **Classic layout toggle for exactly one release.** A user setting that renders today's 11-item sidebar with the new tokens and components. Cheap if built early because the views are the same; it is a second shell, not a second set of views. Remove it in the following release and say so in the changelog.
3. **Redirects** from old hash values (`#mods`, `#modconfig`, `#audit`) to new routes, so bookmarks and Discord links in old alerts keep working. Alerts that link to the dashboard must use the new URLs from day one.

Changelog entry under Changed, with the old-to-new table.

## 4. Dashboard i18n proposal

Answers Q1 with a seam, not a translation project.

- Add a 60-line `useT()` in `src/web/frontend/src/utils/i18n.ts` with `t(key, params)` and `Intl.PluralRules`, no new dependency.
- Catalogs: add a flat `dash.*` namespace to `src/core/locales/{en,de}.ts` (same file the bot uses, same `i18n:check` gate). The web workspace may import `@mcbot/core`, so no boundary change.
- The shared glossary (state labels, tier labels, feature names, duration format) moves to `@mcbot/schema` as plain data so both surfaces import one table (audit Q5). Examples used here: "Bot admin", "Discord server", "Not responding", tiers Hourly, Daily, Archive, Pre-update, Manual.
- Locale comes from the signed-in user's Discord locale with a manual override in the top bar menu. Ship English first, German when the glossary and the `dash.*` keys exist. The mockups are English only for the dashboard and bilingual for Discord.
- No sentence is built by concatenation, no "(s)", ledger labels (Affects, Takes effect, Undo) are keys.

## 5. Discord embed language

The same product, in Discord's constraints (one stripe colour, limited markdown, fields, 4096 description, 25 fields, 256 title, mobile wrapping). Rendered in `discord.html` (EN and DE toggle, `?lang=de`). Ten message types: status, stop confirmation and its progress message, error, permission denial, players page, mods page, downtime alert and recovery, chat bridge, daily reward, whitelist application.

| Rule | Decision |
|---|---|
| Stripe | Five values only. Green ok, amber not responding or blocked, red offline or failed, grey unknown or a game event, slate neutral answers and work in progress. No gold, purple or brand colours. Leave, death and stop are never red |
| Title | Sentence case, names the object and state or the action: "smp is online", "Stop smp?", "Could not stop smp", "Only for bot admins". Never "Success", "Error", "Info" |
| Lamp | One leading lamp emoji (🟢 🟡 🔴 ⚪) only on titles that state a server state or alert. No emoji elsewhere, none on buttons |
| Description | First line is a bold verdict sentence: what happened, what it means. Then at most two short lines. "Try:" or "Next step" carries the recovery |
| Fields | Order: facts (inline), then Impact or Since, then Next step. For confirmations the fixed three: **Affects**, **Takes effect**, **Undo**, the same ledger as dashboard dialogs |
| Footer | `scope` then optional qualifier: `smp`, `smp · Page 1/4`, `smp · Confirm within 60 s`, `Application 14 · smp`. No "Requested by", no echo of the title |
| Timestamp | On only for live data (status, alerts). Times in text are Discord timestamps (`<t:ts:R>` and `<t:ts:f>`); the mockup shows their rendered form |
| Ephemeral rule | Ephemeral: confirmations, errors, denials, personal data (daily reward), config. Public: results meant for the channel (status, lists, moderation outcomes, progress of a server action). The admin check runs before the defer so denial is ephemeral |
| Confirmation | Danger button named after the action ("Stop smp"), Cancel, expiry in the footer, buttons disabled not removed afterwards |
| Progress | One message edited in place with named steps (done mark, current marker, pending marker), slate stripe, final message flips to green or grey |
| Pagination | Previous, a disabled "Page n of m" button, Next. Text, not bare arrows. Disabled after 3 minutes |
| Mentions | Role ping only on the first failure; the recovery and repeats never ping; `allowedMentions` explicit on every alert and bridge message (shown as annotations in the mockup) |
| Chat bridge | Chat is a webhook message with the player name and, with more than one server, `(smp)` after it. Join, death, advancement are one-line grey embeds with no title, no footer, no timestamp |
| Limits | Builders guard 6000 total, 4096 description, 1024 field, 256 title, 45 modal label; a locale test covers the static ones in both languages |
| German | du-form, "Bot-Admin", "Discord-Server", "Kanal", one word per concept from the glossary |

### Brand voice note (copy)

Plain, specific, calm. Say what happened, then what it means, then what to do. Name the thing ("smp", "Terralith") instead of "the server" or "the item". The tone of a good night-shift colleague: no cheerfulness, no alarm, no jokes in errors.

| Do (EN) | Don't |
|---|---|
| "smp stopped answering at 15:31." | "Oops! Something went wrong." |
| "Takes effect on the next restart." | "Changes will be applied accordingly." |
| "Could not stop smp. Try `/status` in a minute." | "Error: operation failed." |
| "Nothing is waiting on you." | "You're all caught up! 🎉" |

| Tun (DE) | Lassen |
|---|---|
| "smp antwortet seit 15:31 nicht mehr." | "Hoppla, da ist etwas schiefgelaufen." |
| "Wirksam nach dem nächsten Neustart." | "Die Änderungen werden entsprechend übernommen." |
| "smp konnte nicht gestoppt werden. Prüfe in einer Minute `/status`." | "Fehler: Vorgang fehlgeschlagen." |
| "Frag einen Bot-Admin." (du-form, kurz) | "Bitte wenden Sie sich an den Administrator." |

German rules: du, never Sie. "Bot-Admin" (never "Server-Admin"), "Discord-Server" for the community, "Server" for a Minecraft server, "Kanal". Verbs before nouns in buttons ("smp stoppen"). Units and decimals follow German (5,1 GB). Dash rule for all copy: no em or en dashes.

## 6. Audit coverage

Fixed visibly in the mockups (design level; the id is the audit's):

| Area | Ids | How |
|---|---|---|
| Shell and mobile | DASH-01, 10, 16, 20, 25, 02 | Top bar plus drawer, 44px coarse controls, one server selector in the top bar and path, bot status as a chip not a banner, grouped nav, hash routes |
| Config editor | DASH-04, 07, 14, 15 | Raw JSON tab with its own invalid state and leave guard, FieldShell (label bound, hint and error bound by `aria-describedby`), titles with the real key beneath, search, per-group counts, sticky ChangeBar always visible, secret field never shown |
| Mod config | DASH-03 | Merged under Mods on the same editor shell and guard (planned, not mocked) |
| Mods | DASH-11, 12, 13, 07 | Single confirm dialog with ledger, same components as everywhere, inline load error with retry, per-row aria-labels naming the mod, per-row busy, update check with progress, results and blockers filter |
| Backups | DASH-09, 21, 11, 13 | Rows under 760px, Restore and Delete differ (outlined vs ghost, typed confirm with different targets), actions named per backup, tier filter, create and restore as jobs with steps, restore prerequisites in the dialog, list error inline |
| Cross-cutting | DASH-05, 06, 19, 24 | Contrast by token, focus ring everywhere, skip link, light tokens, copy rewritten without em dashes or "change(s)" |
| Time | DASH-22 (partly) | Relative time with absolute on hover (`title`), "no data" instead of bare dashes in the board; the `formatDuration` util is still needed |
| Discord | DISC-04, 05, 06, 09, 12, 13, 14, 16, 22, 25 | `/status` colour by state, public vs ephemeral rule, denial shape, recovery without ping, problem plus recovery errors, confirmation with expiry, Page n/m footers, leave and death not red, no "Requested by" |
| Discord, partly | DISC-11, 19, 07, 08 | Pagination text buttons, glossary terms; `/help` structure and German grammar rewrites are not drawn |

Not fixed by this direction (still needs the hotfix list or separate work): DASH-08 (the `parseStamp` bug is in core; the board shows relative times and would be wrong without the hotfix), DASH-17, DASH-18 beyond a history page, DASH-23, DISC-01, 02, 03 (partly, via `replyError`), 07, 08, 10, 15, 17, 18, 21, 23, and anything in the commands editor and wizard steps that was not seen in the audit.

## 7. Implementation impact

### (a) Effort

**38 to 54 person-days** (roughly 2 to 2.5 times a polish pass, and the highest of the three directions). Reasoning: shell, router and Watch are new (about 10 to 14 days with the read model); tokens, preset and base components 5 to 7; Settings editor 5 to 7; Mods migration (1574-line view) 5 to 7; Backups, Console, Analytics, Guilds, Commands, history views 8 to 10; Discord builders 6 to 8; glossary and `t()` seam 2 to 3; classic toggle 2; a11y and 360/430/760/1440 QA 3 to 4. The range is wide because the `needs you` read model depends on what the backend already exposes (capabilities, config status, mod update counts, backup age).

### (b) Risks and mitigation

| Risk | Mitigation |
|---|---|
| Mental model change for every admin | What-moved overlay, classic toggle for one release, hash redirects, changelog table |
| Watch aggregates data from many endpoints, one slow server blocks the verdict | Each row loads independently with a 10 s timeout that renders "Not responding", never blank; verdict sentence derives from rows already loaded |
| "Needs you" becomes a junk drawer | Fixed item types (stopped server, pending setting, stale backup, TPS warning, mod updates, bot down), each with an owner and an exit condition; no free-form items |
| Typed confirm friction for experts on restore and delete | Typed only for irreversible (restore, delete backup, rollback). Disruptive actions use the ledger dialog without typing |
| The dialog's "Undo" line promises behaviour the wrapper may not have (pre-restore snapshot, `.disabled` jars) | Verify each Undo claim against the wrapper before shipping the copy; if false, the line says "Not possible" |
| Discord rendering differs from the HTML approximation | Test guild pass (audit Q10) before rewriting builders; keep stripe table in one `EmbedColor` map |
| Scope creep from a new router | Ship router and shell first behind the classic toggle, then move views one at a time |
| Single-person bus factor (design plus backend plus bot) | Phases below are separable PRs |

### (c) Component layer, preset, dependencies

New base components in `src/web/frontend/src/components/ui/`: `StatusLamp`, `StatusBadge`, `FieldShell`, `EditorShell`, `ChangeBar`, `InlineError`, `ActionJob`, `ConfirmDialog` (with `useConfirmAction`), `ResponsiveList`, `ServerStrip`, `JobsTray`, `AppShell` (`TopBar`, `Rail`, `Drawer`), `WhatChanged`, `AttentionQueue`, `ServerBoard`. Composables: `useAttention` (Needs you), `useJobs` (tray), `useRoute` helpers.

| View | Change | Notes |
|---|---|---|
| `App.vue` | L | Becomes AppShell, router outlet, jobs tray, drawer |
| `OverviewView.vue` | L (replaced) | Becomes `WatchView` |
| `StatusView.vue` | L | Splits into server strip actions and board rows; keep the Options API |
| `ModsView.vue` | L | Migrates the 50 raw colours to tokens, replaces own buttons, adds ledger confirm, check job and results (the target-version update check is new and needs a backend job and progress endpoint) |
| `ModConfigView.vue` | L | Becomes a tab of Mods on `EditorShell` |
| `ConfigView.vue` | L | `EditorShell`, `FieldShell`, search, TOC |
| `BackupsView.vue` | L | Rows, tier filter, create job, restore job, typed confirm |
| `ConsoleView.vue` | M | Strip, `role="log"`, composer label, toast position |
| `AnalyticsView.vue` | M | Strip, duration util, no bare dashes |
| `AuditView.vue` | M | Becomes Change history, shared rollback dialog |
| `CommandsView.vue` | M | Rows, empty state without active Save |
| `GuildsView.vue`, `SetupWizard.vue` | M | Glossary terms, inline error, wizard on `EditorShell` |
| `components/schema/*` | M | `SchemaField` renders through `FieldShell`, `format: password` support |

PrimeVue preset (`main.ts`): keep Aura as the base, re-map `primary` to the neutral action pair (`{zinc.200}` on `{zinc.950}` in dark, inverse in light, so no accent), override `colorScheme.dark.surface` to the warm graphite ramp, set `focusRing` (2px, offset 2px, `--focus`), `formField` paddings for 36 and 44px heights, `button` radii, `dialog` radius and border, and map `severity` tokens to the status roles. A lint rule bans raw hex in `.vue` files. PrimeVue components kept: Dialog, InputText, InputNumber, Select, ToggleSwitch, Toast, Tabs, Drawer, DataTable only where sorting is needed (ResponsiveList otherwise).

Dependencies: `vue-router` (hash mode, about 25 kB gzipped) for deep links, guards and Back; justified over a hand-written router because guards and params are exactly where hand-written ones break. No icon pack is added (text rail; PrimeIcons is already present for the few glyphs). No font files: system stack, so nothing to host.

### (d) Bot embed and reply builders

Counts from `grep` in `src/bot` (this worktree): `createEmbed(` 61 calls, `createErrorEmbed(` 23, `createSuccessEmbed(` 18, `createInfoEmbed(` 3, `createPaginationButtons(` and `handlePagination(` 17, `ButtonBuilder(` 10, `setFooter` or `footer:` 55, `EmbedColor`/`setColor` 62, `allowedMentions` 4, across 50 files that import an embed builder. Roughly 105 embed call sites change, plus 55 footers.

In `src/bot/utils/embeds/embedUtils.ts` and `embedColors.ts`:

- `EmbedColor`: replace ten values (Success, Error, Info, Warning, Gold, Critical, Neutral, Challenge, Blurple, Modrinth) with `Ok`, `Warn`, `Bad`, `Unknown`, `Slate`.
- New: `createStateEmbed({ state, subject, verdict, fields, next })` (lamp title plus verdict plus ordered fields), `createConfirmEmbed` and `createConfirmRow` (Affects, Takes effect, Undo, expiry), `createProgressEmbed` (named steps), `replyError` and `replyDenied` (ephemeral, problem plus recovery, shared shape), `paginateFields` (enforces 6000 and 1024), `pageFooter`, `lampTitle`.
- `createErrorEmbed`, `createSuccessEmbed`, `createInfoEmbed` become thin wrappers that map to the new color map and title grammar, then are deprecated.
- `describeState` and `describeHealth` in `serverStateDisplay.ts` read the shared glossary and return lamp, colour and label from one table.
- `alertUtils.ts`: `roleMention` splits into first-failure ping and silent recovery.

Locale impact: about 67 title keys and 85 emoji-bearing lines in `en.ts`; plan on 150 to 200 keys touched per language plus about 40 new keys (ledger labels, "Try:", "Next step", page footers, confirmation text, error recoveries), mirrored in `de.ts`, with `npm run i18n:check` and a limits test as gates.

### (e) Phases for Phase C (each a PR-able unit)

| Phase | Content | Effort |
|---|---|---|
| C1 | Tokens, PrimeVue preset, focus ring, skip link, `StatusLamp`/`StatusBadge`/`FieldShell`/`InlineError`/`ConfirmDialog`/`ResponsiveList`, hex lint rule. Hotfix values (DASH-05, 06) land here | 5 to 7 d |
| C2 | Router, AppShell, drawer, server selector in path, redirects, classic toggle, what-moved overlay | 6 to 8 d |
| C3 | `EditorShell`, Settings, raw JSON guard, secret fields, then Mod Config as a Mods tab | 7 to 10 d |
| C4 | Discord builders, glossary in `@mcbot/schema`, `EmbedColor`, confirm, progress, error, denial, mention policy, call-site migration, locale pass | 8 to 11 d |
| C5 | Watch (`useAttention`, backend read model), Mods migration, Backups, Console, Analytics, Guilds, Commands, history | 11 to 15 d |
| C6 | QA at 360, 430, 760, 1440, axe on every view, docs, changelog, remove nothing yet | 3 to 4 d |

Order matters: C1 must land first. C4 can run in parallel with C3 after C1 because the bot and web workspaces only share the glossary.

### (f) What this direction would not fix

DASH-08 (needs the core `parseStamp` fix), the 13 unwrapped commands (DISC-03 remainder), German grammar rewrites (DISC-07, 08, 15), the bridge webhook failure (DISC-10), command consolidation (DISC-18), DISC-01 (the 45 character modal label limit is a separate test), anything in the unaudited editor bodies, and light-theme polish beyond what the tokens give.

### If time is short, cut in this order

1. Classic layout toggle (keep the what-moved overlay and redirects).
2. Mod Config as a Mods tab (leave it as a view, in the Server group).
3. Change history merge (leave Audit Log in the Bot group).
4. The jobs tray and the Needs you queue; keep Watch as a plain Overview with the verdict sentence and the board.
5. Light theme set.

Keep at any cost: tokens and focus ring, lamp plus word status, one confirm ledger on both surfaces, `FieldShell` and `EditorShell`, the Discord colour and title grammar, the mention policy.

## 8. Review gate

Run against the render, in the skill's order.

1. **Cover the logo.** Without "mcbot", the page still reads as this product mainly through the lamp shapes, the verdict sentence and the ledger dialogs. It could still be mistaken for a generic dark ops tool in the Mods and Backups lists. Partial pass.
2. **First-task test.** After the Watch first viewport, the admin can see which server is wrong and press "Open console" or "Restart creative" without hunting. Pass on desktop; on mobile the actions sit under the queue text, one scroll down. Acceptable.
3. **Three decisions a model would not have made by default.** (a) The primary button is off-white and there is no brand accent: colour is spent only on state, so a red or amber thing on screen is always a real condition. (b) The home screen is a spoken verdict plus a queue, not four KPI tiles, because "1/1 servers online" tells the admin nothing they act on. (c) One consequence ledger (Affects, Takes effect, Undo) is shared by dashboard dialogs and Discord confirmations, so the grammar of danger is the same on both surfaces. (A fourth: lamp shapes plus words, so the Discord stripe and the rail never rely on colour alone.)
4. **Numbers.** All numbers are sample data, flagged in the mockup bar. Retention periods were removed after review because they were invented. The ledger's Undo lines (pre-restore snapshot, `.disabled` jars) are proposals, not facts about the wrapper.
5. **States matrix.** Config: clean, dirty, invalid, conflict, saving, pending, bot down, raw invalid, read-only. Mods: installed, row busy, checking 14 of 62, results, blockers, empty, loading, error, remove, read-only. Backups: list, filtered, creating, restoring, restore, delete, empty, loading, error, read-only. Watch: attention, quiet, loading, error, bot down. Not shown: 500 items and one very long name (rows wrap with `overflow-wrap: anywhere`, not tested with 500).
6. **Links.** Screens not mocked (Console, Players and stats, Discord servers, Commands, Change history, Classic layout) go to `stub.html`, which says what pattern each reuses. Server switcher entries reload the same page without changing data.
7. **Real phone.** Not done. Checked in Edge at 390 and 360 (no horizontal scroll on any page, measured with `scrollWidth` against `clientWidth`) and 1440. The 44px coarse rule is in CSS and was not verified under touch emulation.
8. **Grep.** No lorem, no `console.log`, no placeholder text. Em and en dash scan in the folder is clean. "Sample" names (`maya_k`, `jonas_b`, `Lena_B`) are invented.
9. **Intentional variation.** Heading sizes, the 34px verdict, two radii and the lamp shapes are the only variation; panels share border and radius on purpose.
10. **Squint.** Verdict, then board rows with lamp, then queue buttons are distinguishable. On Settings the sticky bar is the loudest element, which is intended. The rail group labels are the weakest hierarchy.
11. **Would a named person say it.** Copy was written as an admin colleague would say it ("creative stopped answering 11 minutes ago"). The German was written by reading, not by a native review.
12. **Matches the contract.** FIRST VIEWPORT, verdict, board, queue: yes. WORLD: lamp shapes, hairlines, off-white primary: yes. The jobs tray is present but small.

axe 4.10.2 results: dark theme on Watch, Settings (invalid), Mods (results), Backups (list), Discord (EN) and two mobile pages: the only finding is `region` on the mockup state bar, which is mockup chrome, not product. Light theme: one `color-contrast` (4.42:1 on the filter count in an unpressed chip), fixed by removing its opacity, not re-run after the fix beyond the confirm round. A keyboard Tab walk and a screen reader pass were not done.

### What is weak

- **Text-only rail.** No icons, which deviates from audit 8.7 (distinct icons). It fixes the duplicate icon bug by removal, but scanning by shape is lost.
- **Watch needs a read model.** The queue is the most valuable and the least cheap part; a half-built queue is worse than a plain Overview.
- **Lamp emoji in Discord** are platform glyphs that vary by device and can look larger than the title text.
- **Light theme** is token-complete but was verified on four pages only.
- **Settings dirty state** is drawn well in the conflict and invalid pages, but the field markers (left edge plus "Changed") are quiet at a glance; a tinted row alone is not enough on bright screens.
- **Typed confirmation** on every backup delete may annoy the people it should protect.
- **Preview scaling** hides 1:1 detail; judge type and spacing on the pages themselves.

### What could not be verified

Real Discord rendering (webhook username limits, field wrapping), real device touch targets and iOS zoom, NVDA or VoiceOver, German by a native reader, the wrapper's Undo behaviours, load behaviour of Watch with a slow second server, and any behaviour at 500 items.

# Wave 2 summary: dashboard and Discord rework (7.1.0)

Wave 2 audited the dashboard and the Discord replies, built four mockup
directions, and implemented the chosen one, Hybrid: today's look on a token,
status and component system shared between the dashboard and Discord. The
reasoning is in the [decision log](decisions.md#wave-2-the-hybrid-direction-for-the-dashboard-and-discord);
the resulting rules are in [web/frontend.md](web/frontend.md) and
[bot/replies.md](bot/replies.md); the user-facing changes are in
`CHANGELOG.md` (under `[Unreleased]` until 7.1.0 is dated by the release).

Finding ids (DASH-xx, DISC-xx) are those of the Wave 2 audit. Its appendices
live under `docs/dev/refactor/wave2-audit/` until the working material is
removed (see [wave2-cleanup-candidates.md](wave2-cleanup-candidates.md)); this
page carries every id with a one-line description so it stays readable without
them.

The base for every diff below is `e0357ec` (Wave 1, 7.0.0; there is no
`v7.0.0` tag).

## Phases

| Phase | Merge | What changed |
|---|---|---|
| P1a status table and glossary | `ea0153d` | `src/schema/status.ts`: seven status roles with shape, colour, tint, embed colour and label, plus the maps from server and config apply states. `src/schema/glossary.ts`: shared English and German terms and backup type labels. |
| P0a bot hotfixes | `3ba1b2e` | Shorter German whitelist modal label and a locale length test; `/config show` private and without secrets; localised dispatcher errors; `/daily` defers and shows the main reward; downtime alerts built per guild locale. |
| P0b web hotfixes | `50e9baf` | SQLite timestamps read as UTC; unsaved Mod config and invalid Raw JSON edits guarded; primary button and dim text contrast; a visible focus ring; an interim phone navigation. |
| P1 tokens, preset, density, hex lint | `4274116` | `tokens.css` role tokens, a PrimeVue preset built from token references, status tokens written from the schema table, the density switch, 44 px touch targets, and `check-frontend.mjs` failing on raw hex and on foreign workspace imports. |
| P5 Discord builders and replies | `16f1cc4`, then `9a7c79c` | Embed colours from the status table, the state circle as the only title emoji, titles that name the action, no "Requested by" or page footers, timestamps on live data only; errors private with problem and recovery; admin denial before the defer; every command in `withErrorHandling`; limit-aware paging with a "Page n/m" button that switches off after 3 minutes; restart-safe confirm rows for `/server stop` and `/server restart`; explicit `allowedMentions` everywhere and the opt-in `mentionPolicy`; TPS recovery post; plurals through `Intl.PluralRules`; the German copy pass (du-form, one word per concept, no dashes). `9a7c79c` made a claimed `/daily` reward public again. |
| P2 shell, router, drawer, `t()` | `bf1f05d` | `vue-router` with hash history and an address for every page, server, file and filter; one leave guard; `AppShell` with grouped navigation, one server picker, phone top bar and drawer, skip link; the `t()` seam with an English table. |
| P3 base components and Backups | `5671cf9`, then `a9d6b28` | jsdom component tests and the PrimeVue spike; `StatusChip` with shapes, `FieldRow`, `InlineError`, `ResponsiveTable`, `JobBlock`, `EditorShell`, `ModIcon`; three confirm levels (`useConfirmAction`) and per-row busy (`useRowBusy`); `GET /api/servers/:id/backups/summary` and the rebuilt Backups page. `a9d6b28` removed the Backups page's own server picker. |
| P4 editor frame, Config, Mod config | `4cb72e8` | Schema `title` and `effect` notes; `EditorShell`, `EditBar`, `FieldRow`, `ReviewChanges`; the Config editor with groups, a filter in the address, field errors and password fields for secrets; Mod config and the guild dialog on the same frame; a queued Mod config save reported as held. |
| P6a Mods and icons | `d7890c9` | Characterisation tests first, then `useInstalledMods`; bounded, cached bulk Modrinth icon lookup (`lookupProjectIcons`) and `iconUrl` on installed and compat rows; the Mods page rebuilt on tokens, components and `t()`; Remove through the shared confirm. |
| P6b admin pages | `3b5c175` | `DISCORD_TOKEN_MISSING` and `DISCORD_TOKEN_REJECTED` error codes; Commands on the editor frame; Guilds and the setup wizard show failures in place; segmented control contrast. |
| P6b monitor pages | `89a2bf0` | Failures by cause through `utils/loadFailure.ts`; server actions as job blocks with levelled confirms; an accessible console log with wrap and history; the shared duration format in Analytics; Retry on Audit log and config history failures; toasts top right; tables as cards on phones. |
| P7 docs and release prep | this branch | Discord reply snapshots (`tests/bot/discordSnapshots/`, `npm run discord:snapshots`) and the fixes they found; durable docs; this summary; the cleanup list; the 7.1.0 version and changelog. The browser and accessibility pass of P7 ran on a separate branch. |

## Dashboard findings

| Id | Finding | Status |
|---|---|---|
| DASH-01 | Mobile shell was a 530 px sidebar block | Closed (P0b interim, P2 drawer) |
| DASH-02 | No router or deep links | Closed (P2) |
| DASH-03 | Mod config dropped unsaved edits | Closed (P0b, P4) |
| DASH-04 | Invalid Raw JSON invisible to the unsaved guard | Closed (P0b) |
| DASH-05 | No visible focus ring | Closed (P0b, P1) |
| DASH-06 | Primary button 2.1:1, dim text too low | Closed (P0b; P3 and P6b for secondary and segmented controls) |
| DASH-07 | Labels not tied to inputs, unnamed icon buttons | Closed across P4, P6a, P6b; to be confirmed by the P7 axe pass |
| DASH-08 | UTC timestamps read as local time | Closed (P0b) |
| DASH-09 | Backups and Config overflow on phones | Closed (P3, P4) |
| DASH-10 | No 44 px touch targets | Closed (P1, applied per view in P6b) |
| DASH-11 | Four confirm patterns, native `confirm` | Closed (P3, P6a, P6b) |
| DASH-12 | Mods was a design island | Closed (P6a) |
| DASH-13 | Toast-only errors, no progress, toasts over controls | Closed (P3, P6b) |
| DASH-14 | Config was raw keys in a flat form with no search | Closed (P4) |
| DASH-15 | Secrets in plain text boxes | Closed (P4) |
| DASH-16 | Two server pickers | Closed (P2, `a9d6b28`) |
| DASH-17 | Guilds hint split by flex | Closed (P6b admin) |
| DASH-18 | Config history hidden in the Audit log, errors swallowed, no diff | Partly closed: failures show with Retry and the rollback states what it changes and how to undo it (P6b). Deferred: a history drawer in Config and a diff view. |
| DASH-19 | Dark only, no theme decision | Deferred by decision: dark only, light theme is the optional P8 |
| DASH-20 | Large "bot looks down" banner | Closed (P2) |
| DASH-21 | Backups: unnamed actions, no create, no type filter | Closed (P3) |
| DASH-22 | "0d 12h 0m 0s" durations, bare "Unknown" | Closed in the dashboard (P6b); see the open decision on the bot below |
| DASH-23 | Console log not accessible, no history, wrap, copy, clear or download | Partly closed: log role, labels, wrap, history (P6b). Deferred: copy, clear, download, and `aria-live`. |
| DASH-24 | Em dashes, "(s)", no dashboard i18n | Closed for copy and the `t()` seam; a German dashboard is deferred by decision |
| DASH-25 | Flat navigation, duplicate icons | Closed (P2) |

## Discord findings

| Id | Finding | Status |
|---|---|---|
| DISC-01 | German whitelist modal label over 45 characters | Closed (P0a, `tests/core/localeLimits.test.ts`) |
| DISC-02 | `/daily` did not defer | Closed (P0a) |
| DISC-03 | English fallback error, 13 commands unwrapped | Closed (P0a, P5) |
| DISC-04 | `/mods` over the embed limits | Closed (P5) |
| DISC-05 | `/config show` public and leaking data | Closed (P0a) |
| DISC-06 | Public permission error after the defer | Closed (P5) |
| DISC-07 | Internal feature phrases in capability errors | Closed in code (P5); German wording awaits a native read |
| DISC-08 | Hard-coded English in localised replies | Closed (P5) |
| DISC-09 | Every alert pinged, recoveries included | Closed (P5) as the opt-in `mentionPolicy`; the default still pings every alert |
| DISC-10 | Bridge webhook cache drops messages silently | Deferred (bridge logic, not reply UX) |
| DISC-11 | `/help` marks subcommands optional, nine pages, no categories | Not fixed |
| DISC-12 | Errors without a next step | Closed (P5) |
| DISC-13 | "Success" and "Error" titles | Closed (P5) |
| DISC-14 | stop and restart without confirmation | Closed (P5) |
| DISC-15 | German grammar in alerts, a nonexistent `/mods disable` | Closed (P5); German awaits a native read |
| DISC-16 | Colour meanings inconsistent | Closed (P5) |
| DISC-17 | Discord to game: truncation, raw emoji and mentions | Deferred (bridge edge cases) |
| DISC-18 | Duplicate and sprawling commands | Deferred (command consolidation is its own project) |
| DISC-19 | Bare emoji pager without "n/m" | Closed (P5) |
| DISC-20 | Autocomplete gaps | Deferred |
| DISC-21 | No `setContexts`, guild commands offered in DMs | Deferred |
| DISC-22 | Status embed always blue, static footer | Closed (P5) |
| DISC-23 | No plurals, "(s)" | Closed (P5) |
| DISC-24 | Em and en dashes in copy | Partly closed: no em dashes left in the locales; one en dash per locale file and the ranges in `poll.ts` and `clear.ts` option text remain |
| DISC-25 | "Requested by" footers | Closed (P5) |
| DISC-26 | Inconsistent option names | Deferred (needs a deprecation window) |
| DISC-27 | "\| Admin only" on some admin command descriptions | Deferred |
| DISC-28 | `/server status` title and unbounded output | Closed (P5) |
| DISC-29 | A planned restart posts four messages | Deferred |
| DISC-30 | Daily success as plain text; reminder DM has no stop button | Partly closed: embed reply (P5). Deferred: the stop button on the reminder DM |
| DISC-31 | Deny has no reason; internal id in the footer | Partly closed: footer removed (P5). Deferred: the reason modal |
| DISC-32 | Docs list in-game commands as slash commands | Deferred (docs fix) |
| DISC-33 | `/tps` raw output footer, stray yellow circle | Closed (P5) |
| DISC-34 | Raw backup folder names, "5m/3h" ages | Closed (P5) |
| DISC-35 | In-game replies not localised, German-only sleep prompt | Deferred (separate localisation item) |
| DISC-36 | Three date styles | Deferred |

## Deferred, and why

- **Light theme (P8).** Optional by plan, 3 to 4 days. Tokens are named by role,
  so it is a second value set, not a migration.
- **German dashboard.** The `t()` seam and the English table are in place; the
  glossary already holds German. Deferred for review cost and the lack of a
  native reviewer.
- **Config history drawer and diff (DASH-18).** Not built in this wave; the
  failure handling and the rollback copy were done first.
- **Console copy, clear and download (DASH-23).** Not picked up by any phase.
- **Discord items outside reply UX:** bridge reliability and formatting
  (DISC-10, DISC-17), command consolidation and naming (DISC-18, DISC-26,
  DISC-27), autocomplete and DM contexts (DISC-20, DISC-21), the restart message
  flow (DISC-29), the remaining parts of DISC-30 and DISC-31, the docs fix
  DISC-32, in-game localisation (DISC-35), date styles (DISC-36), `/help`
  (DISC-11) and the last en dashes (DISC-24).

## Discord compared with the mockup

The P7 snapshots render the mockup's cases through the real code. Differences
that remain, all reviewed:

- **Intended:** `/daily` is public (decision log); recoveries ping under the
  default `always` policy (only `escalation` matches the mockup's silent
  recovery); event lines carry the player as the embed author rather than a
  bold name; death messages are the game's English log text in every language;
  ages and times are Discord timestamps instead of "35 minutes ago"; the
  confirmed stop notice shows a running start time; durations use the shared
  "3 min" format in both languages; the whitelist application lists applicant,
  name, server and note as lines rather than fields.
- **Fixed in P7:** the challenge reward line was built in the global language
  for every guild; the challenge and streak leaderboard titles carried a trophy
  emoji; backup sizes used a decimal point in German.
- **Open, larger than a P7 fix:**
  - `/status` shows bot ping and round trip instead of the mockup's TPS, uptime
    and version, and an offline server has no "who stopped it, how to start it"
    line (needs data the command does not have today).
  - An unreachable wrapper surfaces as "Command failed" with the raw transport
    message (for example "fetch failed") in English, also in German guilds.
    Needs a mapping from wrapper errors to a localised problem and recovery,
    ideally titled "Could not reach smp" as in the mockup.
  - `/players` prints playtime as "8d 20h 0m 0s" (see open decisions), has no
    "3 online, 41 known" summary and no sort line.
  - `/mods` has no loader and version line and lists every mod as a link per
    line, so a 62 mod pack is one long page rather than the mockup's grouped
    names.
  - The downtime alert has no "last seen", "players hit" or crash report hint.
  - `/daily` shows raw item ids ("3x diamond", "cooked beef") in English in
    every language, and a random bonus item is given but not listed.
  - The denial names the command (`/server`) but not the subcommand.

## Limits of the verification

- No real phone: phone layouts were checked in a desktop browser at 360, 390
  and 430 px.
- No screen reader: accessibility rests on axe runs, a keyboard walk and the
  component tests.
- No live Discord: embeds were checked through the snapshots and unit tests,
  not in a test guild, so wrapping, embed width on mobile and button layout
  are unverified.
- German strings are not natively reviewed. The full list of German changes is
  `git diff e0357ec -- src/core/locales/de.ts` (about 118 new keys and 200
  changed values) plus the German column of `src/schema/glossary.ts`.
- PrimeVue's fit was judged in a jsdom spike and from its sources, not on
  devices.
- The mod management scripts need `sudo` on a Linux host; their success paths
  were not run on Windows and rely on CI and the wrapper contract tests.

## Open owner decisions

- **`formatPlaytime` in Discord.** The bot still prints "0d 12h 0m 0s"
  (`core/utils/minecraft/statUtils.ts`, used by `/players`, `/playtime`,
  `/compare`, `/profile` and the stat embeds) while the dashboard uses the shared "12 h 7 min"
  format. Switching changes every playtime reply.
- **Status table mappings.** `CONFIG_APPLY_STATE_ROLE` in
  `src/schema/status.ts` maps `BotDown` to offline (a red ring) and
  `RestartRequired` to pending (a violet dashed ring, the same as a save the
  bot has not picked up yet). Both are judgement calls the owner has not
  confirmed.
- **Alert mention default.** `mentionPolicy` defaults to `always`. Making
  `escalation` the default is a behaviour change for every guild and would make
  the next release a major one.

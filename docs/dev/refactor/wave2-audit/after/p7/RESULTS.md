# P7 verification results

Browser pass over the rebuilt dashboard on `refactor/w2c-p7-verify` (from `refactor/wave2` after P0 to P6), run on 2026-10-11.

## Setup

- Headless Microsoft Edge (Playwright, `channel: msedge`) in its own browser and context, started and closed by the verification script. No shared browser or page was used.
- Dashboard from `node scripts/dev-up.mjs --id w2c-p7-verify --only web` (isolated config, database and ports, `MCBOT_DEV_NO_AUTH=1`), stopped with `dev-down.mjs` afterwards.
- Server `dev` behind the real API wrapper (`minecraft-server-setup` checkout) on a scaffolded instance with a fake RCON responder, the way `scripts/e2e-wrapper-contract.mjs` builds one. A small proxy in front of it answered the mod routes (installed list, update check, compat jobs) from fixtures, because those need the suite's scripts and `sudo`. The database was seeded with uptime checks, player sessions, command usage, admin audit rows and config history.
- Discord was stubbed by route interception in the browser: `/api/guilds`, `/api/setup/guilds`, channels, roles, `/api/commands` and `/api/me` (for the login screen). Error, loading and empty states were forced the same way (HTTP 500, or a request held for 15 s).
- axe-core 4.10.2 with the tags `wcag2a`, `wcag2aa`, `wcag21aa` and `best-practice`, run on every capture listed below.
- Each capture also measured horizontal overflow of the page and of an open dialog, and, at 760 px and below, every visible button, link, input, select, tab, switch and checkbox under 44 px (a checkbox or switch counts by its label or hit area; text links inside a sentence are exempt).

Widths: 360, 390, 430, 1440 and 1920 for every view, the login screen and the setup wizard. State captures at 1440 and 360. Screenshots are JPEG, all under 250 KB, in one folder per view, named `<view>-<width>[-<state>].jpg`.

## Result per view

"Pass" means: no axe violation, no horizontal overflow, no phone target under 44 px and no console error other than the failure that state forces on purpose. Findings that failed first and were fixed in this phase are listed under "Fixed in P7".

### Shell (sidebar, top bar, drawer)

| Check | Result |
| --- | --- |
| axe, overflow, targets at all five widths (via every view) | Pass |
| Drawer open at 360 and 430 | Pass. Focus moves into the drawer, Tab walks the nav links, Escape closes it and returns focus to "Open navigation" |
| Keyboard walk at 1440 | Pass. Skip link first (visible at the top when focused, Enter moves focus to `#main`), then server picker, eleven nav links, Add to Discord, density, Log out, then the page. Every stop has a visible outline |
| Deep links survive a reload | Pass for `#/analytics/dev`, `#/console/dev`, `#/backups/dev`, `#/mods/dev`, `#/modconfig/dev` (and `#/modconfig/dev/<fileId>` after opening a file), `#/config/raw`, `#/guilds/<id>`, `#/audit`, `#/commands` |
| Fixed in P7 | Skip link 39 px and the "Open overview" link in the bot status line 22 px on phones; Add to Discord 39 px in the drawer |

### Login screen

| Check | Result |
| --- | --- |
| axe, overflow at all five widths | Pass |
| Keyboard | Pass. "Log in with Discord" is the only stop |
| Console | Only the expected `401` from `/api/me` |
| Fixed in P7 | The button was 39 px on phones |

### Overview

| State | Widths | Result |
| --- | --- | --- |
| Populated | all five | Pass |
| Section errors (audit and guild reads fail) | 1440, 360 | Pass, each panel says what failed with Retry |
| Loading | 1440, 360 | Pass |

### Servers

| State | Widths | Result |
| --- | --- | --- |
| Populated | all five | Pass (360 and 1920 retaken with the filled primary action) |
| Restart confirm | 1440, 360 | Pass. Focus starts on Cancel, Tab stays in the dialog, Escape closes it and focus returns to Restart |
| Status read fails | 1440, 360 | Pass |

### Analytics

| State | Widths | Result |
| --- | --- | --- |
| Populated | all five | Pass |
| Every section fails | 1440, 360 | Pass |
| Loading | 1440, 360 | Pass |
| Sort on phones | 360 | Pass. New "Sort by" picker and order button above each stacked table; sorting by Player and flipping the order reorders the cards |
| Fixed in P7 | Stacked tables had no way to sort on phones; the stat picker was named by its value ("Playtime") instead of its label |

### Console

| State | Widths | Result |
| --- | --- | --- |
| Live log | all five | Pass |
| Errors filter plus a blocked command typed | 1440, 360 | Pass, the hint names the blocked command |
| Policy and stream fail | 1440, 360 | Pass |
| Copy, Download, Clear view | 1440, 360 | Pass. Copy put the shown lines on the clipboard and announced "Copied", Download saved `dev-<timestamp>.log`, Clear view emptied the pane and the count |
| Fixed in P7 | Copy, download and clear were missing (DASH-23 remainder) |

### Audit log

| State | Widths | Result |
| --- | --- | --- |
| Populated | all five | Pass |
| Filter with no match | 1440, 360 | Pass |
| Audit and history fail | 1440, 360 | Pass |
| Sort on phones | 360 | Pass (When and Action, as on desktop) |
| Fixed in P7 | No sort on phones in card mode |

### Backups

| State | Widths | Result |
| --- | --- | --- |
| Populated | all five | Pass |
| Restore typed confirm | 1440, 360 | Pass. Focus on Cancel, trapped, Escape closes, focus returns to Restore |
| List fails | 1440, 360 | Pass |
| Loading | 1440, 360 | Pass |

### Mods

| State | Widths | Result |
| --- | --- | --- |
| Populated with catalogue | all five | Pass |
| Loading (installed list, update check and catalogue held) | 1440, 360 | Pass, skeleton rows in Installed and the catalogue (retaken, the P6a captures predated the catalogue skeleton) |
| Catalogue loading inside the phone picker | 360 | Pass |
| Catalogue picker on phones | 360 | Pass |
| Installed list fails | 1440, 360 | Pass |
| No mods installed | 1440, 360 | Pass |
| Remove confirm | 1440, 360 | Pass. Focus on "Keep lithium", trapped, Escape closes, focus returns to Remove |

### Mod config

| State | Widths | Result |
| --- | --- | --- |
| File list | all five | Pass |
| File open and edited (dirty) | 1440, 360 | Pass, the address becomes `#/modconfig/dev/<fileId>` |
| Index fails | 1440, 360 | Pass |
| Keyboard walk at 1440 | Pass, file tree buttons then the filter |
| Fixed in P7 | Filter input 39 px on phones; the load error used an `h3` straight under the `h1` (axe heading-order) |

### Config

| State | Widths | Result |
| --- | --- | --- |
| Form | all five | Pass |
| Dirty | 1440, 360 | Pass, the edit bar docks to the bottom on phones |
| Leave with unsaved changes | 1440, 360 | Pass. Focus on Stay, trapped, Escape stays on the page |
| Raw JSON | 1440, 360 | Pass |
| Config read fails | 1440, 360 | Pass |
| Keyboard walk at 1440 | Pass: tabs, group list, filter, then fields in order |
| Fixed in P7 | Inputs, the secret Show button and selects 39 to 43 px and switches 40 by 24 px on phones; the discard prompt focused "Discard and leave"; under 1100 px the group list and the Jump to group select both showed above the settings |

### Commands

| State | Widths | Result |
| --- | --- | --- |
| Global defaults | all five | Pass |
| Dirty | 1440, 360 | Pass |
| Reset confirm | 1440, 360 | Pass. Focus on Cancel, trapped, Escape closes, focus returns to Reset |
| Load fails | 1440, 360 | Pass |

### Guilds and guild config dialog

| State | Widths | Result |
| --- | --- | --- |
| Populated | all five | Pass |
| Discord rejects the bot token | 1440, 360 | Pass (the 502 is the forced failure) |
| No guilds | 1440, 360 | Pass |
| Guild with no known name | 1440, 360 | Pass, shows "Guild …1234" |
| Config dialog open | 1440, 360 | Pass. Close button 44 by 44 on phones (40 by 40 on desktop), trapped, focus returns to Edit config |
| Fixed in P7 | The close button was 40 px on phones; the unknown name was the hardcoded "Server …1234" |

### Setup wizard

| State | Widths | Result |
| --- | --- | --- |
| Guild step, Features step, Review step | all five | Pass |
| Keyboard | Pass. Focus stays in the dialog through all steps |
| Fixed in P7 | Pressing Next on the features step removed the focused button and dropped focus to the page; focus now moves to the new step |

## Fixed in this phase (commits on `refactor/w2c-p7-verify`)

- Shared component labels (InlineError, InlineBanner, FieldHint, JobBlock, TypedConfirmDialog) and the unknown guild name go through `t()`; these files are now under the literal-text lint.
- 44 px phone targets: dialog close and footer buttons, skip link, bot status link, inputs, selects, chips inputs, switches, Add to Discord, Log in with Discord.
- Sort picker for stacked tables on phones (Audit log, Analytics).
- Console copy, download and clear.
- Discard prompts focus Stay; the wizard keeps focus on step changes.
- Config group list hidden where the jump select replaces it; Mod config error heading level.

## Open issues

- **Backups copy bypasses `t()`.** `views/BackupsView.vue` keeps about 100 strings (several with plurals and placeholders) in a local `COPY` object and is not under the literal-text lint. Mechanical but large; left for a follow-up.
- **`InputChips` is deprecated in PrimeVue 4.** The Config form logs "Deprecated since v4. Use AutoComplete component instead with its typeahead property" (`components/schema/SchemaField.vue`). Replacing it changes the list fields' markup and tests.
- **Verbose names on Config section headers.** A collapsible section's button is named by its title, key and description together (for example "Bot presence presence Bot presence in the member list"). Usable, but long for screen reader users.
- The Servers view stays mounted (hidden) on every route, so the DOM holds a second, hidden `h1`. axe does not flag it.
- Under load the fake wrapper's RCON sometimes answered the player list late, and one capture showed "The player count is not available right now"; the affected screenshots were retaken. Not seen as a dashboard bug.
- Console copy, download and clear have no unit test: the view opens an `EventSource`, which jsdom does not provide. Verified in the browser only.

## Not verified

- A real phone or tablet (widths were emulated in desktop Edge; no touch, no on-screen keyboard, no safe areas).
- A screen reader. Names, roles, focus order and live regions were checked by axe and by script, not by listening.
- Live Discord: the bot gateway, OAuth login, real guild, channel and role lists, the invite flow and anything the bot posts. All Discord reads were stubbed.
- German copy. The dashboard is English only; the bot's German strings still need a native read.
- Mod script success paths (install, update, enable, disable, remove, restore and other suite scripts) need `sudo` on the Minecraft host and cannot run on Windows; the mod routes were answered by fixtures.
- Light theme (deferred) and browsers other than Edge.

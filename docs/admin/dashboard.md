# Using the dashboard

The web dashboard is optional (`webui` in [configuration.md](configuration.md)).
What each person sees depends on their capabilities
([capabilities.md](capabilities.md)): a page you may not use is not shown at
all. This page covers finding your way around; the feature pages are linked at
the end.

## Pages

The sidebar groups the pages:

| Group | Page | Address |
|---|---|---|
| Monitor | Overview | `#/overview` |
| | Analytics | `#/analytics/<server>`, `#/analytics/<server>/server` (Server tab) |
| | Players | `#/players/<server>`, `#/players/<server>/<player>` |
| | Console | `#/console/<server>` |
| | Audit log | `#/audit` |
| Manage | Servers | `#/servers` |
| | Backups | `#/backups/<server>` |
| | Mods | `#/mods/<server>` |
| | Mod config | `#/modconfig/<server>/<file>` |
| | Daily rewards | `#/rewards` (shared pool), `#/rewards/<server>` |
| Admin | Config | `#/config`, `#/config/raw` |
| | Commands | `#/commands` |
| | Guilds | `#/guilds/<guild id>` |

There is one server picker, in the sidebar. Pages that work on one server
follow it, and the server is part of the address.

## Links, reload and Back

Every page has its own address, so a reload keeps your place, Back goes to the
previous page, and a link can be pasted into a ticket. Some page state is part
of the address too:

- Mods: the version check and the result filter,
  `#/mods/<server>?check=1.21.4&filter=blockers` (`blockers` or `ready`)
- Analytics: the Server tab, `#/analytics/<server>/server` (Players is the default)
- Players: the open player, `#/players/<server>/<player>`. The search, filters and sort are not part of the address
- Mod config: the open file, `#/modconfig/<server>/<file>`
- Daily rewards: the shared pool or one server's override, `#/rewards/<server>` (see [daily-rewards.md](daily-rewards.md#editing-in-the-dashboard)). This page has its own picker, so it does not follow the sidebar's server picker
- Config: the filter, `#/config?q=tps`, and the Raw JSON tab, `#/config/raw`
- Guilds: the open guild, `#/guilds/<guild id>`

The bare dashboard address opens the first page you may see. A link to a page
you may not use, or to a server you cannot see, falls back the same way.

Leaving a page, switching server or pressing Back with unsaved edits asks
first. Closing the browser tab asks too.

## Phones

Below 760 px wide the sidebar becomes a menu: a top bar shows the menu button,
the page title and the server, and the menu opens a drawer that closes with
Escape or a tap outside. Tables turn into one card per row instead of scrolling
sideways, the edit bar of the editors docks to the bottom edge, and every
control is at least 44 px tall. Toasts appear top right, below the top bar on
phones, so they do not cover a Send or Save button.

## Density

"Roomy" or "Compact" in the sidebar sets row and control height. The choice is
stored per browser. On touch screens and phones controls keep their 44 px
minimum in both settings.

## Status shapes and colours

Every status chip has a shape and a label, so it reads without colour: a filled
circle for online, a diamond for degraded or not responding, a ring for offline
or failed, a dash for unknown, a dashed ring for pending, a check for applied.
The colours are the same as the side bar of the bot's Discord messages (see
[the commands page](../user/commands.md#how-replies-look)).

## Confirmations

Actions that are easy to undo run at once. Actions that disrupt players (stop,
restart, removing a mod) ask first and say what happens and how to undo it.
Actions without an undo (restoring or deleting a backup, rolling back a server)
ask you to type the server name or `delete`. Long actions show their progress
on the card or row they belong to, and a failed run keeps its exit code and
output there with "Try again".

## Backups

The Backups page shows the number of backups, the space they use and the newest
one, a type filter with counts, and the latest backup per type. "Create backup"
runs the setup suite's backup script (it needs `server:control`). Restore and
Delete name the file they act on and need a typed confirmation. A restore is
refused while the server is not confirmed stopped, with a link to Servers, and
the dialog says there is no undo, because the restore script keeps no copy of
the current world. A running restore shows its elapsed time, then the exit code
and the end of the script output. A read-only user sees which capability each
action needs.

## Mods

Every list of mods shows the project's Modrinth icon, or an initials tile when
there is none or it does not load. The dashboard looks the icons up on Modrinth
in bulk and serves them through its own image proxy; if Modrinth cannot be
reached, the rows show initials. The version check and its results are
described in [mods-version-check.md](../user/mods-version-check.md).

## Editors

Config, Mod config, Daily rewards, Commands and the guild settings dialog share one edit bar:
it says what is unsaved, wrong, conflicting or saving, and otherwise whether
the bot has applied the saved file. "Review changes" lists every change as was
and now. Secrets (the bot token, API keys) are password fields: they stay empty
with "Set. Type to replace.", and leaving one empty keeps the stored value.
Details are in [configuration.md](configuration.md#editing-the-config-in-the-dashboard)
and [mod-configs.md](mod-configs.md).

## Language and theme

The dashboard is English and dark only. The bot itself answers in each Discord
server's language (English or German).

# Mod config editor: what it lists and what it can edit

The dashboard's Mod config page reads config files through the wrapper and edits the ones it understands. It needs the `config:read` capability to view and `config:write` to save (see [capabilities.md](capabilities.md)).

## Where it looks

The wrapper lists text files under these roots of the server directory, plus `server.properties`:

- `config/`
- `defaultconfigs/`
- `world/serverconfig/`
- `plugins/`

It walks eight levels below a root, so `config/xaero/minimap/profiles/a/settings.json` is found. It skips directories named `cache`, `backups`, `logs`, `tmp`, `.git`, `node_modules` and `crash-reports`. A symlinked directory or file is followed only when its real path stays inside the same root.

Files are grouped under the first folder below the root (`config/xaero/...` belongs to `xaero`), and flat files such as `config/jei-client.toml` under the name before the first dash or dot.

## Passwords and access settings

`server.properties` and plugin configs can hold credentials (`rcon.password`, a bot token, a database password) and settings that decide who may join or command the server (`online-mode`, `white-list`, `enable-rcon`, `op-permission-level`). What the editor does with them depends on the wrapper's `mod-configs` version (shown in the startup report):

- **Version 2:** values of keys that look like credentials are shown as `<redacted by mc-api-server>`. Leave that value as it is and the real one is kept on save; type a new value to replace it. Protected `server.properties` keys (RCON, query, `online-mode`, whitelist, op and function permission levels, `enforce-secure-profile`, `level-name`, `server-ip`, `server-port`, `management-server*`) can only be changed by bot administrators (top-level `adminUsers`); anyone else gets an explanation instead of a save. A revert names the version it replaces, like a save does.
- **Version 1:** the wrapper shows these files unredacted, so only bot administrators see `server.properties` and `plugins/` in the editor. Everyone else with `config:read` sees mod configs only.

## Limits

| Limit | Value | What you see |
| --- | --- | --- |
| Files listed | 2000 | A warning above the list that some files are missing |
| File size | 1 MB | The file is listed as "too large" and cannot be opened or saved |
| Depth | 8 levels | Deeper files are not listed |

The wrapper keeps the list for a few seconds, so a file created a moment ago may take a few seconds to appear. A save clears it.

## Formats

| Files | Editor |
| --- | --- |
| `.toml` (Forge, NeoForge) | Typed form. Comments above a key become its description, range and allowed values. Keys under `[[array tables]]` and multi-line values are shown read-only. |
| `.json`, `.json5` | Typed form, any nesting depth. A file whose root is a list is edited as one value. |
| `.properties` | Typed form. Escapes such as `\:` are decoded; values continued over several lines are shown read-only. |
| `.cfg` in the legacy Forge layout (`general { B:key=true }`) | Typed form. Lists are read-only. |
| `.cfg`, `.conf`, `.ini` with `key = value` lines | Typed form. |
| `.yml`, `.yaml` | Scalar values only (numbers, booleans, strings), edited in place with the comments and quote style kept. Lists, block text, anchors and `yes/no/on/off` words are not shown. |
| `.txt` with `key:value` lines, as written by Xaero's Minimap, World Map and Lib | Typed form. Used only when every line of the file is a `#` comment or a `key:value` line. A key that appears more than once (such as `interface`) is read-only. |
| Any other listed file, and every waypoint file | Source text, read-only. |

A file that fails to parse, or parses with warnings, is shown read-only as well; fix it on the server or restore a snapshot.

Saving changes only the values you edited. Comments, key order, spacing and any line the editor does not understand are kept byte for byte, and a snapshot of the previous content is taken first (the last 10 are kept and can be restored from History).

## When a save fails

The dashboard says why: the file changed since you opened it (reload and re-apply), the result would be over 1 MB, the file no longer exists, or the wrapper is rate limiting. If the wrapper cannot be reached at all, the edit is queued and applied per field when it returns.

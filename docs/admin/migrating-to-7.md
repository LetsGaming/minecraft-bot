# Upgrading to 7.0

7.0.0 versions `config.json` and upgrades old files by itself. You do not edit
the file for the upgrade; start the bot and it does the rest.

## What happens on first start

1. The bot reads `config.json` and sees there is no `configVersion` (an old file
   counts as version 0).
2. It copies the untouched file next to it as
   `config.json.bak-v<old version>-<UTC timestamp>`, for example
   `config.json.bak-v0-20261010T201500Z`.
3. It writes the migrated file over `config.json` (temporary file plus rename,
   so a crash cannot leave a half-written config) with `"configVersion": 1` at
   the top. The migration reformats the file as standard indented JSON.
4. It logs one line per applied migration saying what changed, then validates
   the result as usual.

The next start finds the current version and changes nothing. The backup is
written before anything else. If the backup or the rewrite cannot be written
(a read-only mount, for instance), the file is left alone and the bot runs on
the migrated config in memory; the log says so. The bot never deletes backups.

The dashboard stamps the current `configVersion` on every save. A file whose
`configVersion` is newer than the running bot is refused with a message that
names both versions, instead of being loaded and half understood.

## What needs your input

Only one thing cannot be migrated automatically: **configs from before 5.0.0
that still describe local mode.** Those configured the bot to read the server's
files and open RCON itself, and carry no address of the API wrapper that now
does that work. A wrapper address cannot be guessed, so the bot stops, leaves
`config.json` untouched, and prints exactly what to add, for example:

```
Cannot start with /app/config.json: This config still describes local-mode
servers (removed in 5.0.0). ... config.json was left unchanged. Add:
  - servers.survival.apiUrl: the base URL of the API wrapper on the Minecraft host
  - servers.survival.apiKey: the wrapper's shared secret (or set API_KEY_SURVIVAL / API_KEY)
Then restart; the local-mode fields (serverDir, linuxUser, ...) are removed automatically.
```

Add those keys by hand (install the wrapper first, see
[remote-setup.md](remote-setup.md)), restart, and the migration removes
`serverDir`, `scriptDir`, `linuxUser`, `screenSession`, `useRcon`, `rconHost`,
`rconPort` and `rconPassword` for you. Background and the reasoning are in
[migrating-to-5.md](migrating-to-5.md).

An `apiKey` supplied through `API_KEY` or `API_KEY_<SERVER_ID>` in the
environment counts as present.

## Old layouts it understands

| Layout | Result |
|---|---|
| 5.x and 6.x configs (servers with `apiUrl` and `apiKey`) | Stamped with `configVersion`; nothing else changes. |
| Local-mode `servers` entries that also carry `apiUrl` and `apiKey` (a remote entry beside local ones) | The local-mode fields are removed from each entry. |
| The first single-server layout (`serverDir`, `linuxUser`, `screenSession` at the top level, no `servers`) | Moved into a `servers.default` entry, matching the id the old loader used. It had no guild settings, so there is nothing to move into `guilds`. Because it names no wrapper, you are asked for `servers.default.apiUrl` and `apiKey` as above. |
| Local-mode `servers` entries without `apiUrl` | Stops and lists what to add, as above. |

## Rolling back

Stop the bot, copy the backup over `config.json`, and run the previous release.
A 6.x bot warns about `configVersion` as an unknown option but still loads the
file, so a stamped config also works there.

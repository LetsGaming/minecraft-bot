# Upgrading to 7.0

7.0.0 versions `config.json` and upgrades old files by itself. You do not edit
the file for the upgrade; start the bot and it does the rest.

## What happens on first start

1. The bot reads `config.json` and sees there is no `configVersion` (an old file
   counts as version 0).
2. It copies the untouched file next to it as
   `config.json.bak-v<old version>-<UTC timestamp>` (milliseconds included), for example
   `config.json.bak-v0-20261010T201500123Z`.
3. It writes the migrated file over `config.json` (temporary file plus rename,
   so a crash cannot leave a half-written config) with `"configVersion": 1` at
   the top. The migration reformats the file as standard indented JSON.
4. It logs one line per applied migration saying what changed, then validates
   the result as usual.

The next start finds the current version and changes nothing. The backup is
written before anything else. If the backup or the rewrite cannot be written
(a read-only mount, for instance), the file is left alone and the bot runs on
the migrated config in memory; the log says so. The bot never deletes backups. On Linux the backup and any new `config.json` are created owner-only (`0600`), and a rewrite keeps the existing file's owner and group permission bits but never its "other" bits.

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

## Other things to check when upgrading

These are not config migrations, but each can change what you see after the upgrade.

- **Behind a reverse proxy, set `webui.trustProxy`.** The dashboard no longer trusts `X-Forwarded-For` by default, so without it every visitor looks like the proxy and shares one rate-limit address. See [docker.md](docker.md#reverse-proxy-and-client-addresses).
- **API keys must be at least 32 characters.** The wrapper refuses to start with a shorter key. Generate one with `openssl rand -hex 32` and use the same value for `apiKey` (or `API_KEY` / `API_KEY_<SERVER_ID>`).
- **Update the wrapper and the setup suite.** An older wrapper still works, but the startup report lists each feature it lacks (`rcon-command` v2, `stats-bulk`, `mod-compat`, the mod config index), and a console command that cannot be delivered is then reported as sent instead of failing. The wrapper's sudoers grant must include `node` for mod management; see [remote-setup.md](remote-setup.md).
- **`config_structure.json` is gone.** Use `config.template.json` for the shape and `config.schema.json` for every field.
- **Server choice is stricter.** A command resolves the server from its `server:` option, then the guild's `defaultServer`, then the guild's only allowed server. With several candidates and no default it fails and lists the IDs instead of using the first server of the deployment, and a `defaultServer` that no longer exists is an error instead of being replaced silently.
- **`/uptime` without `server:`** shows the default server's detail. The all-servers overview is `/uptime server:all`.
- **Moderation and whitelist commands report delivery.** `/ban`, `/kick`, `/pardon`, `/whitelist`, `/unwhitelist` and `/verify` tell the admin when the server could not be reached and record nothing in that case.
- **`timezone` and `featureNudges` now take effect.** They were read from `config.json` but dropped; a value you set earlier will start applying.

## Rolling back

Stop the bot, copy the backup over `config.json`, and run the previous release.
A 6.x bot warns about `configVersion` as an unknown option but still loads the
file, so a stamped config also works there.

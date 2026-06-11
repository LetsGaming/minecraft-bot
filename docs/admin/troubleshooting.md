# Troubleshooting

Problems sorted by symptom. The bot's own log (`logs/bot.log`, or `docker compose logs -f`) is always the first place to look; every subsystem logs with a tag like `[commands]`, `[rcon]`, `[status]`.

## Slash commands do not appear in Discord

- First-ever registration of global commands can take up to an hour. Wait, or restart the Discord client (Ctrl+R).
- Make sure the bot was invited with the `applications.commands` scope (re-run the invite URL from [setup.md](setup.md) if unsure).
- Check the log for `X slash commands registered.` If registration failed, the error is right there (usually a wrong `clientId` or token).

## "config.json validation failed at ..."

The bot tells you exactly which field is wrong, e.g. `servers.survival.rconPort: must be an integer between 1 and 65535`. Fix the named field; `config_structure.json` shows the expected shape for everything.

If the message is `Failed to load config.json`, the file is missing or not valid JSON. A trailing comma is the usual culprit; run it through a JSON validator.

## "Sudo is not configured correctly"

`/server` commands need passwordless sudo for two separate hops, and the error tells you which one failed:

- "The bot's OS user cannot switch to X via sudo -u" → Layer 1 missing.
- "The X user cannot run systemctl via sudo" → Layer 2 missing.

Full setup and verification commands: [sudoers.md](sudoers.md).

## RCON keeps failing / "RCON failed, screen fallback"

- `rcon.password` in `server.properties` must match `rconPassword` in the bot config (or the `RCON_PASSWORD` env var, which overrides the config).
- `enable-rcon=true` set and the Minecraft server restarted afterwards?
- From the bot machine: `nc -zv <rconHost> <rconPort>` should connect. If not, it is a firewall or wrong-host problem.
- An "RCON auth failed" log line means the connection works but the password is wrong.

## The bot says a server is offline but it is running

- RCON path: the probe sends `list` with a 3-second timeout and retries once. A heavily lagging server can miss that window; check TPS.
- Screen path: the bot looks for a screen session named `screenSession` owned by `linuxUser`, via sudo. Run `sudo -n -u <linuxUser> screen -list` as the bot user; if that asks for a password, see [sudoers.md](sudoers.md).
- Remote path: `curl -H "x-api-key: ..." http://<wrapper>/instances/<id>/running` should return `{"running":true}`.

## Chat bridge only works in one direction

- Discord → Minecraft missing: the **Message Content Intent** is probably disabled. Enable it in the Developer Portal (Bot page) and restart the bot.
- Minecraft → Discord missing: the log watcher cannot read the server log. For local setups, check that `serverDir` is right and the bot user can read `logs/latest.log`. For remote setups, check the wrapper's SSE stream (`Remote log stream connected` should appear in the bot log).

## A freshly whitelisted player is "not found" in /stats or autocomplete

The whitelist is cached in memory and currently not refreshed after `/whitelist` / `/unwhitelist`. Restart the bot to refresh, or wait for a fix. Stats also only exist once the player has joined the server at least once.

## /stats daily or scheduled leaderboards say "no snapshot available"

Snapshots are taken hourly starting from bot startup. Right after installation there is no baseline yet; the data appears after the first snapshot and becomes meaningful after a full period.

## Daily reward "Daily rewards data unavailable"

`data/dailyRewards.json` is missing or invalid JSON. See [daily-rewards.md](daily-rewards.md). In Docker, check that the volume seeding ran (`docker compose exec bot cat /app/data/dailyRewards.json`).

## "Too many commands. Please wait Xs."

Per-user rate limit: 5 commands per rolling 30 seconds. It protects the RCON connection; there is no config switch for it.

## Status embed channels keep coming back after I delete them

That is by design: the feature self-heals. To remove the channels permanently, disable the feature for the guild first (`"statusEmbed": { "enabled": false }`), reload the config, then delete the channels.

## Getting more detail

Set the `DEBUG` environment variable to any value (in `.env`, the PM2 ecosystem file, or the compose file) and restart. The bot then logs debug-level messages too.

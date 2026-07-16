# First-time setup

This guide takes you from nothing to a running bot. No prior Discord bot experience required.

## Quickstart (≈15–30 minutes)

The fastest path, if you just want it running:

1. Create the Discord application ([Step 1](#step-1-create-the-discord-application) below) — you need the **bot token**, the **application ID**, and the bot invited to your server.
2. On the Minecraft host: install the [API wrapper](remote-setup.md) (3.1.1+). The bot reaches every server through it — it owns the RCON connection, the server's files, and the management scripts. Note its URL and API key.
3. On the machine that will run the bot (anywhere that can reach the wrapper over HTTP):

   ```bash
   git clone <this repo> && cd minecraft-bot
   npm install
   npm run setup     # interactive wizard → writes config.json
   docker compose up -d
   ```

The wizard asks for the token, IDs, each server's wrapper URL and API key, and which optional features you want — nothing else. The bot validates the result on start and tells you exactly what to fix if something is off. Everything the wizard skipped can be added later in `config.json` ([full reference](configuration.md)); the file is hot-reloaded.

**Docker is the supported way to run the bot**, and the dashboard ships with it — see [docker.md](docker.md). It is a Node application and nothing stops you running `npm start` directly, but that is not a supported configuration and there is no guide for it.

Upgrading from 4.x? See [migrating-to-5.md](migrating-to-5.md) — 5.0.0 removed local mode, and 4.3.x is the last release that supported it.

## Plain server or setup-suite server?

The bot runs against any Minecraft Java server, but it is designed for servers installed with [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup). That suite provides the management scripts, the backup directory layout, and the mod manifest that some features call into. The bot detects at startup which of these artifacts each server actually provides (one log line per server summarizes the result): if **no** configured server has them, `/backup` and `/mods` are not registered at all; in mixed setups they stay available and the affected server answers with a clear message pointing here instead of a raw "Script not found" error. The same applies to the script-based `/server` subcommands (`/server prune-stats` works everywhere). Capabilities are re-checked on every config reload, so installing the suite later is picked up without restarting the bot — only command *registration* (the `/backup` / `/mods` skip) is decided once at startup.

What works where:

| Feature | Plain server | Setup-suite server |
|---|---|---|
| Status, stats, leaderboards, daily rewards, linking | ✅ | ✅ |
| Chat bridge, notifications, in-game commands | ✅ | ✅ |
| TPS + downtime monitoring, uptime, whitelist, seed/map tools | ✅ | ✅ |
| `/server start` / `stop` / `restart` / `status` | ❌ needs `start.sh`, `shutdown.sh`, `smart_restart.sh`, `misc/status.sh` | ✅ |
| `/server backup` and the `/backup` overview | ❌ needs `backup/backup.sh` and the suite's backup tier layout | ✅ |
| `/mods` | ❌ needs `{scriptsDir}/common/downloaded_versions.json` on the wrapper's host | ✅ |
| `variables.txt` config sync | ❌ | ✅ |

Three ways to proceed:

1. **Use the suite** (recommended if you are setting up a new server anyway): everything works out of the box, including the [API wrapper](remote-setup.md) for Docker/remote setups.
2. **Plain server, reduced feature set**: everything in the ✅ rows works over RCON and the server log. `/backup` and `/mods` disappear automatically when no server provides them; optionally also disable `/server` (if you don't need `prune-stats`) via the `commands` block in `config.json`:

   ```json
   "commands": {
     "server": { "enabled": false },
     "backup": { "enabled": false },
     "mods":   { "enabled": false }
   }
   ```

3. **Plain server, own scripts**: point the wrapper's `scriptsDir` at a directory providing the five scripts above with the same names and you get `/server` back without the suite. Your scripts receive no arguments (except backup, which gets `--archive` for archive backups) and must be runnable non-interactively as the wrapper's configured user. This is configured on the Minecraft host, in the wrapper — the bot has no filesystem access to your server.

## What you need

- A Discord account and a Discord server (guild) where you have admin rights
- A Minecraft Java Edition server you control
- A machine to run the bot on. Either with Docker, or with Node.js 18+ installed

## Step 1: Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**. Name it whatever you like.
2. Go to **Bot** in the left sidebar.
3. Click **Reset Token**, then copy the token. This is your `DISCORD_TOKEN`. Treat it like a password: anyone with this token controls your bot.
4. Still on the Bot page, scroll to **Privileged Gateway Intents** and enable **Message Content Intent**. The chat bridge cannot read Discord messages without it.
5. Go to **General Information** and copy the **Application ID**. This is your `DISCORD_CLIENT_ID`.

## Step 2: Invite the bot to your Discord server

1. In the Developer Portal, go to **OAuth2 → URL Generator**.
2. Under Scopes, check `bot` and `applications.commands`.
3. Under Bot Permissions, check at minimum:
   - View Channels, Send Messages, Embed Links, Read Message History
   - Manage Messages (for `/clear` and the channel purge feature)
   - Manage Channels (only needed if you use the self-provisioning status embed)
4. Open the generated URL, pick your server, and authorize.

## Step 3: Collect your Discord IDs

Several config values are Discord IDs (long numbers called snowflakes):

1. Discord Settings → Advanced → enable **Developer Mode**.
2. Right-click your own name → **Copy User ID**. That goes into `adminUsers`.
3. Right-click your server name → **Copy Server ID**. That is your guild ID.
4. Right-click any channel → **Copy Channel ID** for feature channels (chat bridge, notifications, etc.).

## Step 4: Prepare the Minecraft server

Enable RCON in your `server.properties`:

```
enable-rcon=true
rcon.port=25575
rcon.password=pick-a-strong-password
```

Restart the Minecraft server afterwards. The **wrapper** connects to RCON — the bot never does — so this password goes in the wrapper's config, on the Minecraft host, not in `config.json`.

RCON is strongly recommended. Without it the wrapper falls back to `screen`, which is slower, needs sudo configuration, and cannot read command responses, so anything that verifies its own result (daily rewards, challenge payouts) can only assume it worked.

Then install the wrapper itself: [remote-setup.md](remote-setup.md). This is required — the bot has no other way to reach a server.

## Step 5: Run the bot

[Docker](docker.md) is the supported way, and the dashboard ships with it. The guide includes the config step; the full reference for every config field is in [configuration.md](configuration.md).

The bot can run anywhere that can reach the wrapper over HTTP — it no longer needs to be on the Minecraft host, or to have any access to its filesystem.

There is also an interactive wizard that builds `config.json` for you by asking questions:

```bash
npm run setup
```

## Step 6: First start and verification

After starting the bot (per your chosen guide), check the logs. A healthy start looks like:

```
[INFO] [commands] 24 slash commands registered.
[INFO] [bot] Ready as YourBot#1234
[INFO] [bot] Servers: survival
[INFO] [bot] Guilds: 1
[INFO] [init] 1 server(s) initialized with all watchers
```

Then in Discord:

1. Type `/status`. You should get an online/offline embed for your server.
2. Type `/help` to see every registered command.

Slash commands are registered globally on startup. The very first registration can take up to an hour to show up in Discord. After that, they appear immediately.

## If something does not work

See [troubleshooting.md](troubleshooting.md). The most common first-start problems (commands missing, config validation errors, sudo failures) are covered there.

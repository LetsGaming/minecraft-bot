# First-time setup

This guide takes you from nothing to a running bot. No prior Discord bot experience required.

## Quickstart (≈15–30 minutes)

The fastest path, if you just want it running:

1. Create the Discord application ([Step 1](#step-1-create-the-discord-application) below) — you need the **bot token**, the **application ID**, and the bot invited to your server.
2. On the machine that will run the bot:

   ```bash
   git clone <this repo> && cd minecraft-bot
   npm install
   npm run setup     # interactive wizard → writes config.json
   npm run build
   npm start
   ```

The wizard asks for the token, IDs, your Minecraft server location (local path or [remote API wrapper](remote-setup.md)), and which optional features you want — nothing else. The bot validates the result on start and tells you exactly what to fix if something is off. Everything the wizard skipped can be added later in `config.json` ([full reference](configuration.md)); the file is hot-reloaded.

For a permanent installation (auto-restart, boot persistence) continue with [Docker](docker.md) or [PM2](pm2.md) once the bot works.

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
| `/mods` | ❌ needs `{scriptDir}/common/downloaded_versions.json` | ✅ |
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

3. **Plain server, own scripts**: point `scriptDir` at a directory providing the five scripts above with the same names and you get `/server` back without the suite. Your scripts receive no arguments (except backup, which gets `--archive` for archive backups) and must be runnable non-interactively as `linuxUser`.

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

Restart the Minecraft server afterwards. RCON is strongly recommended. Without it the bot falls back to `screen` sessions, which is slower, needs sudo configuration, and cannot read command responses.

If the bot runs on a different machine than the Minecraft server (this includes the bot running in Docker on the same host), you also need the API wrapper. See [remote-setup.md](remote-setup.md).

## Step 5: Choose how to run the bot

| Path | When to pick it | Guide |
|---|---|---|
| Docker | Recommended. Self-contained, restart-safe, no Node.js install needed. Requires the API wrapper for server access. | [docker.md](docker.md) |
| PM2 on the host | Bot runs directly on the same machine as the Minecraft server, with full filesystem access. | [pm2.md](pm2.md) |

Both guides include the config step. The full reference for every config field is in [configuration.md](configuration.md).

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

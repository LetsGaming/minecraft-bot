# First-time setup

This guide takes you from nothing to a running bot. No prior Discord bot experience required.

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

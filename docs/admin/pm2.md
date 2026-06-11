# Running with PM2 (bare metal)

Run the bot directly on the machine that hosts the Minecraft server. This gives the bot direct filesystem access (stats, whitelist, logs) and screen access without the API wrapper.

## Prerequisites

- Node.js 18 or newer (`node --version`)
- A filled-in `config.json` (see [configuration.md](configuration.md))
- RCON enabled on the Minecraft server, or [sudoers configured](sudoers.md) for the screen fallback

## Install and configure

```bash
git clone <your-repo-url> minecraft-bot
cd minecraft-bot
npm install
cp config_structure.json config.json
# fill in config.json, or run: npm run setup
```

Minimal working config for one server:

```json
{
  "token": "your-discord-bot-token",
  "clientId": "your-discord-app-id",
  "adminUsers": ["your-discord-user-id"],
  "servers": {
    "survival": {
      "serverDir": "/path/to/your/minecraft/server",
      "useRcon": true,
      "rconPort": 25575,
      "rconPassword": "your-rcon-password"
    }
  },
  "guilds": {
    "your-guild-id": { "defaultServer": "survival" }
  }
}
```

## Start with PM2

PM2 keeps the bot alive across crashes and reboots. The repo ships a ready `ecosystem.config.cjs` (single fork instance, 512 MB memory restart limit, source maps enabled, JSON logs under `logs/`).

```bash
npm install -g pm2

npm run pm2:start      # builds TypeScript, then starts via PM2 in production mode
npm run pm2:logs       # tail logs
npm run pm2:restart    # rebuild + restart after a code update
npm run pm2:stop       # stop

pm2 save               # remember the process list
pm2 startup            # print the command that enables autostart on boot; run it as root
```

## Start without PM2 (testing only)

```bash
npm run build
npm start
```

This dies with the terminal. Use PM2 (or Docker) for anything long-running.

## Which user should run the bot?

Run the bot as its own unprivileged user (for example `discord-bot`), not as root and not as the Minecraft user. The `/server` commands then switch to the Minecraft user via `sudo -u`, which requires a one-time sudoers rule. See [sudoers.md](sudoers.md).

If you never use `/server start/stop/restart/backup` and rely purely on RCON, no sudo configuration is needed.

## Updating

```bash
git pull
npm install
npm run pm2:restart
```

## Logs

| Location | Content |
|---|---|
| `logs/bot.log` | The bot's own structured log (also printed to stdout) |
| `logs/pm2-out.log`, `logs/pm2-error.log` | PM2-captured stdout/stderr |

Set the `DEBUG` environment variable to any value for verbose logging.

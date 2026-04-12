# Minecraft Discord Bot

A Discord bot for managing one or more Minecraft servers. Bridges chat between Discord and Minecraft, tracks player stats, posts leaderboards, monitors server health, and gives admins control over the server without SSH.

## Features

- **Chat bridge** — Messages flow both ways between a Discord channel and the Minecraft server chat.
- **Server control** — Start, stop, and restart servers from Discord (admin-only).
- **Player stats** — Playtime, kills, deaths, blocks mined, distance walked — per player and as leaderboards.
- **Scheduled leaderboards** — Auto-posts a leaderboard (daily/weekly/monthly) showing only stats gained during that period.
- **Live status embed** — A persistent, auto-updating embed showing server status, player list, and TPS.
- **Downtime alerts** — Notifies a channel when a server goes down unexpectedly and again when it recovers.
- **TPS alerts** — Warns when server performance drops below a threshold.
- **Whitelist management** — Admin-only whitelist add/remove with an audit trail of who added whom.
- **Account linking** — Players link their Discord and Minecraft accounts for personalized commands.
- **Daily rewards** — Linked players can claim daily in-game item rewards with streak bonuses.
- **In-game commands** — Players can use `!commands` in Minecraft chat for Chunkbase links, nether portal math, and more.
- **Event notifications** — Join/leave, deaths, advancements, and server start/stop events posted to Discord.
- **Multi-server** — All features work across multiple server instances from a single bot.

## Quickstart

### Prerequisites

- Node.js 18 or higher
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- A Minecraft server with RCON enabled (recommended) or running in a `screen` session
- The bot must run on the same machine as the Minecraft server (it reads log files and stats directly)

### Install

```bash
git clone <your-repo-url> minecraft-bot
cd minecraft-bot
npm install
```

### Configure

Copy the example config and fill in your values:

```bash
cp config_structure.json config.json
```

At minimum, set these fields in `config.json`:

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
    "your-guild-id": {
      "defaultServer": "survival"
    }
  }
}
```

See [docs/configuration.md](docs/configuration.md) for the full config reference.

### Run

```bash
npm start
```

The bot registers slash commands globally on startup. They may take up to an hour to appear in Discord for the first time.

## Documentation

Full documentation lives in [`docs/index.md`](docs/index.md).

**For players** — how to link accounts, use stats, claim daily rewards, and use in-game commands.

**For admins** — full config reference, command list, automated features, and permission management.

## Data Files

The bot stores runtime data in the `data/` directory:

| File | Purpose |
|---|---|
| `linkedAccounts.json` | Discord ↔ Minecraft account links |
| `linkCodes.json` | Pending link codes (expire after 5 min) |
| `claimedDaily.json` | Daily reward claim history and streaks |
| `whitelistAudit.json` | Who whitelisted/unwhitelisted whom and when |
| `leaderboardSchedule.json` | Last leaderboard post timestamp per guild |
| `statusMessages.json` | Stored message IDs for persistent status embeds |
| `snapshots/` | Hourly stat snapshots for delta leaderboards |

These are all auto-created on first use. The `snapshots/` directory is self-cleaning — old snapshots are pruned automatically.

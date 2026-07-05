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
- **Community waypoints** — Players save and share named coordinates in-game (`!waypoint`), browsable from Discord (`/waypoints`).
- **Cross-platform polls** — One poll, votable via Discord buttons and in-game `!vote`, with linked accounts counted once.
- **Advancement challenges** — "First player to earn X wins" events with automatic winner detection and optional item bonuses.
- **Offline daily claims** — `/daily` while offline queues the reward for the next join instead of breaking the streak.
- **Sessions & last-seen** — Per-player session history (`/sessions`), surfaced in `/whois` too.
- **Admin notes & reports** — `/note` keeps moderation memory per player; in-game `!report` reaches the admin channel.
- **Auto-role on link** — Members get a configurable role when they link their Minecraft account.
- **Host monitoring** — Process RAM/CPU and disk usage in `/status`, plus disk-full early-warning alerts.
- **Web dashboard** — Optional browser panel (separate process): Discord-OAuth2 admin login, live status, schema-driven config editing, server operations, log tail, and a Prometheus `/metrics` endpoint.
- **Scheduled restarts** — Wall-clock restarts per server with in-game countdown warnings and Discord notifications.
- **Whitelist applications** — Players apply via a button + modal; admins approve or deny from a queue channel.
- **Console access** — `/console tail` and an opt-in, flood-protected live log relay into an admin channel.
- **Moderation shortcuts** — `/kick`, `/ban`, `/pardon` with reasons, all audit-logged.
- **Activity insights** — `/activity` shows when a server is busy (24h sparkline + busiest hours); `/profile` is the one-stop player card.
- **Watch notifications** — One-shot DMs when a server recovers or a friend joins (`/watch`).
- **Milestones** — Automatic "X just passed 1,000 hours" shout-outs, in-game and on Discord.
- **Webhook chat bridge** — MC chat can appear as the player (name + head) instead of a bot embed.
- **Per-guild language** — English and German, switchable per Discord server.
- **Multi-server** — All features work across multiple server instances from a single bot, including span polls across servers.

---

## Quickstart

### Run with Docker (recommended)

Docker is the recommended deployment path. The bot connects to your Minecraft server via the [API wrapper](docs/remote-setup.md), which can run on the same machine or a different one.

```bash
git clone <your-repo-url> minecraft-bot && cd minecraft-bot

# 1. Copy and fill in your environment variables
cp .env.example .env
# Edit .env — set DISCORD_TOKEN, DISCORD_CLIENT_ID, MC_API_URL, etc.

# 2. Build and start
docker compose up -d

# 3. Follow startup logs
docker compose logs -f
```

See [docs/docker.md](docs/docker.md) for the full guide, including the static `config.json` option for complex multi-server setups.

### Run without Docker (PM2)

For running directly on the host with Node.js and PM2:

**Prerequisites:** Node.js 18+, a Discord bot token, a Minecraft server with RCON enabled or running in a `screen` session.

```bash
git clone <your-repo-url> minecraft-bot
cd minecraft-bot
npm install
```

Copy the config template and fill in your values:

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

```bash
npm run pm2:start
```

The bot registers slash commands globally on startup. They may take up to an hour to appear in Discord for the first time.

---

## Documentation

Full documentation lives in [`docs/index.md`](docs/index.md).

**For players** — how to link accounts, use stats, claim daily rewards, and use in-game commands.

**For admins** — full config reference, command list, automated features, and permission management.

---

## Development

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

See [docs/decisions.md](docs/decisions.md) for architectural decisions and Golden Rules enforced in code review.

---

## Data Files

The bot stores runtime data in the `data/` directory (or `bot_data` Docker volume):

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

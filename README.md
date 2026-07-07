# Minecraft Discord Bot

[![CI](https://github.com/LetsGaming/minecraft-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/LetsGaming/minecraft-bot/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A520-3c873a)](https://nodejs.org)
[![Release](https://img.shields.io/github/v/tag/LetsGaming/minecraft-bot?label=release&sort=semver)](https://github.com/LetsGaming/minecraft-bot/releases)

Run one or more Minecraft servers from Discord: a two-way chat bridge, player
stats and scheduled leaderboards, health and performance monitoring, and full
server control without touching SSH. An optional web dashboard adds a
browser-based admin login, live status, and a guided per-guild setup.

The bot talks to each Minecraft server through a small [API wrapper](docs/admin/remote-setup.md)
that can run on the same machine or a different one, so a single bot can manage
several servers, local or remote.

## Highlights

- **Chat bridge** between Discord and in-game chat, optionally rendered as the
  player (name and skin) via webhooks.
- **Stats and leaderboards** per player, with daily/weekly/monthly boards that
  count only the activity gained in that window.
- **Monitoring** with a live status embed, downtime and low-TPS alerts, and
  host RAM/CPU/disk readouts.
- **Server control** from Discord (start, stop, restart, backup, scheduled
  restarts with in-game countdowns), all admin-gated and audit-logged.
- **Account linking** unlocking personalized commands, daily rewards with
  streaks, a linked role, and whitelist self-service.
- **Web dashboard** (optional, separate process) with Discord OAuth2 login,
  server operations, schema-driven config editing, and a guided setup that
  reads a guild's channels and roles from Discord.

The full catalogue, grouped and explained, lives in [`docs/features.md`](docs/features.md).

## Quick start

### Docker (recommended)

```bash
git clone https://github.com/LetsGaming/minecraft-bot
cd minecraft-bot

cp .env.example .env          # set DISCORD_TOKEN, DISCORD_CLIENT_ID, MC_API_URL, …
docker compose up -d
docker compose logs -f
```

That path expands `config.template.json` from your `.env` at startup. For
multi-server or more involved setups, generate a full `config.json` with the
wizard and mount it instead:

```bash
npm run setup                 # interactive; writes config.json
```

The [Docker guide](docs/admin/docker.md) covers both paths, the reverse-proxy
setup for the dashboard, and troubleshooting.

### Without Docker (PM2)

Requires Node.js 20 or newer (24 LTS recommended) and a Minecraft server
reachable over RCON or the API wrapper.

```bash
git clone https://github.com/LetsGaming/minecraft-bot
cd minecraft-bot
npm ci
npm run setup                 # or: cp config_structure.json config.json and edit
npm run pm2:start
```

Slash commands register globally on first start and can take up to an hour to
appear in Discord the first time. Full instructions are in the
[setup guide](docs/admin/setup.md) and [PM2 guide](docs/admin/pm2.md).

## Web dashboard

The dashboard is a separate process (`npm run start:web`, or the `web` profile
in Docker). It offers a Discord OAuth2 admin login, live server status and
operations, a schema-driven config editor, an audit log, a one-click invite to
add the bot to a new server, and a guided per-guild setup that populates
channel and role pickers directly from Discord. It exposes a Prometheus
`/metrics` endpoint and runs independently of the bot: either process can be
down without affecting the other. See the [dashboard docs](docs/admin/docker.md#the-web-dashboard-optional)
for enabling and securing it.

## Documentation

Everything is indexed in [`docs/index.md`](docs/index.md).

| Audience | Start here |
|---|---|
| Players | [Getting started](docs/user/getting-started.md), [commands](docs/user/commands.md), [linking](docs/user/linking.md) |
| Admins | [Setup](docs/admin/setup.md), [configuration](docs/admin/configuration.md), [permissions](docs/admin/permissions.md), [automated features](docs/admin/automated-features.md) |
| Deploying | [Docker](docs/admin/docker.md), [remote/API wrapper](docs/admin/remote-setup.md), [PM2](docs/admin/pm2.md) |
| Contributors | [Architecture](docs/dev/architecture.md), [adding features](docs/dev/adding-features.md), [coding guidelines](docs/dev/coding-guidelines.md), [testing](docs/dev/testing.md) |
| Reference | [Full feature list](docs/features.md), [roadmap](docs/ROADMAP.md) |

## Architecture

The repository is a single npm workspace. The layout mirrors the product: the
bot is the main artifact, the dashboard an optional extension, and both build on
shared packages.

```
src/bot       the Discord bot (the product)
src/web       the dashboard: one package, backend/ (Fastify) + frontend/ (Vue 3)
src/core      process-agnostic core: config, data layer, server access, RCON
src/schema    isomorphic contracts: config types + web API DTOs (browser-safe)
```

`src/bot` never imports `src/web` or vice versa. Both depend only on the shared
packages, enforced by ESLint boundary rules and workspace-scoped installs, so
either process runs and restarts independently. Design decisions and the rules
enforced in review are in [`docs/dev/decisions.md`](docs/dev/decisions.md).

## Development

```bash
npm ci                 # one install for every workspace (single root lockfile)
npm run build          # schema generation + bot
npm run build:all      # everything, including the dashboard backend and frontend

npm start              # run the bot
npm run start:web      # run the dashboard

npm test               # run the test suite once
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
npm run lint           # ESLint, including the layer-boundary rules
npm run typecheck      # tsc across bot and web
```

The config schema (`config.schema.json`) is generated from the TypeScript
types; `npm run schema:check` verifies it is in sync, and CI enforces it along
with locale parity (`npm run i18n:check`).

## Data and state

Runtime state lives in `data/` (or the `bot_data` Docker volume). Machine-written
state sits in a single SQLite database (`bot.db`, WAL mode) that both the bot and
dashboard write to safely; hand-edited pools such as `dailyRewards.json` stay
JSON. Everything is created on first use, and upgrading from 3.x imports the old
JSON stores automatically. Details are in [`docs/dev/data-storage.md`](docs/dev/data-storage.md).

## Contributing

Issues and pull requests are welcome. Please read the
[coding guidelines](docs/dev/coding-guidelines.md) and
[architecture overview](docs/dev/architecture.md) first, keep the layer
boundaries intact, and make sure `npm run lint`, `npm run typecheck`, and
`npm test` pass. New user-facing strings need both English and German entries
(`npm run i18n:check`).

## License

No license has been set yet, so the default of exclusive copyright applies.
A license file will be added; until then, contact the maintainer before reusing
the code.

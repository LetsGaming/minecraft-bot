# Documentation

The documentation is split by audience. Pick your section:

> **Note:** The bot works with any Minecraft Java server, but is designed for servers installed via [minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup). Some features (`/server`, `/backup`, `/mods`) depend on files that suite provides. The feature matrix and your options on a plain server are in [admin/setup.md](admin/setup.md#plain-server-or-setup-suite-server).

## Admins (`docs/admin/`)

You host the bot and/or the Minecraft server.

| Topic | File |
|---|---|
| First-time setup (Discord app, invite, first start) | [admin/setup.md](admin/setup.md) |
| Full `config.json` reference | [admin/configuration.md](admin/configuration.md) |
| Running the bot with Docker | [admin/docker.md](admin/docker.md) |
| Installing the API wrapper on the Minecraft host | [admin/remote-setup.md](admin/remote-setup.md) |
| Upgrading from 4.x | [admin/migrating-to-5.md](admin/migrating-to-5.md) |
| Admin permissions, whitelist, audit trail | [admin/permissions.md](admin/permissions.md) |
| Configuring daily rewards and streak bonuses | [admin/daily-rewards.md](admin/daily-rewards.md) |
| Automated features (bridge, alerts, status embed, ...) | [admin/automated-features.md](admin/automated-features.md) |
| Common problems and how to fix them | [admin/troubleshooting.md](admin/troubleshooting.md) |

## Users (`docs/user/`)

You use the bot as a Discord member or Minecraft player.

| Topic | File |
|---|---|
| What the bot can do for you | [user/getting-started.md](user/getting-started.md) |
| Every command, with examples | [user/commands.md](user/commands.md) |
| Linking Discord and Minecraft | [user/linking.md](user/linking.md) |
| Stats, comparisons, leaderboards | [user/stats-and-leaderboards.md](user/stats-and-leaderboards.md) |
| Daily rewards and streaks | [user/daily-rewards.md](user/daily-rewards.md) |
| Commands you type in Minecraft chat | [user/in-game-commands.md](user/in-game-commands.md) |
| How the Discord ↔ Minecraft chat bridge works | [user/chat-bridge.md](user/chat-bridge.md) |

## Project

| I want to… | Read this |
|---|---|
| See the full feature list, grouped and explained | [features.md](features.md) |
| See what is planned and what could come next | [ROADMAP.md](ROADMAP.md) |

## Developers (`docs/dev/`)

You want to change the code or contribute.

Start at [dev/readme.md](dev/readme.md) — it maps the rest. The docs are split
the way the repo is: what is true everywhere sits in `dev/`, and each workspace
has its own directory.

| Topic | File |
|---|---|
| Map of the developer docs | [dev/readme.md](dev/readme.md) |
| How the codebase is structured and why | [dev/architecture.md](dev/architecture.md) |
| Where a new command, watcher, or stat goes | [dev/adding-features.md](dev/adding-features.md) |
| Coding rules enforced in review | [dev/coding-guidelines.md](dev/coding-guidelines.md) |
| Shared contracts (`@mcbot/schema`) | [dev/contracts.md](dev/contracts.md) |
| Running and writing tests | [dev/testing.md](dev/testing.md) |
| Architectural decision log | [dev/decisions.md](dev/decisions.md) |
| The Discord process | [dev/bot/](dev/bot/readme.md) |
| Config, data layer, server access, Minecraft domain | [dev/core/](dev/core/readme.md) |
| The dashboard (backend + frontend) | [dev/web/](dev/web/readme.md) |

## Quick reference

| I want to... | Go to |
|---|---|
| Set the bot up for the first time | [admin/setup.md](admin/setup.md) |
| Link my Discord to Minecraft | [user/linking.md](user/linking.md) |
| Check my playtime | [user/stats-and-leaderboards.md](user/stats-and-leaderboards.md) |
| Whitelist a player | [admin/permissions.md](admin/permissions.md) |
| Add a new slash command | [dev/bot/commands.md](dev/bot/commands.md) |

# Automated Features

These features run in the background without user interaction. Each one is activated by adding the corresponding section to your guild config. See [configuration.md](configuration.md) for the config format.

## Chat Bridge

**Config key:** `chatBridge`

Bridges messages between a Discord channel and the Minecraft server chat in both directions.

- Discord → Minecraft: Messages sent in the configured channel are forwarded to the server as `[DiscordName] message`.
- Minecraft → Discord: Player chat messages appear in the Discord channel.

Bot messages and commands are ignored to prevent loops.

## Event Notifications

**Config key:** `notifications`

Posts server events to a Discord channel. You choose which event types to include in the `events` array. Supported types are listed in `config_structure.json`.

## Status Embed

**Config key:** `statusEmbed`

A single persistent message that the bot keeps up to date on a regular interval. It shows online/offline status per server, player count and names, and current TPS (if RCON is available).

The bot sends the message once on startup, stores its ID, and edits it on a timer. If the message gets deleted (manually or by a channel purge), the bot detects this on the next update cycle and sends a new one automatically. No manual intervention needed.

**Tip:** Use a dedicated channel (e.g. `#server-status`) so the embed stays visible and doesn't get buried by conversation.

## TPS Alerts

**Config key:** `tpsAlerts`

Monitors server TPS via RCON at a configurable interval. When TPS drops below the configured threshold, it posts a warning embed with the current TPS readings. Both the threshold and polling interval can be adjusted in the global config settings.

Alerts are rate-limited to avoid spam during sustained lag — repeated warnings for the same server are suppressed for a cooldown period.

Requires RCON to be enabled on the Minecraft server.

## Downtime Alerts

**Config key:** `downtimeAlerts`

Periodically checks whether each server is running (via RCON or screen session).

**False-positive prevention:**
- Only alerts after **multiple consecutive failed checks**. A single failed check is ignored — this handles brief network hiccups or momentary lag.
- When an admin uses `/server stop` or `/server restart`, alerts are **automatically suppressed for a grace period**. Planned maintenance never triggers a false alarm.
- Only one "server down" alert is sent per downtime event, no matter how long the server stays down.

When the server comes back online, a recovery notification is sent.

## Leaderboard Scheduler

**Config key:** `leaderboard`

Auto-posts a playtime leaderboard at a configured interval (`daily`, `weekly`, or `monthly`).

Unlike the manual `/leaderboard` command which shows all-time stats, the scheduled leaderboard shows **only stats gained during the period**. A weekly leaderboard only counts playtime earned in the last 7 days.

**How it works:** The bot periodically takes stat snapshots, storing each player's leaderboard-relevant values. When a leaderboard is due, it compares current stats against the snapshot closest to the start of the period and ranks players by the difference.

If no snapshot exists for the period (e.g. the bot was just installed), it falls back to all-time stats and notes this in the embed footer.

**Snapshot cleanup:** Old snapshots are automatically pruned. Recent snapshots keep higher resolution, older ones are consolidated to one per day, and anything beyond the longest possible interval is deleted.

## Daily Rewards

Players with linked accounts can claim a daily reward using `/daily`. The reward is a random in-game item given directly via the server console. A streak system tracks consecutive daily claims and awards bonuses at configurable milestones.

Rewards and streak bonuses are configured in `data/dailyRewards.json`.

## In-Game Commands

Players can type commands in the Minecraft chat (prefixed with `!`). The bot detects these by watching the server log file. Type `!commands` in-game to see what's available.

Each command has a per-player cooldown to prevent spam. New in-game commands can be added by creating a file in `logWatcher/commands/` using the `defineCommand()` helper.

## Log Watcher

All event-driven features (chat bridge, notifications, in-game commands) work through the log watcher system. It monitors each server's `logs/latest.log` using filesystem events with a polling fallback. No configuration is needed — it starts automatically for every configured server.

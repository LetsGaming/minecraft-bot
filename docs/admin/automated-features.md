# Automated features

These run in the background, no user interaction needed. Each one is activated by adding the matching block to your guild config (format in [configuration.md](configuration.md)).

## Chat bridge

**Config key:** `chatBridge`

Two-way bridge between one Discord channel and the Minecraft chat.

- Minecraft → Discord: player chat appears in the channel as an embed with the player's head avatar. Messages starting with `!` (in-game commands) are not bridged.
- Discord → Minecraft: messages in the channel are forwarded as `[DiscordName] message` via `/say`. Names are capped at 32 characters, messages at 160, and control characters are stripped so nothing can be smuggled into the server console. Non-ASCII characters (umlauts, emoji) are currently stripped as part of that sanitization.

Bot messages are ignored to prevent loops.

## Event notifications

**Config key:** `notifications`

Posts server events to a channel. Pick the events you want in the `events` array:

| Event | Triggered by |
|---|---|
| `join` / `leave` | Player joins or leaves |
| `death` | Any vanilla death message |
| `advancement` | Advancements, challenges, and goals |
| `start` / `stop` | Server finishing startup / beginning shutdown. Stop messages include the uptime since the last start the bot observed. |

In multi-server setups, every configured server's events are posted to the channel (the embed footer names the source server). There is currently no per-server filter for this block.

## Status embed

**Config key:** `statusEmbed`

A live status display the bot fully manages itself. On startup it creates (or finds) a private "📊 Server Status" category containing:

- `#server-status`: a text channel with one embed showing, per server: online/offline, player count and names, and TPS. Edited every 60 seconds.
- `👥 Players: X / Y`: a voice channel used purely as a counter display. Renamed only when the count changes, because Discord limits channel renames to 2 per 10 minutes.

If someone deletes the channels or the message, the bot recreates them on the next cycle. State is persisted in `data/statusMessages.json`, so the same message keeps being edited across restarts.

Enabled by default for every configured guild; turn it off with `"statusEmbed": { "enabled": false }`. Requires the Manage Channels permission.

## TPS alerts

**Config key:** `tpsAlerts`

Polls TPS at `tpsPollIntervalMs` (default 60 s). When it drops below `tpsWarningThreshold` (default 15), a warning embed with the 1/5/15-minute readings is posted. Repeated warnings for the same server are suppressed for 5 minutes so sustained lag does not flood the channel.

Works on Paper/Spigot/Purpur via the `tps` command, and on vanilla 1.20.3+ via `tick query` (TPS derived from MSPT, with tick-timing percentiles when available). Requires RCON or the API wrapper.

## Downtime alerts

**Config key:** `downtimeAlerts`

Checks every server once a minute (RCON probe, API wrapper, or screen session, in that order of preference).

False-positive protection:

- Alerts only after 3 consecutive failed checks (about 3 minutes of downtime). A single blip is ignored, and each RCON probe retries once internally.
- `/server stop` and `/server restart` suppress alerts for 5 minutes, so planned maintenance never pages anyone.
- Exactly one "down" alert per outage, plus one recovery message when the server returns.

These checks also feed the `/uptime` command's history.

## Leaderboard scheduler

**Config key:** `leaderboard`

Auto-posts two leaderboards (playtime and blocks mined) at the configured interval: `daily`, `weekly`, or `monthly`.

Unlike `/leaderboard` (all-time), scheduled posts show only stats gained during the period. The bot takes a stat snapshot every hour; when a post is due, it diffs current stats against the snapshot closest to the period start. The embed footer is honest about data quality: if the bot has been tracking for less than a full period, it says so, and with no snapshot at all it falls back to all-time values and labels them as such.

Snapshots are pruned automatically: full hourly resolution for the last day, one per day after that, nothing older than 31 days (except the newest snapshot, which is always kept).

## Channel purge

**Config key:** `channelPurge`

Once a day at local midnight (your `TZ`, DST-safe), deletes every message in the configured channel except pinned messages and the status embed. Useful for keeping a bot-spam or bridge channel clean. Messages older than 14 days are deleted one by one (a Discord API restriction), which is slower but works.

## Sleep prompt (built-in, no config)

A small community feature for German-speaking servers: when a player lying in bed types exactly `liege wie` in chat at night, every awake player gets a full-screen title nudging them to go to sleep. The tone matches the message: lowercase input gets dry lowercase titles, ALL CAPS gets shouted ones. Per-server cooldown of 10 seconds. It is always active and currently not configurable.

## Log watcher (infrastructure)

Everything event-driven (bridge, notifications, in-game commands, sleep prompt) runs on the log watcher. For local servers it tails `logs/latest.log` using filesystem events with a 1-second polling fallback, capped at 1 MB per read cycle so a huge backlog after a restart cannot stall the bot. For remote servers it consumes the API wrapper's SSE stream with automatic reconnects. No configuration needed; it starts for every server.

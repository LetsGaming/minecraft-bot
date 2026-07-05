# Automated features

These run in the background, no user interaction needed. Each one is activated by adding the matching block to your guild config (format in [configuration.md](configuration.md)).

## Chat bridge

**Config key:** `chatBridge` — one entry or an array of entries

Two-way bridge between a Discord channel and **exactly one** server. The binding applies in both directions, so a channel never mixes conversations from different servers: replies always land on the server the conversation came from. Multi-server guilds use one channel per server (array form); see [configuration.md](configuration.md#chat-bridges-one-channel--one-server) for the config shapes and validation rules.

- Minecraft → Discord: player chat from the bound server appears in the channel as an embed with the player's head avatar. Messages starting with `!` (in-game commands) are not bridged.
- Discord → Minecraft: messages in the channel are forwarded to the bound server as `[DiscordName] message` via `/say`. Names are capped at 32 characters, messages at 160, and Unicode control characters are stripped so nothing can be smuggled into the server console. Printable Unicode (umlauts, accents, emoji) is forwarded unchanged.

Bot messages are ignored to prevent loops. A per-user rate limit (8 messages / 10 s) stops console flooding; over-limit messages get a ⏳ reaction instead of being forwarded.

## Event notifications

**Config key:** `notifications`

Posts server events to a channel. Pick the events you want in the `events` array:

| Event | Triggered by |
|---|---|
| `join` / `leave` | Player joins or leaves |
| `death` | Any vanilla death message |
| `advancement` | Advancements, challenges, and goals |
| `challenge` | Advancement-challenge lifecycle: a `/challenge start` announcement and the winner embed when someone earns the target advancement |
| `start` / `stop` | Server finishing startup / beginning shutdown. Stop messages include the uptime since the last start the bot observed. |

The `server` field controls which servers feed the channel: one ID, a list of IDs, or omitted for every server this guild can see (the embed footer names the source server whenever more than one server is configured). See [Server scoping](configuration.md#server-scoping-one-several-or-all).

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

Auto-posts two leaderboards (playtime and blocks mined) at the configured interval: `daily`, `weekly`, or `monthly`. Names come from the whitelist plus the server's `usercache.json`, so the boards fill on servers that run without a whitelist too.

Unlike `/leaderboard` (all-time), scheduled posts show only stats gained during the period. The bot takes a stat snapshot every hour; when a post is due, it diffs current stats against the snapshot closest to the period start. The embed footer is honest about data quality: if the bot has been tracking for less than a full period, it says so, and with no snapshot at all it falls back to all-time values and labels them as such.

Snapshots are pruned automatically: full hourly resolution for the last day, one per day after that, nothing older than 31 days (except the newest snapshot, which is always kept).

## Channel purge

**Config key:** `channelPurge`

Once a day at local midnight (your `TZ`, DST-safe), deletes every message in the configured channel except pinned messages and the status embed. Useful for keeping a bot-spam or bridge channel clean. Messages older than 14 days are deleted one by one (a Discord API restriction), which is slower but works.

## Sleep prompt (built-in, no config)

A small community feature for German-speaking servers: when a player lying in bed types exactly `liege wie` in chat at night, every awake player gets a full-screen title nudging them to go to sleep. The tone matches the message: lowercase input gets dry lowercase titles, ALL CAPS gets shouted ones. Per-server cooldown of 10 seconds. It is always active and currently not configurable.

## Scheduled restarts

`schedules.<serverId>.restart` restarts a server on a wall-clock schedule (`"time": "04:00"`, optional `days` as `["SU".."SA"]`, default daily). Players get `/say` countdown warnings at the configured `warnMinutes` (default 15/5/1), notification channels get the same via the `scheduledRestart` event, downtime alerts are suppressed around the restart, and the run lands in the admin audit log. Timers are TZ-aware and re-armed after each run and on every config reload — a schedule edit applies live.

## Milestone announcements

With a `milestones` block, an hourly pass reads the same stats files the leaderboards use and announces when a player crosses a configured threshold — in-game (`/say`) and via the `milestone` notification event. Thresholds are in the stat's native unit (playtime is ticks). On first activation the current values are recorded **silently** (per server and stat), so enabling the feature never floods channels with every veteran's history; announcements start with the next real crossing. State lives in `data/milestones.json`; at most 10 announcements go out per pass.

## Backup staleness alert

`hostAlerts.backupMaxAgeHours` (off by default) checks each server's newest backup across all tiers on the host-alert cadence and alerts the `downtimeAlerts` channels once when it exceeds the age threshold — the classic silent failure where the backup job died weeks before anyone needed it. A fresh backup clears the alert and re-arms it. Servers without the suite backup layout are skipped.

## Update notifier

A daily check against the GitHub releases of this repository. When a newer version exists it is logged at startup cadence; with `updateNotifier.dmAdmins: true`, operator-level admins (user-ID entries of the global `adminUsers`) additionally get one DM per new version (persisted, so restarts don't re-ping). `updateNotifier.enabled: false` turns the whole check off.

## Console relay

`/console live enable` (admin) streams a server's raw log into the guild's configured `console.channelId` — batched every few seconds with a hard per-message size cap and a drop counter, so a busy server cannot flood the channel or the Discord rate limit. The toggle is persisted in `data/consoleRelay.json` and survives restarts. Treat the target channel as admin-only; the command requires admin either way.

## Whitelist applications

With `whitelistApplications` configured (see [configuration.md](configuration.md)), the bot maintains a persistent **Apply** button message and routes applications into the admin queue channel. The Approve/Deny buttons use stable IDs handled by the global interaction dispatcher — they keep working after bot restarts. Approval runs the exact `/whitelist` path (Mojang lookup for canonical casing, console add, audit entry, cache invalidation) and DMs the applicant the outcome.

## Player-count sampling

The status/presence pass records one player-count sample per server into `data/playerCounts.json` (hourly aggregates, 14-day retention) — this feeds `/activity` and the dashboard. Deployments that run neither the status embed nor presence get a standalone 5-minute sampler that stands down automatically while fresh samples arrive from elsewhere.

## Runtime heartbeat

The bot overwrites `data/runtime.json` about once a minute. The web dashboard (a separate process) reads it to show a "bot down" banner when the heartbeat goes stale; `/healthz` and the `mcbot_bot_up` metric report the same signal.

## Log watcher (infrastructure)

Everything event-driven (bridge, notifications, in-game commands, sleep prompt) runs on the log watcher. For local servers it tails `logs/latest.log` using filesystem events with a 1-second polling fallback, capped at 1 MB per read cycle so a huge backlog after a restart cannot stall the bot. For remote servers it consumes the API wrapper's SSE stream with automatic reconnects. No configuration needed; it starts for every server.

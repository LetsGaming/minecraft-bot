# Features

The complete feature set, grouped by area. Slash commands are shown as
`/command`; in-game chat commands as `!command`. Most features are optional and
configured per Discord guild. See [configuration](admin/configuration.md) for
the config keys and [commands](user/commands.md) for the full command reference.

## Chat and communication

**Chat bridge.** Messages flow both ways between a Discord channel and the
Minecraft server chat. Discord messages appear in-game and in-game chat appears
in Discord. The Discord side can render as a plain bot embed or, with webhooks
enabled, as the player themselves (username and skin as the avatar), which reads
far more naturally in a busy channel.

**Event notifications.** Joins and leaves, deaths, advancements, and server
start/stop are posted to a configured channel. Each event type can be routed and
toggled independently.

**Milestones.** Automatic shout-outs when a player crosses a round threshold
(for example passing 1,000 hours played), posted both in-game and to Discord.

## Player stats and leaderboards

**Per-player stats.** Playtime, kills, deaths, blocks mined, distance walked and
more, queryable per player with `/stats` and surfaced in the `/profile` card.

**Leaderboards.** `/leaderboard` ranks players by any tracked stat. Scheduled
leaderboards post automatically on a daily, weekly, or monthly cadence and show
only the activity gained during that window, so a fresh player can still top the
weekly board.

**Activity insights.** `/activity` shows when a server is busy, with a 24-hour
sparkline and the busiest hours, drawn from hourly snapshots.

**Sessions and last-seen.** Per-player session history is available through
`/sessions` and summarized in `/whois`.

## Account linking and rewards

**Account linking.** Players connect their Discord and Minecraft accounts, which
unlocks personalized commands and lets the bot attribute in-game activity to a
Discord user. Linking is confirmed in-game so it cannot be spoofed.

**Linked role.** Members receive a configurable Discord role when they link, and
lose it on unlink. Failures (missing permission, role hierarchy) are logged and
never block the link itself.

**Daily rewards.** Linked players claim daily in-game item rewards with `/daily`,
including streak bonuses. Claiming while offline queues the reward for the next
join instead of breaking the streak. The reward pool is defined in
[`dailyRewards.json`](admin/daily-rewards.md).

## Whitelisting

**Whitelist management.** Admins add and remove players from the whitelist with
an audit trail recording who changed what and when.

**Whitelist applications.** Players apply through a button and modal; each
application lands in a staff review channel where admins approve or deny it. The
feature needs both an application channel and a review channel to arm.

## Monitoring and alerts

**Live status embed.** A persistent, auto-updating embed shows server status, the
current player list, and TPS. It maintains its own channel and refreshes on a
fixed cadence.

**Downtime alerts.** When a server goes down unexpectedly, a channel is notified,
and again when it recovers. The bot's Discord presence also reflects the state.

**TPS alerts.** A warning fires when server performance drops below a configurable
threshold, with hysteresis so it does not flap.

**Host monitoring.** Process RAM and CPU and disk usage appear in `/status`.
Disk-full early-warning alerts fire when a monitored path crosses a percentage,
and optional stale-backup alerts flag a server whose newest backup is older than
a set age.

## Server operations

**Server control.** Start, stop, restart, and back up servers from Discord.
Every operation is admin-gated and written to the audit log.

**Scheduled restarts.** Wall-clock restarts per server, with in-game countdown
warnings and a Discord notification.

**Console access.** `/console tail` returns recent log lines, and an opt-in,
flood-protected live relay streams a server's log into an admin channel, toggled
per server at runtime.

**Watch notifications.** `/watch` sends a one-shot DM when a server comes back up
or when a specific player joins.

## Moderation and admin tools

**Moderation shortcuts.** `/kick`, `/ban`, and `/pardon` take a reason and are
all audit-logged.

**Admin notes.** `/note` keeps moderation memory per player, visible to admins in
`/whois`.

**In-game reports.** Players use `!report` in Minecraft chat to reach the guild's
admin channel.

**Per-guild admins.** Beyond the operator-level global admin list, each guild can
name its own admin users and roles, scoped to that guild and to the servers it is
allowed to target.

## Community features

**Community waypoints.** Players save and share named coordinates in-game with
`!waypoint`, browsable from Discord with `/waypoints`.

**Cross-platform polls.** One poll is votable from Discord buttons and in-game
with `!vote`. Linked accounts are counted once across both. In multi-server
setups a poll can span every server.

**Advancement challenges.** "First player to earn X wins" events with automatic
winner detection and optional in-game item bonuses for the winner.

**In-game commands.** Players run `!commands` in Minecraft chat for utilities
such as Chunkbase links, nether-portal coordinate math, and more. See
[in-game commands](user/in-game-commands.md).

## Web dashboard

Optional and running as its own process, the dashboard provides:

- Discord OAuth2 admin login, restricted to the configured admin users.
- Live server status and operations (start/stop/restart/backup, log tail).
- A schema-driven config editor with server-side validation and optimistic
  concurrency, so two editors cannot silently overwrite each other.
- A per-command policy view for enabling, disabling, or gating commands per
  scope.
- A filterable audit log.
- A one-click invite that opens the bot's Discord authorize URL with the right
  scopes and permissions.
- A guided per-guild setup that reads a guild's channels and roles straight from
  Discord, so features are configured with dropdowns instead of pasted IDs.
- A Prometheus `/metrics` endpoint.

The dashboard runs independently of the bot: either can be down without
affecting the other. See the [Docker guide](admin/docker.md) for enabling and
securing it behind a reverse proxy.

## Platform

**Multi-server.** Every feature works across multiple server instances from a
single bot, whether those servers are local or reached over the API wrapper. A
guild picks a default server, and commands can target any server it is permitted
to use.

**Command overrides.** Individual commands can be enabled, disabled, or made
admin-only at three scopes (global, per-guild slash commands, per-server in-game
commands), resolved field by field so a narrow scope overrides the broader one.

**Per-guild language.** English and German, switchable per Discord server.

**Local and remote servers.** The [API wrapper](admin/remote-setup.md) lets the
bot manage a server on another machine over HTTP(S) with the same feature set as
a local one.

**Durable state.** Machine-written state lives in a single SQLite database in WAL
mode that both the bot and dashboard write to safely. Details are in
[data storage](dev/core/data-storage.md).

# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Setup wizard rewritten as schema-driven** (`scripts/setup.mjs`).
  Prompts, hints, enums, and section structure now come from
  `config.schema.json` (the generated, CI-synced schema), so new config
  sections and fields appear in the wizard automatically the moment the
  schema regenerates — no wizard edits needed. Only credential entry,
  admin users, servers, and the per-guild feature walk stay hand-curated
  for flow; everything else (presence, hostAlerts, limits, webui,
  schedules, …) is generated. Highlights: **remote-instance setup**
  (apiUrl/apiKey via the API wrapper, with the same transport rules as
  the bot's own validateApiUrl — https ok, plain http only to
  LAN/loopback, public http requires explicit allowInsecureHttp
  consent); secrets masked in bracketed defaults; JSDoc descriptions
  shown as inline help; Discord-ID validation on channel/role prompts;
  post-write validation through the bot's own validator when a build
  exists. Editing is lossless: declining a section keeps its existing
  config (removal is always an explicit question), `commands` overrides
  at every scope, `milestones`, and unknown keys are preserved, and the
  written file carries `$schema` for editor autocompletion.
- **Command overrides are configurable from the wizard** at all three
  scopes: global `commands`, per-guild slash commands, and per-server
  in-game `!commands`. Fields are tri-state (`on`/`off`/`inherit` — an
  unset field inherits from the outer scope, matching the field-by-field
  resolution in commandPolicy), answering `inherit` for every field
  offers to remove the override entirely, and command names are
  completed from `data/commandManifest.json` when the bot has run once
  (free text accepted otherwise). The override fields themselves come
  from the schema, so future `CommandOverrideConfig` fields appear in
  the flow automatically.
- **The wizard is Docker-aware.** Docker deployments keep `data/` in a
  named volume, so `commandManifest.json` is not on the host — the
  wizard now discovers the manifest through a chain: an explicit
  `--manifest <path>` flag, the local `data/` file, then
  `docker compose cp bot:/app/data/commandManifest.json` against the
  compose project (works on stopped containers), with a free-text
  fallback that prints the exact export commands. Post-write validation
  no longer depends on a build: when `src/core/dist` is absent (typical
  for Docker-only checkouts) the config is checked structurally against
  `config.schema.json` (types, enums, required fields; preserved unknown
  keys are not flagged). When a compose file is present, the closing
  next-steps explain compose "Option B" — mounting the freshly written
  `./config.json` read-only into the container.

### Security

- **Server events can no longer be forged from chat** (audit SEC-01).
  The advancement, death, join/leave and start/stop watchers matched log
  lines with a `\[.+?\].*:` prefix loose enough that a player's *chat
  message* could fake any of them — including a forged challenge win
  that paid out the configured item bonus through `give()`. Watcher
  regexes are now anchored on the `[Server thread/INFO]` tag (Forge's
  extra `[minecraft/MinecraftServer]` tag still matches), and a shared
  dispatch guard (`registerServerEvent`) additionally drops any line
  whose message segment opens with a `<name>` chat wrapper — the
  portable backstop for forks with unusual thread names. Regression
  suite `tests/eventForgery.test.ts` pins the audit's PoC lines.
- **Dashboard 500 bodies no longer leak error detail** (audit SEC-04).
  `/api/servers/:id/:action` (scripts) and `/api/servers/:id/log`
  returned raw `err.message` — absolute paths and sudo/stderr fragments
  included. The detail now goes to the server log; clients get a fixed
  `{ "error": "internal error" }`.

### Fixed

- **Web dashboard container no longer crash-loops on SQLite** (Docker).
  The dashboard opens the shared SQLite store at startup via
  `better-sqlite3`, whose native binding can fail to load on Alpine/musl
  — `getDb()` then threw synchronously and the container exited 1 in a
  restart loop, with no actionable log line. The `web` service in
  `docker-compose.yml` now sets `MCBOT_SQLITE_DRIVER=node` (the built-in
  `node:sqlite` driver — identical store format, zero native build; the
  dashboard runs on Node 24), and the web entrypoint wraps the store
  open in a clear error that names the fix instead of a bare stack
  trace. Documented in `docs/admin/docker.md` with a troubleshooting
  section. (The bot container is unaffected and keeps `better-sqlite3`.)

- **CI: `npm run i18n:check` crashed with ENOENT** — the locale parity
  script still read the pre-workspace `src/common/locales/` path (and
  `dist/common/locales/` for built output). It now resolves the
  `@mcbot/core` workspace locations (`src/core/locales/`,
  `src/core/dist/locales/`).
- **In-game command cooldown map no longer grows without bound**
  (audit BUG-01). Entries keyed `command:player` were never evicted; a
  10-minute sweep now removes anything older than the largest declared
  cooldown (`sweepCooldowns()`, unref'd timer).

### Changed

- **Dashboard backend split into focused modules** (audit QUAL-01).
  `src/web/backend/server.ts` mixed OAuth wiring, all ~15 routes, the
  Prometheus exposition and static serving in one file. It is now a
  78-line assembler that owns instance creation, the auth boundary and
  registration order, delegating to `routes/auth.ts`,
  `routes/monitoring.ts` (phase 1), `routes/config.ts` (phase 2),
  `routes/servers.ts` (phase 3), `metrics.ts` (`/healthz` +
  `/metrics`), `static.ts` (frontend serving) and `status.ts` (the one
  status collector shared by `/api/status` and the metrics exposition)
  — mirroring the wrapper's `app.ts` layout. No behavioral change;
  `buildServer()`/`startWebServer()` keep their signatures, and a new
  route-table parity test pins that every route stays registered and
  behind `requireAdminSession`.
- **Death-message matching is table-driven** (audit QUAL-03): the
  30-branch inline alternation in `deaths.ts` is now a `DEATH_PHRASES`
  table producing the identical regex — one place to extend when Mojang
  adds messages, and a stepping stone for localized death events.

## [4.0.0] — 2026-07-05

Workspace restructure + a real data layer. Upgrading: `npm ci && npm run build` (Node 20+; 24 LTS recommended) — data migrates itself on first start, including the snapshots directory.

### Changed

- **npm workspaces layout.** Code stays under `src/`, now as four
  workspaces: `src/bot` (the product), `src/web` (one package — Fastify
  backend + Vue frontend, one build, one artifact), `src/core`
  (process-agnostic core) and `src/schema` (isomorphic contracts).
  `discord.js` exists only in the bot's dependency tree, vite/vue only in
  the dashboard's; ESLint boundary rules and workspace-scoped installs
  (`npm ci -w @mcbot/bot`) enforce the direction. One root lockfile — the
  frontend's nested npm project is gone. Build output lives inside each
  workspace; deploy paths changed: `src/bot/dist/index.js` and
  `src/web/dist/backend/index.js` (PM2 ecosystem + Dockerfile updated).
- **SQLite data layer for machine-written state** (`data/bot.db`, via
  better-sqlite3 behind a small driver seam;
  `MCBOT_SQLITE_DRIVER=node` selects the built-in `node:sqlite` on hosts
  without a compile toolchain, Node ≥ 22.13). Ownership decides the
  medium: hand-edited files stay JSON (`dailyRewards.json`, configs),
  every machine-written store lives in the database — audit trails,
  account links + link codes, watches, player notes, waypoints, sessions,
  challenges, polls, daily claims + pending rewards, watcher states,
  uptime checks, player-count history, and hourly stat snapshots. The
  time-series stores got real tables: recording an uptime check or a
  player-count sample is now one INSERT/UPSERT instead of rewriting a
  43k-entry JSON file. Snapshots are keyed `(server_id, ts)` in the
  database — the multi-server keying fix, structurally. Both processes
  run idempotent migrations at boot; every legacy JSON store imports once
  and is kept as `*.imported` (the snapshots directory as
  `snapshots.imported/`).
- **`PUT /api/config` uses optimistic concurrency.** `GET` returns
  `{ hash, config }`; `PUT` takes `{ baseHash, config }` and answers 409
  when `config.json` changed underneath the editor (second admin, bot
  write, hand edit). The dashboard surfaces the conflict and reloads its
  baseline.
- Docker: images build on `node:24-alpine`; the Dockerfile gained
  separate `bot` (default) and `web` targets — the dashboard image
  contains zero bot code — plus toolchain-bearing dependency stages that
  compile better-sqlite3 on Alpine so the runtime images stay slim. `docker compose --profile web up -d` starts the
  dashboard alongside the bot (own healthcheck against `/healthz`, no
  `depends_on` — the processes stay independent).

### Fixed

- **Dashboard showed every server offline** (and `/metrics` emitted no
  per-server gauges): the web process never initialized its server
  registry. It now runs its own instances by design — server control and
  config edits keep working while the bot is down.
- **Admin audit entries could be lost** when a dashboard action raced a
  bot action: both processes appended to the same JSON file with no
  cross-process coordination. Appends are single inserts in SQLite now.
- **Concurrent `/link` completions could drop an update** (read-modify-
  write on shared maps). The whole issue/confirm/unlink flow is
  transactional; the in-game handler's module-level code cache — which
  also went stale against codes issued after startup — is gone.
- **After `/unlink`, `/link` claimed "already linked" forever**: the old
  flow inferred link state from leftover confirmed codes, which unlink
  never cleaned. Link state now comes from the links table itself.
- `/metrics` collects all servers in parallel instead of serially, and
  can be gated with a bearer token (`WEBUI_METRICS_TOKEN`).

### Added

- `MCBOT_SQLITE_DRIVER` env switch between the shipped better-sqlite3
  driver and the built-in `node:sqlite` fallback.
- `WEBUI_HOST` / `WEBUI_PORT` environment overrides for the dashboard
  bind address (config.json is shared with the bot; where to bind is an
  environment concern — compose sets `0.0.0.0` for the container).
- `MCBOT_DB_PATH` override for the SQLite store location.


### Added

- **Scoped command settings**: every command (slash and in-game) now
  takes `enabled` / `adminOnly` at three scopes — global `commands`,
  per guild (`guilds.<id>.commands`, slash) and per server
  (`servers.<id>.commands`, in-game) — merged field-by-field and
  enforced live at dispatch time. `adminOnly` for in-game commands
  checks the player's linked Discord account against the global admin
  list; built-in admin commands stay admin-gated regardless. `/help`
  hides commands disabled for the guild.
- **Commands tab in the dashboard**: a matrix editor over those blocks
  with a scope selector, inherit/on/off tri-states, and the effective
  value per scope, backed by a command manifest the bot writes at
  startup (`GET /api/commands`).

## [3.6.0] — 2026-07-05

The roadmap batch: everything from `docs/ROADMAP.md` shipped in one
release — operator tooling, community features, and the web dashboard.

### Added

- **Web dashboard** (`npm run start:web`): a separate Fastify process
  with Discord-OAuth2 login (admin-gated), live server status, uptime
  and activity data, admin-audit view, a schema-driven config editor
  with secret redaction, server operations (start/stop/restart/backup,
  log tail, prune-stats with dry-run), plus `/healthz` and a Prometheus
  `/metrics` endpoint. Frontend is a small Vue 3 SPA built with Vite
  (`npm run build:web`); the bot writes a heartbeat file so the
  dashboard shows when the bot is down.
- **Scheduled restarts** (`schedules.<serverId>.restart`): wall-clock
  restarts with countdown warnings in-game and in the notifications
  channel, downtime alerts suppressed around the restart, admin-audited.
- **Whitelist applications** (`guilds.<id>.whitelistApplications`):
  a persistent Apply button, an application modal (with server select in
  multi-server guilds), an admin queue with Approve/Deny buttons that
  survive restarts, DM feedback to applicants.
- **Console access**: `/console tail` (ephemeral log tail) and
  `/console live enable|disable` — a batched, flood-protected live relay
  of a server's log into a configured admin channel.
- **Moderation shortcuts**: `/kick`, `/ban`, `/pardon` — thin, audited
  wrappers over the console commands.
- **/daily-admin**: move a user's daily-claim record between servers
  (fixes streaks stranded by the v2 per-server migration), reset records,
  and inspect them across servers.
- **/activity**: player-count history — 24h sparkline plus the busiest
  local hours from a compact per-hour series sampled for free by the
  status pass (standalone sampler covers status-less deployments).
- **/profile**: player card from existing data — head, linked account,
  whitelisted-by, playtime and last-seen, daily streak.
- **/daily-history**: the last stored daily claims (date, streak, items).
- **/watch**: one-shot DMs when a server comes back online or a player
  joins; list/remove included.
- **Milestone posts** (`milestones` config): "X just passed 1,000 hours"
  announcements in-game and in notification channels, with silent
  baseline seeding on first activation.
- **Span polls**: `/poll create servers:"smp, creative"` (or `all`) runs
  one poll across several instances with a merged tally and per-instance
  announcements; the one-open-poll rule holds per participating server.
- **Streak leaderboards**: current and longest daily streak as
  `/leaderboard` and `/top` categories.
- **More leaderboard categories**: crafted, player kills, jumps, animals
  bred, fish caught, diamond ore mined.
- **Guild-picked scheduled leaderboards**
  (`guilds.<id>.leaderboard.categories`): choose which boards the
  scheduled post includes.
- **Per-server daily reward pools** (`servers` section in
  dailyRewards.json) with field-level fallback to the shared pool.
- **Webhook chat bridge** (`chatBridge.useWebhook`): MC→Discord messages
  appear as the player (name + head) via a channel webhook, with
  automatic fallback to the embed form.
- **Waypoint categories** (`!waypoint set <name> [category]`, filterable
  in `!waypoints` and `/waypoints`) and a configurable per-server cap
  (`waypoints.maxPerServer`).
- **Remote host metrics**: disk and process usage of remote (apiUrl)
  instances via the wrapper's `/info` endpoint (wrapper ≥ 1.2.0), plus a
  startup version handshake that warns on outdated wrappers.
- **Backup staleness alert** (`hostAlerts.backupMaxAgeHours`) with
  hysteresis, and a "Newest backup" line in `/backup`.
- **Update notifier**: daily GitHub release check with optional admin DM
  (`updateNotifier` config, on by default, DM off by default).
- **Role mentions on alerts** (`mentionRole` on downtime/TPS alert
  configs, also used by host-disk and backup-age alerts).
- **Per-guild language** (`guilds.<id>.language`): embeds and replies
  localize per guild; in-game strings stay on the global language.
- **Configurable rate limits** (`limits` config block) for the slash and
  chat-bridge limiters.
- **Presence down state** (`presence.downFormat`, status idle while
  down) and live re-arming of the status/presence timer on config
  reload.
- **Config reload summaries**: `/config reload` and the file-watcher log
  now report guild/feature-level changes, not just server add/remove.
- Locale parity gate (`npm run i18n:check`), GitHub Actions CI
  (typecheck, lint, tests, audit, schema drift, locale parity, frontend
  build), a tag-driven release workflow (artifact + GHCR image), and a
  nightly RCON e2e smoke against a real Paper server in Docker Compose.

### Changed

- Source layout: bot code moved to `src/bot/`, shared process-agnostic
  code to `src/common/`, the dashboard lives in `src/web/` — enforced by
  ESLint boundary rules (`common` imports neither, `web` never imports
  `bot`).
- `defineCommand` supports an optional last argument (`"name?"`)
  alongside the existing greedy form.
- Node.js ≥ 20 is now required (`engines`).

### Fixed

- Aggregate presence no longer reports "0 online" while every instance
  is unreachable — it reports the down state instead.

## [3.5.1] — earlier

Community-features batch and prior releases (polls, waypoints, notes,
challenges, reports, host-disk alerts, sessions, uptime tracking, and
the multi-server/remote-wrapper foundation). See the Git history.

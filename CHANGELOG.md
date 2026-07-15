# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [4.4.0] — 2026-07-15

### Added

- **The bot now reports which remote features it is missing, by name.** An API
  wrapper that lacks a feature used to look identical to a healthy one — every
  call degrades individually, so a 404 on `/usercache` just quietly became "no
  usercache names". The bot now reads the wrapper's `GET /manifest` at startup
  and names each gap and what it costs (`does not provide "usercache" — names
  for players who are not on the whitelist`), in **both** directions: it also
  reports features the wrapper offers that the bot is too old to use, which had
  no mechanism at all. Wrappers predating `/manifest` fall back to the version
  compare. Requires api-wrapper with `/manifest`; older ones keep working.

- **Cross-repo contract check** (`npm run e2e:contract`) — runs the bot's real
  `serverAccess` against a real api-wrapper process, so a renamed field on the
  wrapper fails CI instead of silently returning `undefined` on remote
  instances. `apiGet<T>` casts the wrapper's JSON, which no unit test on either
  side can verify. Runs from both repos' CI; about ten seconds, no Minecraft
  needed (scaffolded instance directory plus a real RCON socket).

### Fixed

- **`npm run clean` did not clean.** It ran `tsc -b --clean`, which only removes
  output for sources TypeScript still knows about — so a renamed file left its
  old `.js` in `dist/` forever. Because the in-game command loader walks that
  directory, an incremental build after any rename registered every `!command`
  twice, and players got two replies. Now `rm -rf src/*/dist`, which is what the
  script always claimed to do. The loader also refuses a duplicate command name
  and says why, since that is a bug however it happens.

- **Two test files asserted against copies of the code they claimed to test**,
  so the bugs they were named for could have been reintroduced with the suite
  green. `tps.test.ts` re-implemented `getTps` inline (its header even claimed
  "a regression in the source will break the matching test" — it would not), and
  `validateConfig.test.ts` asserted that object literals had the properties it
  had just given them. Both are gone; their real behaviours — the Bug 1 and
  Bug 4 guards, and the `tpsWarningThreshold` check that had no coverage at all
  — are now asserted against the actual implementations, and verified to fail
  when those are broken. Test count drops by 15; signal does not.

- **`MIN_WRAPPER_VERSION` was `1.2.0`, a version that never had `/info`.** The
  endpoint shipped in wrapper 3.0.0, so every wrapper that answered the version
  handshake was already above the floor and the comparison could never fail —
  the one mechanism meant to surface an outdated wrapper was unreachable, and
  the constant's comment asserted something untrue. Corrected to `3.0.0`, and
  demoted to the pre-manifest fallback path.

- **Period leaderboards and `/stats daily` used the wrong window.** Scheduled
  daily boards anchored on a 26–48h-old baseline instead of 24h — on a
  recently-installed bot, on the oldest snapshot there was, so a "daily" board
  showed what looked like all-time totals — and `/stats daily` silently
  shortened its window to match whatever had survived. Snapshot retention thinned
  a whole calendar day as soon as that day's *first* snapshot aged past 24h,
  which (since yesterday's 00:00 snapshot is always over 24h old) tore a hole
  through the rolling window exactly where both daily baselines are looked up.
  Retention is now a rolling window sized from what the readers need, and the
  regression tests assert retention and the readers together.

### Security

- `/metrics` compared its bearer token with `!==`, which leaks the token's prefix
  through timing. Every secret comparison in the dashboard now goes through one
  constant-time `secretEquals()`.
- Migrations record their SQL checksum. Editing a shipped migration used to be
  silent — already-migrated databases skipped the new SQL, leaving schema and
  code disagreeing — and now refuses to start.

### Changed

- **Every bloated directory is now grouped by purpose**, the way
  `bot/commands/` always has been:
  - `core/utils/` → `minecraft/`, `server/`, `stores/`, `config/`, `commands/`,
    with the cross-cutting primitives at the root. The `utils.ts` grab-bag is
    dissolved into `paths.ts`, `jsonStore.ts`, `minecraft/whitelist.ts`, and
    the modules that were its only consumers; `getLevelName` was dead and is
    gone.
  - `bot/logWatcher/watchers/` (21 flat files) → `log/`, `monitors/`,
    `schedulers/`, split by what starts them — which is what the entry point's
    name already told you.
  - `bot/logWatcher/commands/` → the **same categories as the slash commands**,
    so the two surfaces of one feature match: `/seed` is `info/`, `!seed` is
    `info/`.
  - `core/types/` → grouped like `utils/`. Import through `types/index.ts` as
    before; nothing else changes.
  - `bot/utils/` → `embeds/`, `guild/`. `web/backend/` → `auth/`, `config/`,
    `status/`, with the Fastify plumbing at the root.
  - `web/frontend/components/` → `schema/` (the config editor's renderer) and
    `ui/` (presentational primitives).
  - `tests/` (86 flat files) → grouped by subject: `config/`, `db/`,
    `minecraft/`, `server/`, `commands/`, `ingame/`, `watchers/`, `web/`,
    `utils/`, `suites/`.
- **Values that cross a workspace boundary moved into `@mcbot/schema`**: the
  leaderboard interval durations (snapshot retention now derives its cap from
  the longest one, so a new interval cannot outlive the history it needs), the
  Discord snowflake format (was inlined in three layers), and the server-action
  names (were a four-item `Set` in the dashboard, a five-key `Record` in the
  script runner, and bare string comparisons in both front-ends). The action
  guard also removes an unsafe cast from the dashboard's action route.
- **The developer docs are split the way the repo is** — `docs/dev/` keeps what
  is true everywhere, with `bot/`, `core/`, and `web/` directories beneath it,
  and shipped design records moved to `dev/history/`. Corrected along the way:
  the architecture doc still claimed there was no database (SQLite landed in
  4.0), and `data-storage.md` documented `loadJson`'s failure mode backwards.

## [4.3.0] — 2026-07-12

## [4.2.2] — 2026-07-12

## [4.2.1] — 2026-07-12

## [4.2.0] — 2026-07-11

### Added

- **Config rollback** — the dashboard snapshots the config before each change
  (gzip-compressed, kept for the last 3 days) and can restore any of them;
  `GET /api/config/history` and `POST /api/config/history/:id/rollback`.
- **Per-guild config editor** — edit a guild's whole configuration from a
  schema-driven form (every field, with type-appropriate inputs) instead of
  re-running the setup wizard.
- **Per-command options** — commands can carry configurable options (e.g.
  `/map`'s URL), edited in the Commands tab and declared in a `COMMAND_OPTIONS`
  registry.
- **Dashboard setup guard** — missing required config (`WEBUI_SESSION_SECRET`,
  `WEBUI_CLIENT_SECRET`) now serves a clear setup page instead of an opaque 500.
- `WEBUI_PUBLIC_URL` to set the dashboard's public URL behind a reverse proxy
  (fixes the OAuth redirect and the session cookie's `Secure` flag).
- `bump-version` script that updates the version across every manifest + the
  changelog and can optionally tag/push a release.

### Changed

- **Command schema**: `commands.<name>.url` is replaced by a general
  `commands.<name>.options` object. Existing `url` values are still honoured
  (backward compatible).
- **Meaningful errors everywhere** — API responses now carry a human-readable
  message instead of terse codes (`forbidden`, `conflict`, `unknown server`,
  …); unknown endpoints return a named 404.
- **Docker deployment is fully `.env`-driven** — rewritten `docker-compose.yml`,
  `docker-entrypoint.sh` and `.env.example`; the active config now lives in the
  writable `data/` volume (`MCBOT_CONFIG_PATH`), seeded once on first start.

### Fixed

- A server is no longer reported offline after a single failed status request —
  the remote-API path retries before declaring it down.
- Config written from the dashboard no longer fails with `EACCES` on a
  read-only/root-owned path; it is written to the process-owned `data/` volume.
- Env-only secrets (`DISCORD_TOKEN`, …) are applied before validation, so a
  config that omits them still boots.
- The optimistic-concurrency 409 on config writes now surfaces to the dashboard
  correctly (reload-and-retry).
- Notification events that previously never fired now fire.

### Security

- `@fastify/helmet` with a tuned Content-Security-Policy on the dashboard.
- Token-bucket rate limiting across the auth and mutating API routes.
- Guild-manager scope now expires (2 h) and is re-checked on write, so a
  demoted manager can't keep write access for the rest of a session.

## [4.1.0] — 2026-07-07

### Added

- **Redesigned dashboard** — a sidebar layout (live server switcher +
  feature nav), card/table views, and a dark PrimeVue theme with modern
  selection cues. Covers Servers, Guilds, Commands, Config, and Audit.
- **Add to Server** — a one-click invite button that opens the bot's
  Discord OAuth2 URL with the right scopes and permissions
  (`GET /api/invite`).
- **Guided guild setup** — a wizard that reads a guild's channels and
  roles from Discord and configures features (notifications, chat bridge,
  leaderboard, downtime/TPS alerts, reports, console, whitelist apps,
  linked role, …) with dropdowns instead of pasted IDs. Writes through
  the existing validated `PUT /api/config`; re-running edits rather than
  blanks an existing guild. Adds read-only routes `GET /api/setup/guilds`
  and `.../guilds/:id/{channels,roles}`.
- **Schema-driven setup wizard** (`scripts/setup.mjs`) — prompts now
  generate from `config.schema.json`, so new config fields appear
  automatically. Adds remote-instance setup (apiUrl/apiKey), secret
  masking, lossless `--edit`, and tri-state command overrides at
  global/guild/server scope.
- **Docker-aware wizard** — finds `commandManifest.json` via `--manifest`,
  the local file, or `docker compose cp` from the running bot, and
  validates against the schema when no build is present.

### Changed

- **Dashboard backend split** into focused route modules; `server.ts` is
  now a thin assembler (audit QUAL-01). No behavioral change.
- **Death-message matching is table-driven** (audit QUAL-03) — easier to
  extend when Mojang adds messages.

### Fixed

- **Web dashboard no longer crash-loops silently** on startup — config,
  SQLite, and logging failures now print one clear error instead of a
  bare restart loop. The web container defaults to the built-in SQLite
  driver (`MCBOT_SQLITE_DRIVER=node`); causes are documented in
  `docs/admin/docker.md`.
- **Commands-view save** sends `baseHash` correctly instead of writing a
  stray `hash` key into `config.json`.
- **In-game cooldown map no longer grows unbounded** (audit BUG-01) —
  stale entries are swept.
- **CI `i18n:check`** resolves the workspace locale paths (was ENOENT).

### Security

- **Server events can no longer be forged from chat** (audit SEC-01) —
  watcher regexes are anchored to the server-thread log tag with a
  chat-wrapper backstop, closing a forged-challenge payout. Includes a
  regression suite.
- **Dashboard 500s no longer leak error detail** (audit SEC-04) —
  internals go to the log; clients get a generic message.

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

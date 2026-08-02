# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **The dashboard absorbs the standalone server-manager panel.** Everything
  `minecraft-server-manager` did is now in the dashboard, reached through the
  API wrapper like every other server operation. Migration and decommissioning
  steps: [docs/admin/retiring-server-manager.md](docs/admin/retiring-server-manager.md).

  The panel was not a second dashboard so much as a second *wrapper*: it ran on
  the Minecraft host, shelled out to the same setup-suite scripts, and carried
  its own RCON client, `variables.txt` parser and instance registry. Two
  privileged local agents on one host, for one capability — the same
  duplication 5.0.0 spent a major version removing, one layer out.

- **Per-capability dashboard access** (`webui.grants`). Host-side routes used
  to share one `requireSysadmin` gate, which made "read the status page" and
  "restore a backup over the live world" the same grant. Adding the console,
  backups and rollback made that untenable, and it could not express the case
  the panel's retirement created: someone who may tune a mod setting and
  nothing else.

  Capabilities are per server and grouped by blast radius rather than
  seniority. `server:console` is deliberately separate from `server:control` —
  one console command can op an account or ban a player, a restart cannot.
  `bot:config` is not grantable at all, since editing `config.json` is what
  controls who has what. See [docs/admin/capabilities.md](docs/admin/capabilities.md).

  Authorization is now declared per route and enforced by one hook, with a boot
  assertion that refuses to start if a host route carries no rule. Forgetting
  the gate is a crash on startup rather than an open endpoint.

- **Live console.** A relayed log stream plus a command line, replacing the
  panel's WebSocket terminal. SSE rather than a WebSocket, which removed code
  instead of adding it: a browser cannot set headers on a WebSocket handshake,
  so the panel needed a one-time-ticket endpoint and store to keep its JWT out
  of URLs. `EventSource` sends the session cookie, so none of that exists here.

  One upstream connection per server, fanned out to every viewer. Not one per
  browser tab: the wrapper caps concurrent log-stream clients per instance and
  the bot's own watcher already holds one, so per-tab connections would let the
  dashboard starve the chat bridge by being used.

- **Console command deny-list** (`webui.console.blockedCommands`, defaulting to
  `stop`, `op`, `deop`). Enforced in the backend, never only in the UI. Matching
  is on the first word after any leading slashes, case-insensitively, so one
  entry covers `stop`, `/stop` and `STOP` — the panel compared raw strings, so
  a deny entry of `stop` did nothing against `/stop`.

- **Backups panel**: archive listing, download and restore, plus **rollback**
  on the Servers view. Needs wrapper 3.3.0+; the dashboard hides what an older
  wrapper cannot serve rather than offering buttons that fail.

  Downloads stream through the dashboard rather than being buffered — the API
  key must never reach a browser, so a multi-gigabyte archive passes through
  this process, and it does so in constant memory. `Content-Length` and `Range`
  are forwarded, so the browser draws its own progress and can resume.

- **`SseLineStream` in `@mcbot/core`.** The SSE transport extracted out of
  `RemoteLogWatcher` so the dashboard could use it without a second copy of the
  connect/backoff loop. The watcher keeps its ordered dispatch queue, which
  exists because its handlers make Discord round-trips; the console writes
  straight to open responses and needs none.

- **`ServerStatus.features`** — what each server's wrapper advertises, from its
  capability probe and manifest. The UI gates on this rather than on its own
  version, so a suite without `rollback.sh` shows no Rollback button.

### Fixed

- **A stop during the SSE handshake could leave the stream running.** `stop()`
  aborts the request, but if the response had already resolved the abort was
  too late: the reader went on to report a connection, fire `onConnect` and
  start reading a stream the caller had just cancelled. Found by the first
  direct tests this code has had — it shipped inside the log watcher for a year
  with only integration coverage.

- **`/api/setup/servers` was inconsistent with grants.** It was sysadmin-only,
  which predates capabilities; a user who can see a server in `/api/status`
  received a 403 asking for its name. Now filtered to the caller's visible
  servers, still a 403 for anyone with no host access at all.

### Changed

- `requireSysadmin` is removed rather than deprecated. A coarse gate sitting
  next to the fine-grained one is an invitation to reintroduce the problem the
  fine-grained one exists to solve. `isSysadmin` remains.

### Not carried over from the server-manager panel

Two of the panel's features were considered and deliberately left behind. Both
are decisions rather than oversights, so they are written down here:

- **The local username/password login.** The dashboard stays Discord-OAuth2
  only. The fallback that login provided already exists in a better form — SSH
  plus the wrapper's API key — and a second authentication surface on the game
  host is a poor trade for the rare case where you have neither. The runbook is
  [docs/admin/emergency-access.md](docs/admin/emergency-access.md); it asks you
  to note the date each time you need it, which is the signal for revisiting
  this.

- **The public, login-free status page.** The dashboard has no public surface;
  every route requires a session. Login-free status and leaderboard pages remain
  an open roadmap idea, to be designed as such if there is ever demand, rather
  than reconstructed from what the panel happened to expose.


### Fixed

- **In-game tips are delivered in game.** The `!deathpos` tip rode along on
  the death-coordinates DM, which only linked players receive — so a tip
  about an in-game command was behind a Discord link and never reached the
  players who had not linked. Event tips are now whispered to the player
  they concern, linked or not; the DM keeps the coordinates, which is the
  part that needs Discord.
- **Tips no longer advertise disabled commands.** The join nudges, the
  follow-up hints and the death DM all recommended commands without checking
  command policy, so a server with `daily` switched off still told every new
  player to run it — and following the tip landed them on "unknown command",
  which is worse than never being told. All three now go through one
  `isAdvertisable` check covering global, per-guild and per-server
  overrides, plus admin-only commands offered to non-admins.

### Added

- **Event tips are a registry.** `EVENT_TIPS`
  (`src/core/utils/minecraft/eventTips.ts`) declares which command to mention
  after which in-game event; the ledger, the give-up rule and the
  disabled-command check are shared. Adding one is an entry plus a locale
  string. First new entry: a death caused by another player mentions
  `!report` instead of `!deathpos` — PvP is the one moment reporting is
  obvious, and keeping it separate means mob deaths never show it and a
  player kill does not spend a `!deathpos` mention.
- **Command usage is measured.** A `command_usage` table records every
  successful slash and in-game invocation (command, surface, user, guild,
  server), pruned to 90 days. Raw events rather than a counter because two
  different questions are asked of it: how often was each command used, and
  which commands has *this* user never run. Recording never throws — a
  failed metric must not fail the command it was measuring.
- **The dashboard's Commands page shows usage.** Each command now carries
  "N uses by M people in 30 days", or an explicit "Not used in 30 days".
  Uses and distinct people are counted separately, so one enthusiast running
  something ten times is not mistaken for adoption. It went on the existing
  page rather than a new one: what a command does, whether it is on, and
  whether anyone uses it are one question asked three ways, and the third
  only becomes actionable next to the other two.
- **`/help` leads with what you have not tried.** Commands the caller has
  never run are sorted first and marked ✨, turning a reference list into a
  recommendation without hiding anything.
- **The death DM mentions `!deathpos`.** A player reading it has just proved
  they care where they died, which is the only moment that command is
  obviously useful. Twice, then never again.
- **Follow-up hints: features suggest their pair, at the moment of use.**
  Five pairs so far — `/daily` offers to switch on its reminder, `/status`
  on a *down* server offers to `/watch` it back online (both one-tap
  buttons), and `/stats`, `/playtime` and `/seed` each name the command
  that answers the question they raise (`/leaderboard`, `/activity`,
  `/chunkbase`). Attached once in `withErrorHandling`, after the command
  returns without throwing — so an errored command can never advertise
  anything, and a new pair is a registry entry with no other wiring.
  Claiming a `/daily` reward now offers a one-tap button to switch on the
  reminder for the next one — the person who just claimed is exactly the
  person who wants it, and would never have gone looking for
  `/daily-reminder`. A button rather than a command name because the cost of
  saying yes should be lower than the cost of reading the offer. At most one
  hint per reply, never offered for something already switched on, stops
  after two offers, and "No thanks" is permanent. `HINTS` in
  `bot/utils/hints/followUps.ts` is a registry: a new pair is one entry
  saying when it applies, what the button says, and what it does. Shares the
  `featureNudges.enabled` switch.
- **In-game nudges for `/link` and `/daily`.** The chat bridge is the only
  feature with real traffic because it needs no learning; everything else
  starts with a Discord command players have never been shown. On join, the
  bot now whispers a player about exactly one thing they are missing.
  Deliberately narrow: `/daily` requires a linked account, so the funnel is
  strictly link → daily and nobody is told about a step they cannot take or
  a feature they already use. It gives up after 3 mentions of a feature
  (48h apart), and the last one says so. Triggered by the join event, never
  by message content — matching words would quietly make it English-only.
  Configure with `featureNudges` (`enabled`, `maxPerFeature`,
  `cooldownHours`); on by default.

### Changed

- **Timezones are per guild and per schedule; the `TZ` env var is gone.**
  Everything stored stays UTC epoch ms; a zone is applied only where a human
  reads a time or a wall-clock schedule fires. `guilds.<id>.timezone` covers
  Discord-facing wall-clock (nightly channel purge, "busiest hour" in
  `/activity`), `schedules.<server>.timezone` covers server-facing wall-clock
  (restarts — a 04:00 restart belongs to the machine's operator, and a server
  watched by two guilds has no guild answer), and a global `timezone` is the
  default for both. All default to UTC. The channel purge now runs one timer
  per guild at that guild's midnight instead of one process-wide timer.
  Embed timestamps need none of this: they are Discord `<t:…>` markers and
  render in each reader's own zone.
- **Fixed: `nextMidnightEpoch()` returned NaN on the last day of every
  month**, so the nightly channel purge misfired every month-end. It pasted
  `day + 1` into an ISO string ("2026-01-32T00:00:00Z" → Invalid Date); it
  now shares the `Date.UTC` path that already normalised overflow correctly.
- **Fixed: `/status` host metrics.** `process.cpuPercent` came from
  `ps -o pcpu`, the average over the process's whole lifetime — a server
  that generated terrain at startup reported ~90% forever while idle. It is
  now sampled from `/proc/<pid>/stat`. A new whole-machine block reports the
  CPU and RAM an operator actually means; nothing was gathering it before,
  despite the section being headed "Host".
- **Fixed: disk figures in `/status` were per filesystem, labelled per
  directory.** The server dir and the backups dir usually share a filesystem,
  so both printed identical `df` numbers, which reads as two disks that
  coincidentally match. Each directory now reports its own size (`du`) under
  a single filesystem line that names the mount point. Disk-space alerts are
  deduped by mount point, so one full disk raises one alert rather than one
  per monitored directory.
- **Fixed: presence reporting "0 online" for populated servers.** When the
  health check passed but `/list` threw, `buildServerField` left the counts
  at zero while still reporting the server as up — and said nothing in the
  log. It now falls back to the health counts, ignores an unparseable
  response instead of overwriting with zero, and logs the failure.
- **Waypoints can be deleted by a bot admin**, not only by their author. A
  waypoint outlives the player who set it; author-only deletion left editing
  the store by hand as the only option. Uses the same linked-Discord admin
  check as `adminOnly` in-game commands.
- **Wrapper `host-info` is v2** (`minecraft-server-api`), declared through
  the existing feature manifest. The bot reads v1 wrappers too —
  `normaliseDisk` lifts the old shape — it simply shows less.

- **Config validation is schema-driven.** Types, requiredness, enums and
  numeric bounds are now checked with Ajv against the generated
  `config.schema.json` (`configSchemaCheck.ts`); `configValidation.ts` keeps
  only what a JSON Schema cannot express — 4.x migration detection, apiUrl
  transport rules, snowflake shapes, unknown-server references, chat-bridge
  ambiguity, tenant-scoping nudges, `HH:MM`, port ranges. The two
  descriptions of the same shape can no longer drift. Numeric bounds moved
  onto `RawBotConfig` as `@minimum`/`@maximum` annotations, so the schema
  carries them. Two deliberate softenings: an unknown top-level key and an
  unrecognised `notifications.events` entry now warn instead of blocking
  boot, so a config written for a newer version still starts. A missing
  `config.schema.json` degrades to semantic-only checks with a warning
  rather than refusing to start.
- **One `errMsg` for unknown throws.** Replaced 107 copies of the
  `err instanceof Error ? err.message : String(err)` ternary. The shared one
  also unpacks `AggregateError`, appends `Error.cause` (where fetch and
  `node:sqlite` hide the real reason), and reports a thrown object's message
  instead of `[object Object]`.
- **Reward rules moved out of the `/daily` command** into
  `core/utils/minecraft/rewards.ts`. The `advancements` and `joinLeave`
  watchers imported `give`/`deliverPendingRewards` from a Discord
  interaction handler; they now depend on core instead.
- **One `formatDuration` and one `formatBytes`.** `formatDuration` had three
  implementations with three different renderings (`/sessions` showed a
  3-day session as `72h 5m`); `formatBytes` had two that had already
  drifted, so the same figure read `512 KB` in Discord and `0 MB` in the
  dashboard. `formatBytes` now lives in `@mcbot/schema`, the one package
  both the Node side and the browser bundle import.
- **`fetchJson` for upstream calls** (`core/utils/http.ts`): one timeout,
  one typed `FetchResult` instead of throw-or-null. Fixes a real hang — the
  Modrinth call had no timeout, so a stalled upstream blocked `/mods`
  indefinitely.
- **`sanitizeReason`/`MAX_REASON_LENGTH` moved to `core/utils/sanitize.ts`**
  from `kick.ts`, where the sibling moderation commands were importing them.
- **`scheduleAt` (`core/utils/longTimer.ts`)** owns the setTimeout-overflow
  handling that two schedulers had implemented differently.
- **`loadLinkedAccountsOrEmpty`** replaces seven copies of
  `loadLinkedAccounts().catch(() => ({}))`, and logs the failure those seven
  copies each swallowed silently.

### Added

- **`/ban` takes a duration.** `duration: 30m | 2h | 3d | 1w | 2mo | 1.5y`
  (max `10y`, segments may be combined as `1d12h`) turns a ban into a timed
  one; leaving it out keeps the old permanent behaviour. Minecraft's ban list
  has no expiry, so the ban itself stays a plain vanilla `/ban` — the server
  enforces it even while the bot is offline — and only the release is
  scheduled bot-side. Pending releases persist in `kv_store["tempBans"]`, are
  re-armed on startup (anything that ran out during downtime is pardoned on
  the next boot), and are dropped when `/pardon` beats the clock. The expiry
  pardon is written to the admin audit log as `tempban-expired`. If the
  player has a linked Discord account they get a DM the moment the ban
  lifts — best-effort, so closed DMs or a deleted account never block the
  pardon itself.
- **`findDiscordIdByMcName` in `linkUtils`.** The name → Discord-ID reverse
  scan existed as four hand-rolled copies (`whois`, `profile`, `deaths`,
  `defineCommand`); they now share one case-insensitive helper, which the
  timed-ban DM also uses.

- **The bot can now ask the Minecraft server directly, with no wrapper
  involved.** `serverPing.ts` speaks the standard server-list ping — the same
  handshake a vanilla client uses to draw a row in the multiplayer list. It
  needs no authentication, no plugin, and nothing from the API wrapper.

  This is what makes the state model above worth having. Previously, when the
  wrapper was down the bot's honest answer was "I cannot tell you anything
  about this server" — a poor answer when a player can open their server list
  and see it sitting there with four people on it. The information was always
  available; the bot just had one route to it.

  The ping is a **second opinion, consulted whenever the first is anything
  other than "all good"**. That covers three cases:

  - the wrapper is unreachable → the ping reports the server online with a
    live player count, so the bot says *"Online — 4/20 players. API wrapper
    unreachable, so controls, logs and stats are down"* instead of "Offline";
  - the wrapper says `offline` but the server answers a ping → the ping wins
    (a status response is proof; the wrapper's probes are inference) and the
    bot logs that the wrapper's instance config is likely wrong;
  - the wrapper says `unresponsive` → the state stands, but the ping supplies
    the player count the wrapper could not.

  Player names from a ping are a capped, best-effort **sample** — servers
  publish at most a dozen and plugins can suppress it entirely — so they are
  flagged as such and never rendered as a full roster. The counts are exact.

  Configured automatically: the host comes from `apiUrl` (the wrapper runs on
  the Minecraft host) and the port from the `gamePort` the wrapper reports,
  falling back to 25565. `pingHost`, `pingPort` and `disableDirectPing`
  override it for split deployments or a firewalled game port.

- **Server state is now three-valued, and "we could not ask" is one of them.**

  "Offline" used to mean three different things. `isRunning()` asked the API
  wrapper, and anything that was not a clean `true` became offline — a wrapper
  that was down, a wrapper that timed out, and a Minecraft server that had
  genuinely stopped. Two of those three are wrong, and they are the common
  ones: the wrapper is a separate process on the server host that gets
  restarted and updated while Minecraft carries on with players on it.

  `@mcbot/schema` now defines `ServerState` — `online`, `unresponsive`,
  `offline`, `unknown` — as one axis, and `WrapperState` (`up` /
  `unreachable`) as a second, independent one. That independence is the point:
  the wrapper being down says nothing about whether players are on the server,
  and `unknown` now means *every* channel failed, which is a far smaller claim
  than the one it replaced. `ServerInstance.getHealth()` is the way to read
  both; `isRunning()` remains as "up in some form" for callers that only branch
  on whether it is worth querying.

  Note the two predicates: `serverIsResponsive()` asks about the *server*,
  `canQueryServer()` additionally requires a reachable wrapper. They came
  apart the moment the bot learned to ping directly — a server can be
  demonstrably online while every query against it fails — and a caller that
  checks the wrong one asks for a player list it cannot get and renders the
  zeros it gets back.

  Needs wrapper 3.2.0+ for the full distinction. Against an older wrapper the
  bot falls back to `/running` and says so in the startup contract report.

### Fixed

- **A lag spike was reported as a server outage.** The downtime monitor read
  one boolean, so a server too loaded to answer RCON crossed the three-failure
  threshold and got a "🔴 Server Down" alert. Worse than the wrong message: it
  also wrote a `0` into the uptime history and closed every open play session
  as a crash. `unresponsive` now counts as up, and neither happens.

- **An unreachable API wrapper was reported as a server outage.** Same three
  consequences, from a cause that says nothing at all about the Minecraft
  server. It now gets its own alert on a longer five-check fuse, with a
  recovery notice — and, because of the direct ping above, that alert says
  what the server itself is doing in the same breath, since an operator woken
  by it needs to know whether players are affected before anything else. When
  the ping confirms the server is up, uptime is recorded as **up**; only when
  nothing answers at all is the sample skipped, because a missing sample is
  honest where a fabricated `false` is not. `/status`, the status embed, and
  the dashboard each report the two facts separately instead of rendering
  every one of them as "Offline".

- **Player-count history recorded lag spikes as players leaving.** The sampler
  skipped only servers that were down, so an unresponsive one was sampled,
  `getList()` returned zeros, and the activity chart drew an exodus. It now
  samples only responsive servers and leaves a gap otherwise.

- **`mcbot_server_online` conflated three incidents into one alert.** Split
  into `mcbot_wrapper_up`, `mcbot_server_up` and `mcbot_server_online`.
  `mcbot_server_up` is **absent**, not `0`, when the wrapper did not answer —
  a `0` there is a claim of an outage that was never established, and an
  absent series breaks alert rules loudly instead.

- **The chat bridge lagged behind in-game chat, worst with webhooks on.**
  Two compounding causes, both since fixed:

  `RemoteLogWatcher` awaited handler dispatch inside the SSE read loop, so the
  socket sat idle for the whole of every handler's Discord round-trip and each
  chat line waited for the previous line's HTTP request. Handlers still run in
  order, one at a time — the *reader* no longer waits for them.

  The bridge itself awaited each send inline, which held up every other
  watcher for that server too. Sends are now queued per channel: ordered
  within a channel, parallel across them. Webhook execution is the slow case
  (its own rate-limit bucket, plus Discord fetching an mc-heads avatar it has
  not cached), which is why the lag appeared with `useWebhook` and not
  without it. Webhooks are also resolved once at setup and reload, instead of
  on the first chat message of a session, and concurrent resolutions are
  deduplicated.

  Note: sends are no longer globally ordered across channels. Two guilds
  bridging the same server may receive the same line in either order.

## [5.0.0] - 2026-07-17

### ⚠️ BREAKING: local mode is gone. The bot now requires the API wrapper.

**If the bot currently reaches your server by reading its files, sending keys
to a `screen` session, or opening its own RCON connection, it will not start
after this upgrade until you install the
[API wrapper](https://github.com/LetsGaming/minecraft-server-api) (3.1.1+) on
the Minecraft host and repoint `config.json` at it.**

The bot refuses to start rather than starting in a state that looks configured
and is not. It names every removed field it finds:

```
Config validation failed:
  - servers.survival: serverDir, linuxUser, useRcon configured local mode,
    which was removed in 5.0.0. The bot now reaches every server through an
    API wrapper. Move those settings into the wrapper's own config on the
    Minecraft host, delete them here, and set apiUrl + apiKey.
    See docs/admin/migrating-to-5.md. 4.3.x is the last release that
    supported local deployment.
```

Migration guide: **[docs/admin/migrating-to-5.md](docs/admin/migrating-to-5.md)**.

**4.3.x is the last release supporting local deployment, and it is
end-of-life** — no fixes, no features, no security updates, permanently. There
is no deprecation release in between: 4.3.x is where local mode stops.

#### What was removed

- **Per-server config fields**: `serverDir`, `scriptDir`, `linuxUser`,
  `screenSession`, `useRcon`, `rconHost`, `rconPort`, `rconPassword`. They
  describe the Minecraft host and now live in the wrapper's config there.
  `apiUrl` and `apiKey` are both required.
- **The pre-`servers` single-server format**, where the top-level object
  doubled as one server block. It only ever carried local fields.
- **`RCON_PASSWORD_<ID>` / `RCON_PASSWORD`** env overrides → replaced by
  **`API_KEY_<ID>` / `API_KEY`**. (The wrapper still reads `RCON_PASSWORD_<ID>`
  for its own connection: same name, different machine.)
- `src/core/rcon/` (the bot's RCON client) and `src/core/shell/` (the
  `execCommand`/sudo layer). The wrapper has both.
- The `LogWatcher` file tailer — a second implementation of the wrapper's
  `logStream.ts`, down to the same 1 MB/cycle catch-up cap. Every instance is
  watched over the wrapper's SSE stream now.
- `df`/`ps` host metrics. The wrapper's `/info` reports them, from the machine
  they describe.
- The RCON e2e smoke harness (`scripts/e2e-smoke.mjs`, `docker-compose.e2e.yml`,
  the `e2e` workflow). The cross-repo contract test (`npm run e2e:contract`)
  covers the seam that still exists.

#### Why

Every feature had two implementations — one against the filesystem, one against
the wrapper — and they drifted. This is not theoretical; it is where the bugs
below came from. The wrapper path was the tested one and the one most people
ran. Removing the other one deleted ~570 lines from two files and made a class
of bug impossible rather than fixed.

#### Deployment

**Docker is the supported way to run the bot**, and the dashboard ships with it.
It is a Node application and nothing stops you running it directly, but that is
not a supported configuration and there is no guide for it. The bot can now run
anywhere that can reach the wrapper over HTTP — it no longer needs to sit on the
Minecraft host.

The dashboard still edits the bot's config, in the bot's container. Unchanged.

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

- **`/stats <player>` errored for anyone who had never played.** The wrapper
  answers 404 for a missing stats file, which is an answer, not a failure —
  but `readStats` let it throw, so the command replied "Failed to retrieve
  stats" and logged an ERROR where it should have shown the "Stats File Not
  Found" embed it already has. A 500 still throws: a broken read must not look
  like an empty one.
- **Period leaderboards could silently report all-time totals.** If a stats
  read returned nothing, `takeSnapshot` recorded an empty snapshot; baselines
  resolve a missing player to zero, so one empty snapshot in the window made
  every period board subtract nothing and present lifetime numbers labelled as
  the period. It now refuses to record an empty snapshot and logs why, naming
  the likely cause.
- **Daily rewards were reported as delivered without being checked.** `give()`
  verified the console's reply only when the bot held the RCON connection
  itself; on every other server it returned success without looking. The
  wrapper had been relaying that reply all along. It is now verified whenever
  there is one — and a wrapper that cannot be reached is failure (the reward
  stays queued), while a wrapper answering over screen with no output is
  unverifiable but not failed (the reward is not re-given on every join). Those
  two used to be the same `null`.

- **`src/` now holds workspaces and nothing else, and CI enforces it**
  (`npm run layout:check`). A stray file at `src/` root is invisible to every
  gate: it belongs to no tsconfig project so `tsc` never compiles it, eslint
  lints it without resolving imports so its broken ones pass, and vitest only
  globs `tests/`. Two files from another repo sat there unnoticed. Nothing in
  this repo should be able to hide from all three checks at once.

- **`/compare` threw for any player with a real stat file.** The field chunker
  summed line lengths against Discord's 1024-character limit, then joined the
  lines with `\n` — so the value it sent was longer than the one it measured,
  by one character per line. A chunk that counted 1020 shipped 1029 and the
  field was rejected. It only bites once a category fills a chunk, which is why
  it passed on thin fixtures and failed for everyone real: measured against the
  actual function, 60 shared stats built fine and 100 threw. Established
  players share thousands.

- **Player stats were invisible on servers that do not use the vanilla world
  layout.** `statsDir()` resolved `<level-name>/stats` and nothing else; a
  Fabric instance keeps its stat files at `<level-name>/players/stats`, next to
  `players/advancements`, with no `<level-name>/stats` at all. Every read
  missed, `/stats` and every leaderboard came back empty, and **nothing logged
  an error** — on the wrong path a miss is an `ENOENT`, which is exactly what a
  world nobody has played on looks like. Both layouts are now probed, at both
  ends (the wrapper needs the same fix, ≥3.1.1). Requires no config change.

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

### Changed

- `ServerInstance.supportsTps` is always true — the wrapper answers `/tps` for
  every instance. It used to depend on how the server was reached.
- TPS parsing, and its Bug 1/2/4 regression guards, moved to the wrapper
  (`tests/tps.test.ts` there), which owns the RCON connection and is therefore
  the only side that sees a `tps` response. The wrapper had the fixes and no
  tests; it now has both.
- `/config show` lists each server's `apiUrl` instead of its RCON host and
  Linux user.
- `docs/admin/sudoers.md` and `docs/admin/pm2.md` are gone. Sudo is the
  wrapper's requirement and the wrapper documents it; PM2 was a non-Docker
  guide.

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

### Security

- `/metrics` compared its bearer token with `!==`, which leaks the token's prefix
  through timing. Every secret comparison in the dashboard now goes through one
  constant-time `secretEquals()`.
- Migrations record their SQL checksum. Editing a shipped migration used to be
  silent — already-migrated databases skipped the new SQL, leaving schema and
  code disagreeing — and now refuses to start.

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

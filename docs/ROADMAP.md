# Roadmap

Last updated: August 2026, against **v5.1.0**.

This revision folds in two releases the document had fallen behind on:
5.0.0 (remote-only, `minecraft-server-api` becomes the single path to a
host) and 5.1.0 (the dashboard absorbs the standalone server-manager
panel). Items from the 3.6.0 revision are kept below where they are still
open.

## The short version

| Item | Status |
|---|---|
| Per-guild language | ✅ shipped in 3.6.0 |
| Streak transfer tool (`/daily-admin`) | ✅ shipped in 3.6.0 |
| Changelog + tagged releases + GHCR | ✅ shipped in 3.6.0 |
| Config change summary on reload | ✅ shipped in 3.6.0 |
| Follow-ups from the features batch (span polls, remote host metrics + handshake, presence down state, presence reload arming, waypoint categories/caps) | ✅ shipped in 3.6.0 |
| Web dashboard, phases 1–3 (+ `/healthz`, `/metrics`) | ✅ shipped in 3.6.0 |
| Player ideas (/profile, webhook bridge, /watch, /daily-history, streak + more leaderboard categories, milestones, whitelist applications) | ✅ shipped in 3.6.0 |
| Operator ideas (scheduled restarts, console access, moderation shortcuts, player-count history, backup staleness, update notifier, per-server reward pools, configurable limits, alert role mentions) | ✅ shipped in 3.6.0 |
| Maintenance (e2e nightly, i18n check, engines, wrapper handshake) | ✅ shipped in 3.6.0 |
| Web dashboard, phase 4 (public status/leaderboard pages) | open — only if there is demand |
| Replacing the retired panel's public status page | ✅ decided in 5.1.0: no |
| Cross-server network chat | deliberately deferred (see below) |
| Remote-only: drop RCON/screen/local file access | ✅ shipped in 5.0.0 |
| Dashboard live updates (SSE) | ✅ shipped in 5.1.0 as the live console |
| Per-capability dashboard access | ✅ shipped in 5.1.0 |
| Retire minecraft-server-manager | ✅ shipped in 5.1.0 |
| Mod config editor | open — sized below |

## Where things stand

v3.6.0 closes out the whole backlog this document used to carry:
operator tooling (scheduled restarts, console access, moderation
shortcuts, `/daily-admin`, backup-age alerts, update notifier), player
features (`/profile`, `/activity`, `/watch`, `/daily-history`, webhook
bridge, milestones, span polls, streak + six new leaderboard
categories, whitelist applications), per-guild language, and the web
dashboard (Fastify backend + Vue 3 frontend, Discord-OAuth2 admin
login, schema-driven config editing, server operations, Prometheus
metrics). Process-wise the repo now has a CHANGELOG, tag-driven
releases with a GHCR image, a locale-parity CI gate, and a nightly RCON
e2e smoke against a real Paper server.

Layout note for anyone returning after 3.5.x: the source split into npm
workspaces with ESLint- and dependency-tree-enforced boundaries so the dashboard
runs as its own process. Since 5.0.0 they live under `src/` as `src/bot`,
`src/core`, `src/schema` and `src/web` — see
[dev/architecture.md](dev/architecture.md) and
[dev/decisions.md](dev/decisions.md).

## What 5.x changed

**5.0.0** removed every local path to a Minecraft server. RCON, `screen`,
`sudo` and local file tailing are gone; the companion
`minecraft-server-api` wrapper is the only way in. The motivation was that
every feature written twice — once local, once remote — had drifted, and
the drift shipped as bugs.

**5.1.0** applied the same argument one layer out. The standalone
`minecraft-server-manager` panel ran on the Minecraft host and duplicated
the wrapper: its own RCON client, its own script runner, its own instance
registry. Its whole feature set now lives in the dashboard, reached through
the wrapper like everything else. See
[admin/retiring-server-manager.md](admin/retiring-server-manager.md).

That work also replaced the dashboard's single sysadmin gate with per-route
capabilities, because the panel's features (console, backup download,
restore, rollback) made "one grant for everything host-side" untenable. See
[admin/capabilities.md](admin/capabilities.md).

## Deliberately deferred

- **Cross-server network chat.** The previous revision already flagged
  this as "idea only" with an explicit caution: the strict one-channel ↔
  one-server default is what keeps conversations unmixed, and an opt-in
  relay mode must not soften it. Nothing in the 3.6.0 batch needed it,
  and span polls cover the main "one announcement, many servers" use
  case — so it stays deferred until a concrete need shows up. If built,
  it should be an explicit `networkChat` block relaying between LISTED
  servers with server tags in both directions, never a default.

## Open, uncommitted

- **Dashboard phase 4** — public (login-free) status and leaderboard
  pages. Everything else stays admin-only. Only if there is demand, and
  5.1.0 did not create any: the retired panel's login-free status page was
  looked at and dropped rather than replaced, so this stays exactly the
  open idea it has always been. If it is ever built it should be designed
  as a public page, not reconstructed from what the panel exposed.
- **Mod config editor** — browse and edit mod config files from the
  dashboard, for people who cannot SSH. The interesting half is that
  Forge/NeoForge TOML files document themselves in comments (`Range:`,
  `Allowed Values:`, `Default:`), so a schema can be derived and fed to the
  existing renderer; Fabric JSON and plugin YAML fall back to inferred
  types. Non-trivial: needs a format-preserving writer (parse-and-reserialize
  destroys the comments that *are* the documentation), a wrapper file API
  with the same opaque-handle addressing the backup routes use, and
  snapshots before every write. Ship read-only first.
- **A local break-glass login** — the retired panel had one; the dashboard
  is Discord-OAuth2 only. Deliberately not rebuilt, on the grounds that SSH
  plus the wrapper API key already covers it
  ([admin/emergency-access.md](admin/emergency-access.md)). Revisit if that
  runbook turns out to be needed more than about once a year.
- **Whitelist-application niceties** — an application history view for
  admins (the store already keeps decided applications) and optional
  auto-role on approval.
- **More locales** — the i18n layer is table-driven; a third language is
  one file plus the parity check.

## Not planned

- A hosted public instance. The config model assumes one operator who
  owns the process; self-hosting stays the deployment story.
- Minigames or an economy beyond the daily reward. Server-side plugins
  do this better.
- Discord message moderation or automod. Other bots specialize in it.

## How items get picked

Correctness and data safety first, then features that save admin time,
then player-facing polish. Issues and PRs that target a single roadmap
item are much easier to review than combined ones.

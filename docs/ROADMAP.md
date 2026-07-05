# Roadmap

Last updated: July 2026, written against **v3.6.0** — the release that
shipped this roadmap.

Everything that was "committed", "planned", or listed as a sized idea in
the previous revision of this document landed in 3.6.0 (see
CHANGELOG.md). This revision records what shipped, the one item that was
deliberately deferred, and the state going forward.

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
| Cross-server network chat | deliberately deferred (see below) |

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

Layout note for anyone returning after 3.5.x: the source split into
`src/bot` / `src/common` / `src/web` (ESLint-enforced boundaries) so the
dashboard runs as its own process — see
[dev/architecture.md](dev/architecture.md) and
[dev/decisions.md](dev/decisions.md).

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
  pages. Everything else stays admin-only. Only if there is demand.
- **Dashboard live updates** — the status view polls every 15 s; an SSE
  channel from the backend would make it feel live and could also carry
  the log tail. Small, purely additive.
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

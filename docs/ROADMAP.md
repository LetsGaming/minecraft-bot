# Roadmap

Last updated: July 2026, written against v3.5.0.

This is the working plan for where the bot goes from here. Three kinds of entries: things that are half done or were deliberately deferred during the multi-server work, the web dashboard (planned, foundation already in the code), and ideas that fit the project but have no commitment yet. Order inside each section is rough priority.

Size estimates: small is an evening or two, medium a weekend plus, large means multiple weekends.

## The short version

| Item | Status | Size |
|---|---|---|
| JSON schema for config.json | committed | small |
| Per-guild language | committed | medium |
| Streak transfer tool | committed | small |
| Changelog + tagged releases | committed | small |
| Web dashboard, phase 1 (read only) | planned | large |
| Web dashboard, phase 2 (config editing) | planned | large |
| Web dashboard, phase 3 (operations) | planned | medium |
| Everything under "Ideas" | idea | varies |

## Where things stand

v3.5.0 covers multi-server properly: per-server daily claims with automatic migration, server scoping (one ID, a list, or "everything this guild can see") on all push features, chat bridges that bind one channel to exactly one server, tenant isolation for multi-guild deployments, and a setup wizard that gets a working config.json in under 30 minutes. The config layer for a dashboard already exists (`src/utils/configService.ts`, `validateCandidateConfig`, atomic writes, `docs/dev/webui-integration.md`). 780 tests, CI runs typecheck, lint, tests, and `npm audit`.

## Still open from the multi-server work

- JSON schema for config.json: `docs/dev/webui-integration.md` points at `config_structure.json` as the form source "until a formal JSON Schema exists". Generate `config.schema.json` from `RawBotConfig` during the build (ts-json-schema-generator) and reference it via `$schema` in the template. Editors get autocomplete and inline validation for free, and the dashboard renders its forms from the same file. Size: small.

- Per-guild language: `language` is one global setting. A bot serving a German and an English community forces one of them into the wrong locale. Add `guilds.<id>.language` with fallback to the global value; `t()` needs a guild context passed through the call sites, which is mechanical but touches many files. Size: medium.

- Streak transfer tool: the claim migration moves every existing streak under the first configured server. Correct for single-server setups, arbitrary for multi-server ones. A `/daily-admin` command (move a user's record from server A to B, reset, show) fixes stranded data without editing `claimedDaily.json` by hand. Size: small.

- Config change summary on reload: `reconcileServers` already reports added, removed, and changed server IDs. Guild and feature level edits are invisible in the `/config reload` reply. Diff the raw config before and after and answer with a compact summary ("guild 111...: chatBridge added, notifications.server changed"). Size: small.

- Changelog and tagged releases: there is no CHANGELOG.md and versions only live in package.json. Adopt the keep-a-changelog format, tag releases, and let a GitHub workflow attach the build. Publishing a Docker image to GHCR fits into the same workflow (docker.md currently builds locally). Size: small, mostly process.

## Planned: the web dashboard

The one committed larger feature. Goal: configure and operate the bot from the browser the way Mee6 or ProBot users expect, without ever hand-editing JSON. The process-internal half is done; what is missing is the HTTP layer and the frontend.

Ground rules that hold across all phases:

- Auth is Discord OAuth2. Global pages require membership in `adminUsers`, guild pages accept that guild's `adminUsers` too, mirroring `middleware.isServerAdmin`.
- `token`, `apiKey`, and `rconPassword` never leave the server. GET responses return placeholders; a value is only overwritten when the user submits a new one.
- All writes go through `configService.writeConfig` and `applyConfig`. The dashboard can never produce a config the bot itself would reject.
- The server ships inside the bot process as an opt-in config block (`webui: { enabled, port }`), documented for localhost use and behind a reverse proxy. No TLS termination in the bot.

Phase 1, read only (large): login, server status (same data the status embed uses), uptime and sparkline, recent admin audit entries, current config with secrets redacted. Proves auth, sessions, and deployment before anything can break a config.

Phase 2, config editing (large): forms generated from the JSON schema, live validation through `validateCandidate`, save via `writeConfig` plus `applyConfig`. Whole-config PUT, no per-field patch API, because cross-field rules like bridge ambiguity need the full object.

Phase 3, operations (medium): start, stop, restart, and backup buttons through the same code paths as `/server` including `recordAdminAction`, log tail via the existing `tailLog`, prune-stats with the dry-run flow it already has.

Phase 4, optional public pages: a status page and leaderboards without login. Only if there is demand; everything else stays admin only.

## Ideas for players

- /profile: player head, linked account, whitelist member since (the audit log has `addedAt`), playtime and streak per server. All data exists, this is pure presentation. Size: small.

- Webhook chat bridge: post Minecraft chat through a channel webhook so every player appears with their own name and avatar instead of a bot embed. The look people know from DiscordSRV. Per-bridge option (`useWebhook: true`), requires the Manage Webhooks permission. Size: medium.

- "Tell me when" notifications: `/watch server:<id> when:online` DMs the user when the downtime monitor sees the server recover; `/watch player:<name>` pings when a friend joins. Builds on the existing downtime and join watchers, stored like the reminder opt-ins. Size: medium.

- /daily history and streak leaderboards: the last 30 claims per user are stored but shown nowhere. Add a history view and current/longest streak as leaderboard categories next to playtime and blocks mined. Size: small.

- More leaderboard categories: stats are already flattened in `statUtils`, so deaths, mob kills, or distance walked are one category definition away. Let guilds pick which categories their scheduled post includes. Size: small to medium.

- Milestone posts: a notification event when a player crosses configurable thresholds, for example 100 h playtime or 10k blocks mined. Reuses snapshots and the notifications channel. Size: medium.

- Whitelist applications: a button in a configured channel opens a modal (Minecraft name, optional message), the request lands in an admin queue with approve and deny buttons, approval runs the existing whitelist-add path including the audit entry. Replaces "DM an admin and wait" and is the single most useful onboarding feature for community servers. Size: large.

- Cross-server network chat: today one channel binds to exactly one server, on purpose. An explicit opt-in mode where a channel relays between listed servers (server-tagged in both directions) could come later, but it must not soften the strict default that keeps conversations unmixed. Idea only.

## Ideas for admins and operators

- Scheduled restarts and announcements: a cron-like schedule per server, countdown warnings through `/say` and the notifications channel, restart via the suite's `smart_restart` where available. Probably the highest value operator item on this list. Size: medium.

- Console access: `/console lines:<n>` on top of the existing `tailLog`, plus an opt-in live tail into an admin-only channel. The live variant needs rate limiting and batching so a busy server does not flood a channel. Size: medium.

- Moderation shortcuts: `/kick`, `/ban`, `/pardon` with a reason, forwarded to the console and written to the admin audit log. Deliberately thin, no ban database of its own. Size: small.

- Player-count history: status passes already sample player counts. Store a compact per-hour series and answer "when is the server busy" with a chart or the existing sparkline style. Size: medium.

- Backup insights: `/backup` lists tiers; add size and age of the newest backup and a downtime-style alert when it exceeds a threshold. Stale backups are the failure nobody notices until it matters. Size: medium.

- Health and metrics endpoint: once the dashboard HTTP server exists, `/healthz` and a Prometheus `/metrics` (players online, TPS, bridge throughput) are cheap additions for Grafana users. Size: small after dashboard phase 1.

- Update notifier: check GitHub releases daily, log and optionally DM operators when a newer version exists, opt-out in config. Size: small.

- Per-server reward pools: `dailyRewards.json` is global by design right now. An optional `servers.<id>` section that falls back to the default pool lets economies differ per server. Size: small.

- Configurable rate limits: the slash and bridge limiter caps are constants. Expose them under a `limits` block for very active servers. Size: small.

- Role mentions on alerts: downtime and TPS alerts post embeds nobody gets pinged for. An optional `mentionRole` per block makes sure the on-call person actually sees it. Size: small.

## Maintenance and tech debt

- Drop the `undici` override in package.json once @discordjs/rest ships a version past the advisory; the audit step in CI makes the moment visible.

- Nightly end-to-end run: docker compose with a Paper server and the bot, scripted smoke test (link, whitelist add, daily claim, bridge round trip). Keeps the RCON and screen paths honest without slowing the unit suite.

- Wrapper version handshake: the api-server and the bot evolve together. A version field in an `/info` endpoint plus a startup warning when the wrapper is older than the bot expects prevents silent feature mismatches.

- i18n key check in CI: fail when `en.ts` and `de.ts` diverge on keys. Missing keys currently fall back silently per key, which hides gaps.

- Node support: track the current LTS and state the supported range in `engines`.

## Not planned

- A hosted public instance. The config model assumes one operator who owns the process; self-hosting stays the deployment story.
- Minigames or an economy beyond the daily reward. Server-side plugins do this better.
- Discord message moderation or automod. Other bots specialize in it.
- Mod distribution or update management beyond the read-only `/mods` list.

## How items get picked

Correctness and data safety first, then features that save admin time, then player-facing polish. The "still open" section lands before new ideas. Issues and PRs that target a single roadmap item are much easier to review than combined ones.

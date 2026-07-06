# Dashboard and feature planning notes

> **Historical document.** Layout references (`src/bot`, `src/web`, the nested frontend npm project) predate the v4.0 workspace restructure — see [architecture.md](architecture.md) for the current tree and [decisions.md](decisions.md) (v4.0 entries) for what changed and why. The reasoning recorded here still applies.


> **Status (v3.6.0): SHIPPED.** The dashboard exists — backend at
> `src/web/backend` (Fastify), frontend at `src/web/frontend` (Vue 3
> Options API + Vite, an isolated subproject built to
> `dist/web/frontend`). All three phases are implemented, plus
> `/healthz` and Prometheus `/metrics`. The frontend-framework question
> below was decided as **Vue 3 + Vite** (not SvelteKit) — rationale in
> [decisions.md](decisions.md). This document is kept as the design
> record; where it disagrees with the code, the code and decisions.md
> win.

Written July 2026 against v3.5.1; updated after the community-features batch shipped and after two follow-up decisions: the target source layout (`src/bot` / `src/web` / `src/common`) and the process model (bot and web UI run with independent lifecycles). The feature proposals originally collected here have all been implemented — their status is summarized below and their follow-ups live in `docs/ROADMAP.md`.

## The short version

Decisions:

| Topic | Decision |
|---|---|
| Repo layout | Dashboard backend and frontend stay in this repo |
| Source layout | `src/bot`, `src/web/backend`, `src/web/frontend`, `src/common` — shared core in `common`, consumed by both |
| Process model | Bot and web UI have independent lifecycles; the web UI runs and works without the bot process |
| Frontend tooling isolation | npm workspace for `src/web/frontend`, no second repo |
| Backend framework | Fastify, TypeScript, same ESM build |
| Frontend framework | Leaning SvelteKit, final call open (see open decisions) |
| Auth | Discord OAuth2, signed http-only session cookies, no user database |
| Config API shape | Whole-config PUT through `configService`, no per-field patch |
| First PR | `config.schema.json` generation — **shipped** with the features batch |

## Implementation status

The twelve feature proposals from the original version of this document, plus the schema-generation first PR, shipped as the community-features batch on top of v3.5.1 (875 tests, CI now includes a schema drift check). As shipped:

| Feature | Shipped as |
|---|---|
| Death location recovery | `!deathpos` / `!lastdeath` + `deathCoords.dmLinked` DM with Chunkbase link |
| Community waypoints | `!waypoint set/del/<name>`, `!waypoints`, paginated `/waypoints` |
| Offline daily-claim delivery queue | queue in `pendingRewards.json`, delivery on join, cap 3 per player |
| Advancement challenges | `/challenge start/status/cancel` + win detection in the advancements watcher, new `challenge` notification event |
| `!slime` chunk checker | Java-Random-compatible LCG in `utils/slimeChunk.ts` |
| Cross-platform polls | `/poll` + `!vote`, linked accounts deduped, restart-safe close scheduler |
| Auto-role on link | `guilds.<id>.linkedRole`, non-throwing sync on link/unlink |
| `!report` tickets | greedy-arg `defineCommand` extension + `guilds.<id>.reports` routing |
| Host resources and disk alert | Host section in `/status` + `hostAlerts` watcher with hysteresis |
| Sessions and last-seen | `sessionStore` + `/sessions`, surfaced in `/whois`, crash/stop closing |
| Admin notes | `/note add/list/remove`, UUID-keyed, in `/whois` for admins |
| Bot presence | `presence: { enabled, server?, format }` riding the status pass |

Deviations from the original proposals, all deliberate: reports use a nested `guilds.<id>.reports` block instead of a flat `adminChannel` (codebase convention); polls bind to one server and `/poll` is admin-gated because creation broadcasts tellraw; `!deathpos` uses RCON-authoritative parsing with a log-poll fallback rather than a hard capability gate; the challenge item bonus bypasses the pending-queue cap (one-time system grant, not a farmable claim); `!waypoint del` was added beyond the proposed three subcommands. Cut-for-v1 follow-ups (multi-server polls, remote host metrics via the wrapper `/info`, presence down state, presence without the status embed, waypoint categories) are tracked in the roadmap's "Follow-ups from the features batch" section.

The rest of this document is the dashboard plan, which is still ahead.

## Dashboard: repository layout

The backend stays in this repo. This is not a preference, it follows from decisions the project already made: the entire `configService` seam (`readRawConfig`, `validateCandidate`, `writeConfig`, `applyConfig`) is process-internal by design, the dashboard shares `RawBotConfig`, and it reuses `isServerAdmin` semantics, `tailLog`, and `recordAdminAction`. A separate repo would force one of two bad options: publish those internals as a versioned package (semver discipline, a publishing pipeline, and a stable public API for what is currently a private implementation detail), or duplicate the config types and validation in the second repo, which is exactly the drift the single-write-path rule exists to prevent.

The frontend only talks HTTP, so a separate repo is defensible there, but the same-repo choice still wins: one PR updates schema, backend, and frontend atomically; one CI pipeline; one `git tag` describes the bot and its dashboard at a single version. The trigger that would justify a real second repo — the dashboard becoming independently useful against other backends — remains a "not planned" scenario.

### Source layout

The target layout inside the repo:

```
src/
  bot/       Discord client, commands, watchers, logWatcher — the bot entry point
  web/
    backend/ Fastify server, routes, auth — the web entry point
    frontend/ SvelteKit app, own package.json (npm workspace), own build
  common/    code consumed by both: config types + configService, validation,
             JSON stores, server access (RCON/screen/remote), audit, uptime,
             stats, i18n, logger
```

Rules that make the split hold:

- `src/common` imports nothing from `src/bot` or `src/web`. Bot and web both import `common`; nothing else crosses. Enforce it with a lint rule (`import/no-restricted-paths` or dependency-cruiser) so the boundary survives refactors — the same trick as the single write path: structure that cannot drift silently.
- What goes where is decided by one question: does it need the Discord gateway? `ServerInstance`, the stores, `configService`, validation, and the audit log do not — they move to `common`. Embeds, watchers, slash/in-game commands, and everything holding a `Client` stay in `bot`. If a module needs both, split it (the data half to `common`, the Discord half to `bot`) — the deaths watcher vs. the Chunkbase URL helper is the existing example of that split.
- The move is one mechanical PR of its own, before dashboard phase 1. It touches every import path and nothing else; mixing it with feature work would make both unreviewable. `package.json` entry points, the Dockerfile CMD, the schema generation script's type path, and CI globs update in the same PR.

## Dashboard: process model and lifecycle

Bot and web UI are separate entry points with independent lifecycles. The web UI must be fully usable without the bot process running; when both run, they interact — but neither depends on the other being up, and neither starts or stops the other.

This works because almost everything the dashboard touches is not actually the bot:

- Config: `readRawConfig`, `validateCandidate`, and `writeConfig` are file-based and live in `common`. Config browsing and editing work with the bot down.
- Applying config to a running bot: `applyConfig` calls into the live process and is therefore bot-only. The cross-process channel already exists and is already documented in `webui-integration.md`: the bot's fs watcher picks up a written `config.json` like a hand edit. So the web backend never calls `applyConfig` at all — it writes through `writeConfig` and lets the watcher do the rest. Running bot: change applies live. No bot: the write succeeds and applies on next start. Same code path either way, no RPC layer.
- Server status and operations: RCON, screen, and the shell scripts behind start/stop/backup do not go through Discord. `ServerInstance` in `common` gives the web backend the same status reads and phase-3 operations the slash commands use, bot or no bot.
- History and audit: uptime data, admin audit entries, and stats are JSON reads.

What genuinely needs the running bot: live gateway data (resolved guild/channel/role names for friendlier forms, presence state) and the "applied live" confirmation after a config write. These features detect bot liveness and fail with a useful message instead of erroring or hanging — "Config saved. The bot is not running; the change applies on its next start." is the contract, applied everywhere. The UI shows raw snowflakes with a note instead of resolved names when the bot is down; it never blocks an edit on them.

Liveness detection is a heartbeat file: the bot writes `data/runtime.json` (pid, startedAt, lastSeen) on the status cadence — one small addition next to the uptime flush it already does. The web backend treats a `lastSeen` older than two cadences as "bot down" and surfaces that as a banner plus per-feature messages. No sockets, no ports between the processes, restart-safe by construction.

Two constraints the split imposes, worth stating explicitly:

- The web backend treats the data stores as read-only, with two exceptions: `config.json` (through the single write path) and its own `recordAdminAction` entries. Everything else (`claimedDaily.json`, `sessions.json`, `polls.json`, ...) is bot-owned state; two processes doing read-modify-write on the same JSON file is a race the atomic `saveJson` does not protect against. If a dashboard feature ever needs to mutate bot-owned state, that is the signal to move the mutation behind a queue or into the bot — not to write the file from both sides.
- `webui: { enabled, port }` configures the web process; the bot ignores it. "enabled" gates whether the web entry point serves at all, so one config file still describes the whole deployment.

Deployment stays "clone, configure, run": `npm start` runs the bot, `npm run start:web` runs the dashboard, pm2/compose examples show both. Running only one of them is a supported configuration, not a degraded one.

## Dashboard: version control workflow

- Branch per phase: `feature/webui-phase1-readonly`, `feature/webui-phase2-config-editing`, and so on. Each phase is independently reviewable and shippable.
- The `src/` layout move ships as its own mechanical PR before phase 1 (see source layout above).
- ~~`config.schema.json` generation ships as its own small PR before any dashboard code.~~ Done: generated from `RawBotConfig` at build time, `$schema` in the template, drift-checked in CI. Fastify can consume it for request validation as planned.
- The changelog and tagged-releases roadmap item lands before or alongside phase 1. A growing HTTP surface is exactly when `CHANGELOG.md` plus git tags start paying for themselves.
- Secrets: extend `.env.example` with the new keys (OAuth client secret, session signing key) and keep `.gitignore` current. No real values in the repo, same as today with the bot token.

## Dashboard: stack

Backend: TypeScript, same `tsconfig`, same ESM build (`"type": "module"`, Node >= 18 per `engines`). Fastify over Express for three reasons: first-class TypeScript support, schema-based request validation that consumes the generated JSON Schema directly, and low overhead. It is its own entry point under `src/web/backend` (see process model) rather than a subsystem of the bot process.

Frontend: two viable paths were weighed.

- SvelteKit: small bundles, good form ergonomics, SSR for the read-only pages. Phase 2 (forms generated from the JSON schema with live validation through `validateCandidate`) is the bulk of the UI work, and it is much less painful with a real frontend framework.
- Server-rendered HTML (Fastify plus a template engine like `eta`): fewer new dependencies, faster to ship phase 1, but risks a rewrite between phase 1 and phase 2 once real interactivity arrives.

The leaning is SvelteKit, precisely to avoid that rewrite. Recorded as an open decision below.

Auth and sessions: Discord OAuth2 via `@fastify/oauth2` or a minimal hand-rolled flow, plus signed http-only cookies through `@fastify/secure-session`. No full auth library and no user database; the gate is Discord identity checked against `adminUsers` lists, nothing more. OAuth needs only the token for identity — it works without the gateway, consistent with the independent-lifecycle rule.

## Dashboard: design rules

1. Single write path. `writeConfig` remains the only way the HTTP layer touches `config.json`; apply happens through the bot's fs watcher (see process model). Route handlers stay thin: validate the request shape, call into `configService`, return its result. Validation is never reimplemented in the HTTP layer.
2. Middleware composition in the same shape as `withErrorHandling` and `requireServerAdmin`. Build `withAuth` and `requireGuildAdmin` Fastify hooks that mirror `isServerAdmin` exactly: global `adminUsers` or the target guild's `adminUsers`, with both user IDs and role snowflakes matching. Admin logic exists once and cannot drift between slash commands and the dashboard.
3. Reuse the read paths. Phase 1's server status, uptime, and audit views call into `uptimeTracker`, `adminAudit`, and `statUtils` from `common`, the same functions the embeds use, never the underlying JSON files directly.
4. Secret redaction is a serialization concern, not a route concern. One `toSafeConfig(config)` transform strips `token`, `apiKey`, and `rconPassword`; every GET response goes through it. Placeholders out, and a stored value is only overwritten when the user submits a new one.
5. Whole-object PUT, no per-field PATCH, exactly as `webui-integration.md` documents. Cross-field rules like chat-bridge ambiguity need the full object every time.
6. `RawBotConfig` is the wire format. No parallel dashboard-specific DTO shape; the type the validator already checks is what goes over the wire.
7. Bot-dependent features degrade, never break. Anything that needs the running bot checks the heartbeat and answers with a specific, actionable message ("bot offline — applies on next start", "names unavailable — showing IDs"). No route may assume the bot is up, and no route may block a config edit on bot-only data.
8. Tests stay in Vitest. Route tests use `fastify.inject()` in `src/web/backend`, same runner and patterns as the existing 875 tests, no second test framework. The liveness states (bot up, bot down, heartbeat stale) are fixtures, not special cases.

## Dashboard: build order

1. ~~`config.schema.json` generation.~~ Done (shipped with the features batch).
2. The `src/` layout move: `bot` / `web` / `common`, boundary lint rule, entry points, no behavior change.
3. Phase 1 read-only: Fastify server, Discord OAuth2, session cookies, the `isServerAdmin`-equivalent guard, heartbeat-based liveness, status, uptime, and audit pages reusing `common`.
4. Phase 2 config editing on top of the proven auth and session layer: schema-rendered forms, live validation, `writeConfig`, watcher-based apply.
5. Phase 3 operations, through the same `common` code paths as `/server` including `recordAdminAction` and `tailLog`.

## Dashboard: open decisions

- Phase 1 frontend: SvelteKit from the start, or server-rendered pages first with a framework added in phase 2. Leaning SvelteKit to avoid a rewrite between phases; not final.
- Heartbeat freshness window and whether phase 3 operations should require a *fresh* heartbeat before start/stop actions (to avoid racing a bot that is mid-reconcile) or stay independent since the shell paths do not go through the bot. Default position: independent, with the audit entry recording which interface triggered the action.

## Grounding

The original version of this document listed source-level checks for every feature claim (no `setPresence` call existed, `/whois` had no last-seen, `daily.ts` rejected offline claims, and so on). Those checks did their job and are now stale by success — the features they motivated are in the tree. The dashboard-relevant grounding that still holds, re-verified after the batch: the `configService` surface and the whole-config PUT contract in `docs/dev/webui-integration.md` (including the fs-watcher apply fallback this plan now builds on), `config.schema.json` generated and drift-checked in CI, 875 tests, actions pinned to SHAs, `npm audit --audit-level=high` as a CI gate.

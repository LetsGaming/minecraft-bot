# Agent instructions for this repo

This is a Discord bot that runs one or more Minecraft servers from Discord: a two-way chat bridge,
player stats and leaderboards, health/performance monitoring, and full server control without
SSH — plus an optional web dashboard. TypeScript throughout in an npm workspaces monorepo
(`src/{schema,core,bot,web}`): `@mcbot/schema` (isomorphic contracts), `@mcbot/core` (config, data
layer, server access, Minecraft domain), `@mcbot/bot` (the Discord process — discord.js), `@mcbot/web`
(optional dashboard — Fastify backend + Vue/PrimeVue frontend). SQLite (better-sqlite3, with a
`node:sqlite` fallback) for machine-written state; human-authored config stays JSON (`config.json`,
`dailyRewards.json`) — see `docs/dev/architecture.md`.

The bot talks to each Minecraft server through a small API wrapper (`docs/admin/remote-setup.md`)
that can run on the same or a different machine — the bot never touches RCON or the filesystem of
the Minecraft host directly. Some features (`/server`, `/backup`, `/mods`) depend on files that the
[minecraft-server-setup](https://github.com/LetsGaming/minecraft-server-setup) suite provides; the
bot degrades gracefully (capability probing, see `docs/admin/setup.md#plain-server-or-setup-suite-server`)
on a plain server.

Auth is real per-guild/global: a top-level `adminUsers` list are sysadmins, everyone else is
scoped through Discord OAuth (dashboard) or guild permissions (Discord commands) — see
`docs/admin/permissions.md` and `docs/admin/capabilities.md`. The bot's UI/command copy is
bilingual (`src/core/locales/{en,de}.ts`); touch both when you add or change user-facing strings,
and run `npm run i18n:check`.

Start with [`docs/README.md`](docs/README.md) for the full documentation map, split by audience
(admin/user/dev). For code changes, start at [`docs/dev/readme.md`](docs/dev/readme.md) — it maps
architecture, coding guidelines, the `@mcbot/schema` contract rules, testing, and the decision log.
Docs link to source instead of restating values that could drift; when a doc and the code it links
to disagree, the code is right — that's a bug in the doc, not the code.

## Before doing any dev/manual-testing work

Run:

```bash
node scripts/dev-up.mjs --id <your-session-id> [--only bot|web|both]
```

Pick `<your-session-id>` yourself — something short and specific to this task/session (e.g.
`rank-decay-bug`, `mods-tab-copy`). This starts an isolated instance on its own config.json, its
own disposable SQLite database, its own log dir, and (for the dashboard) its own automatically
picked free ports. `--only` defaults to `both`; pass `bot` or `web` to skip the half you don't need
— it's faster and one less process to reason about.

**No real Discord credentials are needed by default.** This bot can't do anything without a live
Discord gateway token, and the dashboard can't log in without a real Discord OAuth app — neither of
which an isolated dev session has. So by default:

- the bot skips the Discord gateway login (`MCBOT_DEV_NO_DISCORD=1`) but still boots config/DB
  loading, server capability probing, and log watchers/RCON-via-wrapper — everything that doesn't
  need a live connection. Slash commands, interactions, and channel posts do **not** work in this
  mode; that's expected, not a bug to chase.
- the dashboard skips Discord OAuth (`MCBOT_DEV_NO_AUTH=1`) and treats every request as a fixed dev
  sysadmin — no login screen, straight into the app.

Pass `--real-discord` / `--real-auth` only if you actually have `DISCORD_TOKEN` /
`WEBUI_CLIENT_SECRET` set in your own environment and specifically need to test the real
integration — both flags fail loudly if the corresponding env var isn't already set.

There is **no mock-data seeding** here (unlike a fully-mocked-data project) — the generated
`config.json` points at a placeholder, unreachable Minecraft server, so server-status/RCON-backed
features will show "offline"/empty rather than real content. If a task needs a real server to test
against, point `MC_API_URL`/`MC_API_KEY` (env, read by the generated config) at one before running
`dev-up.mjs`.

**Known limitation:** there's no `tsx`/`ts-node` in this repo, so `dev-up.mjs` does a one-shot
`tsc -b` before starting Node — there is no live reload for bot/web-backend TypeScript. Re-run
`dev-up.mjs` after editing source under `src/bot` or `src/web/backend` (the Vue frontend still
hot-reloads normally via Vite). The build output (`src/*/dist/`) is shared, not per-session, like
the maintainer's own `pnpm`-equivalent — avoid starting two `dev-up` runs at the exact same instant.

**Never run bare `npm run dev` / `npm start` directly for manual testing, and never reuse another
session's server or port.** Each agent/session gets its own `--id` and therefore its own isolated
process(es), database, and (for the dashboard) ports — this is what stops concurrent agents from
clobbering each other's data or fighting over a port, and it holds across separate sessions too,
not just within one conversation.

## After finishing that work

Run:

```bash
node scripts/dev-down.mjs --id <the-same-session-id>
```

This stops exactly the process(es) `dev-up.mjs` started for that id (never a broad process-name
kill — only the recorded PIDs), then deletes that id's `config.json`, SQLite database, and logs.
Always pair a `dev-up` with a matching `dev-down`, even if the session ends abnormally —
`dev-up.mjs` also defensively wipes stale state under the same id before starting, but don't rely
on that; clean up your own id when you're done with it.

## Never do this instead

- Never `kill`/`taskkill` a dev process by matching its command name or working directory — you
  cannot tell your own dev process apart from another agent's that way (or from the maintainer's
  own long-running process). Use `dev-down.mjs`, which kills by exact recorded PID.
- Never delete `data/` or `logs/` wholesale, or edit the repo's own `config.json`/`.env` — those
  aren't scoped to your session and may belong to someone else's in-progress work or real
  deployment. `dev-up.mjs`/`dev-down.mjs` only ever touch `data/agent-<id>/` and `logs/agent-<id>/`.
- Never point a manually-started bot/dashboard process at the repo's real `config.json` or default
  ports "just this once" — even for a quick check. Use `dev-up.mjs` every time; it's exactly as
  fast and never collides with anyone else's session or risks a real Discord/Minecraft deployment.
- Never leave `MCBOT_DEV_NO_AUTH` / `MCBOT_DEV_NO_DISCORD` set outside of `dev-up.mjs`-managed
  sessions — they exist only for isolated dev/agent sessions and must never reach a real deployment.

See `scripts/dev-up.mjs` / `scripts/dev-down.mjs` / `scripts/lib/parseArgs.mjs` for the
implementation.

## Commands

- `npm run dev` — type-check-build `src/bot` + `src/web` in watch mode (no process is started;
  prefer `dev-up.mjs` above for actually running something).
- `npm test` / `npm run test:watch` / `npm run test:coverage` — full test suite (vitest), mirrors
  `src/*` under `tests/`. See `docs/dev/testing.md`.
- `npm run typecheck` / `npm run lint` — run before considering non-trivial work done.
- `npm run schema:generate` / `npm run schema:check` — regenerate/verify `config.schema.json` from
  the `RawBotConfig` type (`src/core/config.ts` and friends). Run `schema:generate` after changing
  the shape of `config.json`; CI enforces `schema:check` stays in sync.
- `npm run i18n:check` — verifies `src/core/locales/{en,de}.ts` stay in sync (no key present in one
  and missing in the other). Run after touching either locale file.
- `npm run layout:check` — verifies the repo's expected file layout (see `scripts/check-layout.mjs`
  for what it enforces).
- `npm run build` / `npm run build:all` — production build (bot only / bot+web+frontend). Not
  needed for dev work — `dev-up.mjs` builds only what it's about to run.

## Config changes

`config.json` is validated by hand-written logic in `src/core/configValidation.ts`, not by
`config.schema.json` at runtime — that JSON schema exists for editor/IDE hints and the setup
wizard (`scripts/setup.mjs`), and is generated from the `RawBotConfig` type. If you add or change a
top-level config field: update the type, run `npm run schema:generate`, and update
`docs/admin/configuration.md` plus `config.template.json` if the field is part of the normal setup
flow.

## Changelog

Add an entry to `CHANGELOG.md` under `## [Unreleased]` for any change that could plausibly bother
or interest an admin or player — a new command or dashboard feature, a behavior change, a fixed bug
they could have hit, a removed/renamed config field, anything touching the database schema or
migrations. Match the existing subheadings and the level of detail already used for entries below
`[Unreleased]` — short, user-facing, but this project's own convention keeps the touched
files/capabilities listed too (see existing entries), unlike a pure changelog-for-end-users style.

Skip it only for genuinely internal-only changes: refactors with no behavior change, renames,
test-only edits, comment/doc typo fixes, dependency bumps with no user-visible effect, dev-tooling
changes (`scripts/dev-up.mjs` etc.). When in doubt, add the entry.

## Workspace boundaries

`src/bot` may import `@mcbot/core` and `@mcbot/schema` only; `src/web` may import `@mcbot/core` and
`@mcbot/schema` only — neither imports the other, and neither imports across into the other's
directory. This is enforced by ESLint boundaries (`npm run lint`) and documented in
`docs/dev/architecture.md`; if a change seems to need bot code from web (or vice versa), the shared
logic belongs in `@mcbot/core` instead.

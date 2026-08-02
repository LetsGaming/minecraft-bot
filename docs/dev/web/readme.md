# `@mcbot/web`

The extension: an optional dashboard. One workspace, two artifacts — a Fastify
backend and a Vue 3 SPA it serves.

Started with `npm run start:web` → `src/web/dist/backend/index.js`, gated behind
`webui.enabled`.

```
src/web/
├── backend/
│   ├── index.ts        Entry: the enabled gate, its own server registry,
│   │                   opens the shared SQLite store
│   ├── server.ts       Builds the Fastify app; errors/rateLimit/static beside it
│   ├── auth/           Sessions, OAuth, roles, the Discord REST client
│   ├── config/         Secret masking, the schema the editor renders
│   ├── status/         /healthz, /metrics, status collection
│   └── routes/         One file per area, plus the TypeBox request shapes
└── frontend/           Vue 3 + Vite SPA → src/web/dist/frontend, served by
                        the backend
```

| Topic | File |
|---|---|
| Fastify, auth, routes, errors | [backend.md](backend.md) |
| Vue, composables, the API client, styling | [frontend.md](frontend.md) |

## The independence rule

**The dashboard never calls into the bot, and the bot never references the
dashboard.** They are separate processes with separate lifecycles, and the
dashboard has to work while the bot is down — that is when you most want it.

They meet in exactly two places, both of them data:

- **`config.json`** — the dashboard writes it through
  `configService.writeConfig`; the bot's fs-watcher notices and reloads. There
  is no reload endpoint, no IPC, no signal.
- **`data/bot.db`** — both open it, in WAL mode, with `busy_timeout`. SQLite
  arbitrates. This is why the audit log is a table and not a JSON file.

To make server control work without the bot, the dashboard builds **its own
`ServerInstance` registry** from the same core code. It is not talking to the
bot's instances; it is doing the same thing independently.

ESLint enforces the direction: `src/web` may import `@mcbot/core` and
`@mcbot/schema`, never `src/bot`. The dependency tree enforces it again —
`npm ci -w @mcbot/web` cannot even install discord.js.

## The two APIs

The dashboard exposes **two separate APIs, split by threat model**. This is the
single most important thing to understand before adding a route, because
choosing the wrong one is a privilege escalation, not a style mistake.

| | Host API | Guild-manager API |
|---|---|---|
| Gate | `capabilityGate` + a per-route capability | `requireSession` + per-route `canManageGuild` |
| Who | Sysadmins, plus anyone granted a capability in `webui.grants` | Anyone with Manage Guild on a guild the bot is in |
| Reach | Whatever their capabilities allow, per server | Exactly one guild's config block |

A guild manager is not a sysadmin. They administer *their Discord server*, not
*your Minecraft host*. Guild-manager routes must never expose the Minecraft
server, any secret, or another guild's config — and "never" includes indirectly,
through an error message or a schema dump.

Per-guild `adminUsers` are a Discord-command concept and confer nothing here.

## Capabilities

The host API used to be gated by one `requireSysadmin` hook, which made
"read the status page" and "restore a backup over the live world" the same
grant. That was survivable while the API was start/stop/log. It stopped being
survivable once the console, backups and the config editor landed, and it had
no way to express the case the whole thing exists for: someone who may tune a
mod's setting and nothing else.

So authorization is **per route, not per scope**. Each host route declares what
it needs in Fastify's route `config`, and one hook on the scope enforces it:

```ts
api.get("/api/servers/:id/log", {
  schema: { params: IdParams },
  config: { capability: "server:read", scope: "server", param: "id" },
}, handler);
```

`scope` is mandatory and has no default, because the three modes differ in who
they let through and guessing is how a fleet-wide route quietly accepts a
single-server grant:

| `scope` | Checked against | Use for |
|---|---|---|
| `server` | that server's grants ∪ the `"*"` block | anything acting on one server |
| `global` | the `"*"` block only | fleet-wide routes (the audit log, `config.json`) |
| `any` | any server the caller holds it on | routes returning a collection **the handler then filters** |

`any` only proves the caller may see *something*. Filtering is the handler's
job — use `visibleServerIds`, and send only what the caller may display rather
than hiding rows in the UI.

The capability set lives in `@mcbot/schema/capabilities.ts`, grouped by blast
radius rather than seniority. Two entries are worth knowing about:

- **`server:console` is separate from `server:control`.** One console command
  can op an account, ban a player, or run a worldedit operation. A restart
  cannot. It feels smaller and is larger.
- **`bot:config` is not grantable.** It reads and writes `config.json`, which
  carries the Discord token and every RCON password, so it is sysadmin by
  definition. `resolveCapabilities` drops it if someone writes it into a grant
  by hand. That is also what stops a grantee escalating themselves: editing
  grants requires `bot:config`.

### Forgetting the hook is a boot failure

The risk of moving a gate from a scope to a route is missing one, which turns a
silent hole into a 200. `assertCapabilitiesDeclared` registers an `onRoute`
hook inside the host scope and throws during `buildServer()` if any route
carries no rule, names an unknown capability, omits `scope`, or is
server-scoped on a param its path does not contain. A crash on startup beats a
code review.

### What this does not protect against

**Dashboard RBAC is a boundary between dashboard users. It is not a security
boundary against anyone holding the wrapper's API key or a shell on the host.**

The wrapper has one key and no concept of a user, and it is not going to get
one: that would put the identity model on every game host and make every
permission change a wrapper release. Policy decisions live here; the capability
*floor* lives in the wrapper (`SCRIPT_MAP`, `SAFE_ARG`, path containment, the
backup file index). Those limits hold even when the dashboard is wrong.

The corollary is that the API key must never reach a browser. Every wrapper
call is proxied, including the console SSE stream and backup downloads — which
is why a multi-gigabyte archive passes through this process and why
`routes/backups.ts` streams rather than buffers.

## Deployment shape

The dashboard binds to `127.0.0.1` by default; exposing it is a reverse proxy's
job, which is also where TLS terminates. `helmet` and a real CSP are registered
in `server.ts`, and `/auth/*` plus the mutating `/api` routes go through a rate
limiter that reuses core's token bucket.

The images are per-artifact: the bot image carries no Fastify or Vite, the web
image no discord.js.

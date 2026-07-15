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

| | Sysadmin API | Guild-manager API |
|---|---|---|
| Gate | `requireSysadmin` | `requireSession` + per-route `canManageGuild` |
| Who | The operators in the **top-level** `adminUsers` list | Anyone with Manage Guild on a guild the bot is in |
| Reach | Server operations, host metrics, the full config including secrets | Exactly one guild's config block |

A guild manager is not a sysadmin. They administer *their Discord server*, not
*your Minecraft host*. Guild-manager routes must never expose the Minecraft
server, any secret, or another guild's config — and "never" includes indirectly,
through an error message or a schema dump.

Per-guild `adminUsers` are a Discord-command concept and confer nothing here.

## Deployment shape

The dashboard binds to `127.0.0.1` by default; exposing it is a reverse proxy's
job, which is also where TLS terminates. `helmet` and a real CSP are registered
in `server.ts`, and `/auth/*` plus the mutating `/api` routes go through a rate
limiter that reuses core's token bucket.

The images are per-artifact: the bot image carries no Fastify or Vite, the web
image no discord.js.

# Dashboard frontend

Vue 3 (`<script setup>`) + PrimeVue (Aura preset), built by Vite to
`src/web/dist/frontend` and served by the backend. No client state store: state
lives in a component or on the server.

```
src/web/frontend/src/
├── api.ts          apiGet / apiSend / handle<T> — every request goes through here
├── views/          One per tab: Overview, Status, Console, Backups, Guilds,
│                   Commands, Config, Audit
├── components/
│   ├── schema/     The config editor's field renderer (SchemaField and friends)
│   ├── ui/         Presentational primitives: EmptyState, StatusDot, ViewHeader…
│   └── SetupWizard.vue   A feature of its own, not a building block
├── composables/    The logic. Views render; composables decide
└── utils/          errorMessage, format, isRecord

`composables/` is deliberately flat: twelve files all named `useX.ts`, where the
name *is* the index. You reach for `useConfig` by typing it, not by browsing —
grouping would add a directory to guess at and buy nothing.
```

## Views render, composables decide

A view's job is markup and events. Fetching, polling, retry, error mapping, and
any branching live in a composable — `useConfig`, `useGuilds`,
`useServerActions`, `useServerStatus`, and so on, one per area.

The test: if a view contains a `fetch`, a `setInterval`, or a business rule, it
is on the wrong side of the seam. Move it down.

## One API client

Every request goes through `api.ts` (`apiGet` / `apiSend`, with `handle<T>` and
`UnauthorizedError`). There is no `API_BASE` in N files and no per-call
`fetch`. New calls route through it — that is what makes 401-handling and error
shape uniform without each caller remembering.

## Shared contracts, not re-typed ones

The frontend bundles `@mcbot/schema` directly. Anything the backend and the
browser both need to agree on — DTO shapes, Discord endpoints, the server-action
names, notification event keys — is imported from there, not retyped locally.
This is also why `@mcbot/schema` may not import Node built-ins: one `import path`
in that package and this build breaks.

`useServerActions` importing `isDisruptiveServerAction` from schema is the
pattern. The confirm dialog and the bot's confirm prompt then cannot disagree
about which actions are worth confirming, because there is one list.

The same applies to `isBlockedConsoleCommand`, which the console composable uses
to grey out a command before sending it. The backend enforces the deny-list with
that identical function, so the UI cannot promise something the backend refuses,
or the reverse.

## Render from capabilities, never from 403s

`useCapabilities` holds what the signed-in user may do, populated once from
`/api/me`. Views decide what to show from it.

The rule is that a control the caller cannot use should not be drawn, rather
than drawn and failing on click. Someone holding only `config:read` and
`config:write` on one server should see the config editor for that server and no
Servers tab at all — not six tabs that all 403.

Two shapes to keep straight:

- `can(capability, serverId)` mirrors the backend's lookup exactly, including
  the strict case: with no `serverId` it asks about the fleet-wide grant only.
- `canAnywhere(capability)` is for tab visibility, where the question is whether
  there is any server worth showing the tab for.

This is presentation, not enforcement. The gate is the backend's `onRequest`
hook; nothing here is a security boundary.

Gate on the **wrapper's** advertised features too, not on this build's version.
`ServerStatus.features` carries what each server's wrapper says it can do, so a
suite without `rollback.sh` shows no Rollback button and a wrapper too old for
the backup index hides the Backups tab. A hidden tab is better than one that
errors when opened.

## Long-lived streams

`useConsole` is the only composable that holds an `EventSource`. Two things
about it generalise:

- It is **per-view state, not a module singleton**. Two people can reasonably
  watch two different servers, and a shared instance would make the second
  hijack the first. Contrast `useGuilds`, which caches a fetch every view wants
  the same answer from.
- It caps what it keeps. The console holds a ring buffer of ~2000 lines; without
  that, a busy modded server turns every log line into a DOM node and the tab
  becomes unusable over lunch.

No ticket or token is needed: `EventSource` sends the session cookie on a
same-origin request, which is why the stream authenticates the same way every
other call does.

## Styling

Design values are tokens. Colours, spacing, and radii come from CSS variables,
not literals in a `<style>` block — including brand colours (`--brand-discord`
rather than `#5865f2` inlined wherever a Discord button appears).

The token system is not finished: there is still a tail of raw `px` in component
styles. New code uses tokens; touching an old block is a good moment to convert
it.

## The config editor

`SchemaField.vue` renders `config.schema.json` — the file generated from
`RawBotConfig` (see [contracts.md](../contracts.md)). That is why doc comments
on config types matter: they arrive here as help text.

The editor handles primitives, objects, arrays, and maps. `anyOf`/union nodes
are the known gap — they fall back to a raw JSON textarea, which works but asks
the operator to know the shape. Rendering them as a proper multiselect is the
open piece of work.

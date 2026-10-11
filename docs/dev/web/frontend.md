# Dashboard frontend

Vue 3 + PrimeVue (an Aura-based preset), built by Vite to
`src/web/dist/frontend` and served by the backend. Dark only, English only (see
[decisions.md](../decisions.md#wave-2-the-hybrid-direction-for-the-dashboard-and-discord)).
No client state store: state lives in a component, in the route or on the
server. Files keep the Vue style they were written in (Options API files stay
Options API, `<script setup>` files stay that way).

```
src/web/frontend/src/
├── main.ts         App setup: tokens, density, PrimeVue preset, router
├── router.ts       Hash routes, nav groups and gates, the leave guard
├── i18n.ts         t() and the English table (locales/en.ts)
├── tokens.css      Every raw colour and every scale; the only file with hex
├── statusTokens.ts Writes the status role colours from @mcbot/schema
├── preset.ts       PrimeVue preset built from var(--...) references
├── style.css       Base layer and the legacy --mc-* aliases
├── api.ts          apiGet / apiSend / handle<T>; every request goes through here
├── views/          One per nav entry (Overview, Servers, Console, Analytics, ...)
├── components/
│   ├── ui/         Shared building blocks (AppShell, EditorShell, StatusChip, ...)
│   ├── schema/     The config editor's field renderer (SchemaField and friends)
│   └── SetupWizard.vue   A feature of its own, not a building block
├── composables/    The logic. Views render; composables decide
└── utils/          Pure helpers (formatting, failure mapping, history, ...)
```

`composables/` is deliberately flat: every file is named `useX.ts`, and the
name is the index. You reach for `useConfig` by typing it, not by browsing.

## Views render, composables decide

A view's job is markup and events. Fetching, polling, retry, error mapping, and
any branching live in a composable (`useConfig`, `useGuilds`,
`useServerActions`, `useServerStatus` and so on, one per area).

The test: if a view contains a `fetch`, a `setInterval`, or a business rule, it
is on the wrong side of the seam. Move it down.

## Routes and deep links

[`router.ts`](../../../src/web/frontend/src/router.ts) uses hash history, so a
link works behind any reverse proxy without server rewrites. `NAV_GROUPS` is
the single list of pages: each entry has its group (Monitor, Manage, Admin),
icon, path, gate (a capability, `sysadmin` or `guild`) and whether it is
server-scoped. The sidebar, the phone drawer and the route table are all built
from it, so a page cannot exist in one and be missing from the other.

- A server-scoped page carries the server in the path (`#/console/<server>`).
  The sidebar's server picker is a route push, so switching server goes through
  the same leave guard as switching page.
- In-view state that is worth sharing lives in the route too: the Mods check
  (`?check=<version>&filter=blockers|ready`), the Mod config file
  (`/modconfig/<server>/<fileId>`), the Config filter and Raw tab
  (`/config/raw`, `?q=`), the open guild (`/guilds/<id>`). `App.vue`'s
  `viewProps` maps the route to view props; a view emits `update-route` and
  `App.vue` applies it with `router.replace`, so typing in a filter does not
  stack history entries.
- Routes render nothing themselves. `App.vue` renders the active view, so the
  Servers view stays mounted and keeps its status poll.
- A bare `#/`, an unknown path, or a page the user may not see goes to the first
  visible page; a server-scoped route with an unknown server falls back to the
  last used server, then the first one (`ensureRoute` in `App.vue`).

The leave guard is `router.beforeEach` plus
[`useUnsavedGuard`](../../../src/web/frontend/src/composables/useUnsavedGuard.ts):
editors register a dirty source (`registerDirtySource`), `leaveReason` decides
whether a navigation leaves the page or only switches server, and
`confirmLeave` asks before discarding. The same registry drives the browser's
`beforeunload` prompt.

## One API client

Every request goes through `api.ts` (`apiGet` / `apiSend`, with `handle<T>` and
`UnauthorizedError`). There is no `API_BASE` in N files and no per-call
`fetch`. New calls route through it; that is what makes 401 handling and error
shape uniform without each caller remembering.

Failures arrive as `ApiError { status, code, body }` (`isConflict(err)` and
`validationErrors(err)` are the two helpers). Branch on `status` or `code`
(`ApiErrorCode` in `@mcbot/schema`), never on the message text; the backend sets
`code` on every typed failure. `utils/loadFailure.ts` and
`utils/discordFailure.ts` turn a failure into the problem and recovery that an
`InlineError` shows in place of the content (an expired session, a missing
grant, a rejected bot token, Discord unreachable). A failed load never renders
as an empty list.

## Design tokens and the hex lint

[`tokens.css`](../../../src/web/frontend/src/tokens.css) is the only file that
may contain a raw hex colour. It holds every role and scale, grouped as type,
spacing, shape, control sizes, z order, motion, surfaces, text, accent, focus,
feedback, brand, the `ModIcon` initials tiles, the PrimeVue colour ramps and the
density overrides. Use the role, never the value: `var(--text-dim)`, not the
grey it happens to be today.

The seven status roles are not in `tokens.css`.
[`statusTokens.ts`](../../../src/web/frontend/src/statusTokens.ts) writes
`--st-<role>` and `--st-<role>-bg` at startup from `STATUS_TABLE` in
[`src/schema/status.ts`](../../../src/schema/status.ts), the same table the
bot's embed colours come from (see [Status table and glossary](#status-table-and-glossary)).
[`preset.ts`](../../../src/web/frontend/src/preset.ts) builds the PrimeVue
preset from `var(--...)` references only, including the focus ring.
`style.css` keeps the older `--mc-*` names as aliases of the roles so old
selectors keep working.

`tests/web/designTokens.test.ts` and `tests/web/contrast.test.ts` hold the
invariants: status tokens come from the table and never from `tokens.css`,
every alias resolves, text on the accent and the focus ring meet their contrast
ratios on every surface.

`npm run lint` runs [`scripts/check-frontend.mjs`](../../../scripts/check-frontend.mjs)
after ESLint, because ESLint here does not parse `.vue` files. It fails on:

1. a raw hex colour anywhere in the frontend except `tokens.css`,
2. an import of any workspace other than `@mcbot/core` and `@mcbot/schema`, or a
   relative import that leaves the frontend,
3. literal UI text in the template of a file in its `TRANSLATED` set (below).

## Density

[`useDensity`](../../../src/web/frontend/src/composables/useDensity.ts) stores
"Roomy" (`comfortable`) or "Compact" per browser and sets `data-density` on
`<html>`; `tokens.css` changes the control height, row padding and field gap
for compact. On a coarse pointer or below 760 px both densities use the 44 px
touch minimum, so the switch never shrinks a target on a phone. The switch
itself is in the sidebar (`AppShell.vue`).

## Components

Shared building blocks live in
[`components/ui/`](../../../src/web/frontend/src/components/ui/). Reach for
these before writing markup of your own:

| Component | Use it for |
|---|---|
| `AppShell` | The frame: grouped nav, server picker, density switch, phone top bar and drawer, skip link |
| `ViewHeader` | The page's `h1`, its purpose line, the server chip and header actions |
| `StatusChip`, `StatusDot` | Any status. Takes a status role, a `ServerState` or a `ConfigApplyState`; draws a shape and a label, never colour alone |
| `ConfigStatusChip` | Whether the bot applied the saved config |
| `EditorShell`, `EditBar`, `FieldRow`, `ReviewChanges` | Every editor (below) |
| `ChipsInput` | A free-text list: Enter or the optional separator adds, Backspace or a named remove button drops. PrimeVue's `AutoComplete` with typeahead off, since `InputChips` is deprecated |
| `ResponsiveTable` | A table that becomes one card per row on phones |
| `JobBlock` | One long operation: title, state, elapsed time or progress, output |
| `TypedConfirmDialog` | Confirms that need the target typed; mounted once in `App.vue` |
| `InlineError` | Problem, recovery and Retry in place of content that failed to load |
| `InlineBanner`, `StaleBanner` | Read-only, blocked or last-known data notices |
| `EmptyState` | Nothing here yet (not for errors) |
| `ModIcon`, `GuildAvatar` | An image with an initials fallback on a stable colour |

PrimeVue stays the base for form controls, dialogs, toasts and menus. Its
`DataTable` is not used for new tables: Backups and Mods use `ResponsiveTable`,
because `DataTable` cannot turn into cards on a phone. Analytics and the Audit
log still use `DataTable` with a card layout under 760 px.

Confirmations come in three levels from
[`useConfirmAction`](../../../src/web/frontend/src/composables/useConfirmAction.ts):
none for undoable actions, a plain confirm that states target, effect and
recovery, and a typed confirm for anything without an undo. A row that is
working is marked through `useRowBusy`, so the other rows stay usable.

## Editing a server-held document

`composables/useEditableDocument.ts` is the one implementation of "edit a JSON
document without losing anyone's work". The config, guild and commands flows use
it; the setup wizard follows the same rules with its own merge (below).

```ts
const editor = useEditableDocument<Doc>({
  load: async () => ({ doc, token }),            // token = hash or ETag of THIS read
  save: async ({ token, draft, changes }) => {}, // changes = { set, remove } of dirty units
});
```

- `draft` is edited freely; `dirty`, `dirtyKeys` and `isDirty(key)` compare it
  with the baseline from the last read. A document is split into **units**
  (default: top-level keys; pass `units` for a finer grain, as `useCommands`
  does with one unit per scope and command).
- The token from the load is what `save` sends. It is never refetched at save
  time: re-reading it first would make the conflict check always pass.
- After a successful save the document is re-read (new baseline and token). If
  that read fails the editor is `stale` and refuses further saves until reload.
- On a 409 the latest server version is merged field by field: units only the
  server changed are adopted, units only you changed stay, and units both
  changed become `conflicts` (rendered by `ConflictPicker`, resolved with
  `resolveConflict`). Saving is blocked until none are left. Your edits are
  never overwritten; `reloadDiscardingMine()` is the explicit way to drop them.
- Validation failures (`fieldErrors`) keep the edits; `utils/fieldErrors.ts`
  maps the backend's `  - path: message` lines onto the field that owns the
  path.
- Each instance registers with `useUnsavedGuard`, so the route guard and the
  browser's `beforeunload` both ask before work is lost.
- `reset()` forgets the document when switching to a different one (the guild
  editor does this per guild).

The setup wizard (`useGuildSetup`) reads the guild block and its hash once,
awaited, and blocks writing if that fails; `buildGuildBlock` merges decisions
into the existing block and `seedModel` marks shapes it cannot express (several
chat bridges) as preserved.

## The editor frame

Every editor (Config, Mod config, Commands, the guild config dialog) sits in
`EditorShell.vue`: notices, the read-only or conflict banner, the `EditBar`
(sticky at the top, docked to the bottom on phones), an optional toolbar, then
the group list beside the fields. The view's composable owns the state
(`EditorState` in `components/ui/types.ts`: `clean`, `dirty`, `saving`,
`conflict`, `error`, `readonly`) and the shell draws it. `FieldRow` is one
setting: the label bound to its control, the config key, help and effect lines,
the old value with Reset, and the error under the control. `ReviewChanges`
lists every pending change as was and now, and hides secret values.

`SchemaField.vue` renders `config.schema.json`, the file generated from
`RawBotConfig` (see [contracts.md](../contracts.md)). That is why doc comments
on config types matter: they arrive here as help text. A `@title` tag names the
field (otherwise the key is humanised), and an `@effect` tag (emitted through
`extraTags` in `scripts/generate-schema.mjs`) is shown as a line saying when a
change takes hold. Only add `@effect` where the code confirms the claim. Schema
forms call `composables/useSchemaForm.ts`, which indexes the form
(`components/schema/formIndex.ts`) for the filter, the per-field errors, the old
value and the review list. Secrets render as password fields that keep the
stored value unless something new is typed.

The editor handles primitives, objects, arrays, and maps. `anyOf`/union nodes
are the known gap: they fall back to a raw JSON textarea, which works but asks
the operator to know the shape.

## Text and the t() seam

All dashboard copy goes through `t(key, vars)` from
[`i18n.ts`](../../../src/web/frontend/src/i18n.ts). The table is
`locales/en.ts` merged with the English half of the glossary in
`@mcbot/schema`. `{name}` placeholders come from `vars`; a numeric `count`
picks `<key>.one` or `<key>.other` through `Intl.PluralRules`. The dashboard is
English only; a second language is a second table with the same keys and a
locale switch, nothing in the views changes.

`check-frontend.mjs` keeps the seam honest for the files listed in its
`TRANSLATED` set: their templates may contain no literal UI text between tags
and no literal `label`, `title`, `placeholder`, `aria-label`, `alt`, `header`,
`subtitle`, `summary` or `message` attribute. `{{ }}` expressions, comments and
`<code>` contents are exempt. Add a file to the set once its copy is moved into
`t()`; never remove one.

## Status table and glossary

Two files in `@mcbot/schema` are shared by the bot and the dashboard:

- [`status.ts`](../../../src/schema/status.ts): the seven status roles
  (`StatusRole`), each with a shape, foreground colour, chip tint, embed colour
  and glossary label key (`STATUS_TABLE`), and the maps from domain states to
  roles (`SERVER_STATE_ROLE`, `CONFIG_APPLY_STATE_ROLE`). Colour never carries a
  state alone; every role has its own shape. The dashboard chips and the
  Discord embed side bars read the same table.
- [`glossary.ts`](../../../src/schema/glossary.ts): the shared terms in English
  and German (server, guild, mod, backup, status and apply labels, backup type
  labels through `backupTierLabel`). Use a glossary key wherever a term appears
  on both sides, so `/backup` and the Backups page say "Pre-update" the same
  way.

## Shared contracts, not re-typed ones

The frontend bundles `@mcbot/schema` directly. Anything the backend and the
browser both need to agree on (DTO shapes, Discord endpoints, the server-action
names, notification event keys, status roles) is imported from there, not
retyped locally. This is also why `@mcbot/schema` may not import Node
built-ins: one `import path` in that package and this build breaks.

`useServerActions` importing `isDisruptiveServerAction` from schema is the
pattern. The confirm dialog and the bot's confirm prompt then cannot disagree
about which actions are worth confirming, because there is one list.

The same applies to `isBlockedConsoleCommand`, which the console composable uses
to grey out a command before sending it. The backend enforces the deny-list with
that identical function, so the UI cannot promise something the backend refuses,
or the reverse.

## Render from capabilities, never from 403s

`useCapabilities` holds what the signed-in user may do, populated once from
`/api/me`. Views and the nav gates decide what to show from it.

The rule is that a control the caller cannot use should not be drawn, rather
than drawn and failing on click. Someone holding only `config:read` and
`config:write` on one server should see the config editor for that server and no
Servers page at all, not six pages that all 403. Where a control stays visible
for orientation (a read-only user on Backups), it says which capability it
needs.

Two shapes to keep straight:

- `can(capability, serverId)` mirrors the backend's lookup exactly, including
  the strict case: with no `serverId` it asks about the fleet-wide grant only.
- `canAnywhere(capability)` is for nav visibility, where the question is whether
  there is any server worth showing the page for.

This is presentation, not enforcement. The gate is the backend's `onRequest`
hook; nothing here is a security boundary.

Gate on the **wrapper's** advertised features too, not on this build's version.
`ServerStatus.features` carries what each server's wrapper says it can do, so a
suite without `rollback.sh` shows no Rollback button and a wrapper too old for
the backup index hides the Backups page.

## Long-lived streams

`useConsole` is the only composable that holds an `EventSource`. Two things
about it generalise:

- It is **per-view state, not a module singleton**. Two people can reasonably
  watch two different servers, and a shared instance would make the second
  hijack the first. Contrast `useGuilds`, which caches a fetch every view wants
  the same answer from.
- It caps what it keeps. The console holds a ring buffer of about 2000 lines;
  without that, a busy modded server turns every log line into a DOM node and
  the tab becomes unusable over lunch.

No ticket or token is needed: `EventSource` sends the session cookie on a
same-origin request, which is why the stream authenticates the same way every
other call does.

## Tests

Composable, router and token tests run in the default Node environment under
`tests/web/`. Component tests under `tests/web/components/` opt into jsdom with
a `// @vitest-environment jsdom` pragma and mount through `@vue/test-utils` with
the shared helper `mountUi.ts`. A view that mounts a PrimeVue `Select` needs a
`matchMedia` stub, because PrimeVue asks for it on mount. See
[testing.md](../testing.md).

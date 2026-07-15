# Shared contracts (`@mcbot/schema`)

The package every other workspace depends on and that depends on nothing. If a
type, a value, or a format has to mean the same thing in two workspaces, it
belongs here — otherwise each layer keeps its own copy and they drift.

## The package rule

**No Node built-ins, no runtime dependencies.** The browser frontend bundles
this package directly, so a single `import path from "path"` anywhere in it
breaks the Vue build. ESLint enforces the boundary
(`eslint.config.js`); the rule is worth keeping even when a Node import would be
convenient, because the alternative is the frontend re-implementing the contract
in TypeScript that nobody checks against the backend's version.

Types are free. Runtime values are fine too, as long as they are plain data and
pure functions — `@mcbot/schema` used to be types-only, and no longer is
(see below).

## What is in here

| File | Contract |
|---|---|
| `config.ts` | `RawBotConfig` and every config sub-shape. The source `config.schema.json` is generated from. |
| `stats.ts` | Stat/leaderboard shapes, plus the leaderboard interval durations |
| `contract.ts` | Web API request/response DTOs |
| `notifications.ts` | The notification event keys and the default set |
| `commandOptions.ts` | Slash-command option names shared by bot and dashboard |
| `discord.ts` | Discord origins/endpoints, and the snowflake ID format |
| `serverActions.ts` | The management-script action names, and which of them are operator-triggerable |

## When something becomes a contract

The test is not "is it shared code" — it is **"would two layers disagree if they
each decided this for themselves?"** Every file above is here because they did:

- `serverActions.ts` exists because the dashboard's action list
  (`start`/`stop`/`restart`/`backup`) and the script runner's table
  (which also has `status`) were separate literals, and the route reached the
  capability flags through a cast to paper over the gap.
- `discord.ts`'s `isSnowflake()` exists because the same `/^\d{17,20}$/` was
  inlined in the config validator, the update notifier, and the dashboard's
  sysadmin gate. Discord IDs have grown a digit before.
- `stats.ts`'s `LEADERBOARD_INTERVAL_MS` exists because the scheduler's
  interval table and the snapshot retention policy each had their own idea of
  how long a "monthly" board covers — and retention has to outlive the longest
  period, or the board silently loses its baseline.
- `notifications.ts` exists because the setup wizard wrote a guild's
  notification channel without an event list and the dispatcher dropped every
  event when the list was unset, so the feature was dead on arrival for every
  guild the wizard configured.

If you are about to write a literal that something in another workspace also
has to know, put it here instead.

## The shape to use

A const tuple, the union derived from it, and a type guard:

```ts
export const NOTIFICATION_EVENTS = ["join", "leave", "death", ...] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export function isNotificationEvent(value: string): value is NotificationEvent {
  // Widen the const tuple to readonly string[] so .includes accepts an
  // arbitrary string (TS otherwise restricts the arg to the literal union).
  return (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}
```

This buys three things at once: the runtime list to validate against, the
compile-time union to type fields with, and the guard that narrows a `string`
from the wire into that union — which is what removes the cast at the boundary.
Derive subsets with `satisfies` so they can't drift from the parent:

```ts
export const SERVER_OPERATOR_ACTIONS = [
  "start", "stop", "restart", "backup",
] as const satisfies readonly ServerScriptAction[];
```

Derive `Record`s from the union rather than restating the keys
(`Record<ServerScriptAction, boolean>`), so adding a member fails the build in
every place that has to handle it. That failure is the feature.

## The generated JSON Schema

`config.schema.json` at the repo root is generated from `RawBotConfig`:

```bash
npm run schema:generate   # rewrite it
npm run schema:check      # fail if it drifts (CI runs this)
```

The chain is `src/schema/config.ts` → `config.schema.json` → editor
autocompletion via `$schema` in `config.template.json`, plus the dashboard's
schema-driven config forms. **When you touch a config type, regenerate and
commit the result** — CI fails otherwise.

Only `config.ts` and the types it reaches feed the generator, so a runtime const
elsewhere in the package does not change the output. Doc comments on config
fields do: they become `description` in the schema and show up as help text in
the dashboard editor, which makes them worth writing.

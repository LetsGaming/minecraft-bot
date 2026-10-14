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
| `wire/` | The wrapper's HTTP wire types, generated from the vendored `openapi.json` (`npm run wire:sync`), plus the names the bot and dashboard import them by |
| `notifications.ts` | The notification event keys and the default set |
| `commandOptions.ts` | Slash-command option names shared by bot and dashboard |
| `discord.ts` | Discord origins/endpoints, and the snowflake ID format |
| `serverActions.ts` | The management-script action names, which are operator-triggerable, which are disruptive, and which are irreversible |
| `capabilities.ts` | Dashboard capabilities, the grant shape, and the resolution rules the gate and the UI both use |
| `analytics.ts` | The dashboard analytics response DTOs and `ANALYTICS_CAP_HOURS`, the per-section retention ceilings the routes clamp to and the view labels with |
| `status.ts` | The seven status roles (shape, colour, tint, Discord colour, label key) and the mappings from `ServerState` and `ConfigApplyState` onto them |
| `glossary.ts` | Terms and status labels in English and German, so the bot and the dashboard name things alike |
| `consoleCommands.ts` | The console deny-list: normalisation and matching, shared by the route that enforces it and the editor that greys a command out |

## The wrapper wire contract

The types for the wrapper's HTTP API are not written here. The wrapper owns
them and the bot generates its side:

1. The wrapper declares a response schema on every route
   (`src/contracts/schemas.ts` there) and generates `openapi.json` from its
   router (`npm run openapi:generate`). The committed file has a drift test in
   the wrapper, so it cannot disagree with the routes it serves.
2. The bot vendors that file as `src/schema/wire/openapi.json` and generates
   `src/schema/wire/types.ts` from it with `openapi-typescript`:

   ```bash
   npm run wire:sync -- <wrapper checkout>   # or WRAPPER_DIR=<checkout>
   npm run wire:check                        # CI: vendored copy and types are current
   ```

   `wire:check` always verifies `types.ts` against the vendored file; with a
   wrapper checkout it also verifies the vendored file against the wrapper's.
3. `src/schema/wire/index.ts` names the generated schemas the way the bot uses
   them. Where a newer wrapper feature added a field, the name declares it
   optional (`InstalledMod.enabled`), because the bot also talks to older
   wrappers. `serverAccess.ts` and the dashboard frontend import these names;
   nobody restates a wire shape by hand.

`parseManifest` in `wrapperContract.ts` stays hand-written and strict: the
manifest is read before the feature gate can vouch for anything else, and
`/health`'s `state` flows into alerting, so those are narrowed from `unknown`
rather than cast.

### Changing a wrapper route

The order is fixed by who depends on whom:

1. Wrapper: change the route and its schema, regenerate `openapi.json`, extend
   its tests. Bump the feature version in its manifest if the shape changed in
   a way an older reader would misparse.
2. minecraft-server-setup: bump the submodule pointer to that wrapper commit
   (see that repo's `docs/wrapper-submodule.md`).
3. Bot: `wire:sync`, adapt callers, extend `scripts/e2e-wrapper-contract.mjs`
   (it fails on a manifest route with no case), raise
   `EXPECTED_WRAPPER_FEATURES` if the bot now needs the new version.

The wrapper always ships first. The compatibility policy is a one-minor
window: within a major version the wrapper serves the old and the new shape
side by side, and the bot negotiates through the manifest's per-feature
versions rather than the wrapper's semver. The old shape goes in the next major.
Lockstep releases are for the cases where that window is impractical; both pull
requests then link each other and merge together.

CI enforces the order: `contract.yml` runs the e2e against the wrapper's
default branch and against the commit the suite pins, so a bot that is ahead of
either shows up as a red leg, and `release.yml` runs the same gate before it
publishes anything. The release gate checks against the wrapper ref in the
repository variable `WRAPPER_REF` (default `main`); set it to the wrapper tag a
release is meant to work with. The gate job has a read-only token; only the
publish job that follows it can write the release and the image.

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

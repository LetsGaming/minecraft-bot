# Config

`config.json` at the repo root is the one place an operator configures the bot.
This page is about the code that reads it; the field-by-field reference for
operators is [admin/configuration.md](../../admin/configuration.md).

## The path a config value takes

```
config.json ──┐
              ├─▶ validate ─▶ env overrides ─▶ variables.txt ─▶ freeze ─▶ loadConfig()
defaults  ────┘
```

- **`config.ts`** owns loading, the env overrides, the `variables.txt` merge,
  the frozen cache, and the `fs.watch` hot reload.
- **`configValidation.ts`** owns the semantic checks — the ones a JSON Schema
  cannot express: does this guild's `defaultServer` name a server that exists,
  is a chat bridge ambiguous, does `linkedRole` look like a role ID.
- **`config.schema.json`** (generated, see [contracts.md](../contracts.md)) owns
  the *shape*: types, required fields, unknown-key rejection.

Two validators sound like duplication, and the split is deliberate: shape is
generated from the types and cannot drift, semantics need to look at the rest of
the config. Adding a field means touching `src/schema/config.ts` and
regenerating — not writing a shape check by hand.

## Secrets

`token`, `rconPassword`, and `apiKey` are env-injectable and never committed.
The dashboard masks them on read and merges the placeholders back on write
(`web/backend/safeConfig.ts`). **A new secret field has to be added to
`SERVER_SECRET_KEYS`**, or it leaves the process in a config GET the first time
someone opens the editor.

## Hot reload

Both reload paths — `/config reload` and the file watcher — end up in
`reconcileServers()`. What that does with added, removed, and changed servers is
in [architecture.md](../architecture.md#config-reload-reconciliation).

The important half of the contract is who is allowed to *write*: the dashboard
writes config through `configService.writeConfig`, the bot only reloads it. The
bot's `/config` command is reload-only on purpose. That is what keeps the two
processes independent — the dashboard never needs the bot to be running, and the
bot never needs to know the dashboard exists.

## Where writes are allowed to land

Anything the runtime writes must live under the volumes the entrypoint chowns
(`data/`, `logs/`). This bit the config writer once: it did a temp-then-rename
next to `/app/config.json`, which is root-owned in the image, and `rename` over
a read-only single-file bind mount fails regardless. If you add a write path,
check where the file actually lives in the container, not just on your laptop.

## `configHistory` and `configDiff`

- `configDiff.ts` turns two config states into the human summary `/config
  reload` prints, so a reload reports what changed instead of changing things
  silently.
- `configHistory.ts` snapshots the config each dashboard write *replaces*
  (gzipped, retained for a bounded window), which is what makes the dashboard's
  rollback button possible.

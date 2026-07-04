# WebUI integration (preparation)

The bot is structured so a web dashboard can be added
later **without touching the core**. This page documents the seams that
exist today and how an HTTP layer would use them. No web server ships with
the bot yet — this is the contract for building one.

## The one rule

**All programmatic config changes go through `src/utils/configService.ts`.**
Nothing else writes `config.json`. The service guarantees that a UI can
never produce a config the bot itself would reject, and that a crash
mid-write can never corrupt the file.

## The API surface

```ts
import {
  readRawConfig,      // → RawBotConfig  (raw on-disk JSON)
  validateCandidate,  // (unknown) → { valid, errors, warnings }
  writeConfig,        // (RawBotConfig) → { warnings }   (throws on errors)
  applyConfig,        // (client) → { config, added, removed, changed }
} from "./utils/configService.js";
```

A typical edit round-trip:

```
GET  /api/config          → readRawConfig()          (redact token/apiKey/rconPassword!)
POST /api/config/validate → validateCandidate(body)  (live form validation)
PUT  /api/config          → writeConfig(body) then applyConfig(client)
```

- `writeConfig` re-validates, then writes atomically (`config.json.tmp` +
  rename) and keeps the previous file as `config.json.bak`.
- `applyConfig` reloads the config cache and reconciles running server
  instances and watchers — the same code path `/config reload` uses, so
  adding/removing/re-pointing a server from the UI behaves exactly like
  the Discord command.
- Skipping `applyConfig` is also fine: the existing fs watcher picks the
  change up like a hand edit.

Validation errors are human-readable strings (one per problem, already
indented) — render them as-is next to the form. `warnings` are non-fatal
and should be shown but not block saving.

## Form generation

`config_structure.json` (repo root) is the annotated example of every
field and stays in sync with the validator; use it as the schema source
for rendering forms until a formal JSON Schema exists. The authoritative
shape is `RawBotConfig` in `src/types/config.ts`.

Multi-server semantics the UI should encode:

- Push features (`notifications`, `tpsAlerts`, `downtimeAlerts`,
  `leaderboard`) take `server` as **one ID, a list, or empty** ("all
  servers this guild can see") — a multi-select with an "all" state maps
  1:1.
- `chatBridge` is a list of `{ channelId, server }` pairs where each
  channel binds to exactly one server; the validator rejects ambiguous or
  double-bound channels, so the UI can simply surface those errors.

## Auth (decide when building the UI)

The service layer deliberately has **no** auth — it is process-internal.
The HTTP layer must bring its own, and the natural fit is Discord OAuth2:
require the logged-in user to be in `adminUsers` (global) for global
sections, or in a guild's `adminUsers` for that guild's section, mirroring
`middleware.isServerAdmin`. Never expose the raw `token`, `apiKey`, or
`rconPassword` values in GET responses; return placeholders and only
overwrite when the user submits a new value.

## What deliberately does NOT exist yet

- No HTTP server, no routes, no sessions — nothing to secure or update
  until a UI is actually built.
- No per-field patch API; the contract is "PUT the whole candidate". That
  keeps validation whole-config (cross-field rules like bridge ambiguity
  need full context) and the UI simple.

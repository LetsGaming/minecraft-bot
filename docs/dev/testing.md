# Testing

The project uses [vitest](https://vitest.dev). 84 test files with ~1060 tests cover the core utilities, the RCON client, the data layer, watchers, schedulers, the dashboard backend, and most commands. CI (GitHub Actions) runs typecheck, lint, the full suite, `npm audit --audit-level=high`, locale parity, and the schema drift check on every push and PR.

## Running tests

```bash
npm test               # full suite, single run
npm run test:watch     # watch mode while developing
npm run test:coverage  # adds a text + HTML coverage report (coverage/)
```

Run a single file or pattern:

```bash
npx vitest run tests/commands/daily.test.ts
npx vitest run -t "streak"
```

## Layout and conventions

- All tests live in `tests/`, named `<area>.test.ts`, and cover every workspace from one suite. They are excluded from the production build.
- **Grouped by subject, not by workspace**, because most tests span both: a command test exercises `bot/` while mocking half of `core/`. Where a test's *subject* lives is the question that has an answer.

  | Directory | Subject |
  |---|---|
  | `config/` | Loading, validation, env overrides, history |
  | `db/` | The store modules and the migration runner |
  | `minecraft/` | Stats, snapshots, players, world math |
  | `server/` | ServerInstance, serverAccess, RCON, the wrapper contract |
  | `commands/` | Slash commands, middleware, the resolver |
  | `ingame/` | `!commands` and their loader |
  | `watchers/` | Log watchers, monitors, schedulers |
  | `web/` | Dashboard backend and frontend logic |
  | `utils/` | The framework-free primitives |
  | `suites/` | Thematic sets that span everything — regressions, audit fixes |

  `setup.ts` stays at the root; `vitest.config.ts` names it directly. The `include` glob is already recursive, so a new subdirectory needs no config change.
- Workspace specifiers resolve to TypeScript sources via the aliases in `vitest.config.ts`, so tests, `vi.mock()` specifiers, and the code under test all hit the same files with no build step.
- `globals: false`: import `describe`, `it`, `expect`, `vi` from `vitest` explicitly.
- Tests import from `src/.../*.js` (the same ESM suffix convention as the source).

## Mocking patterns used in this repo

**Discord interactions** are mocked as plain objects with `vi.fn()` members:

```ts
const interaction = {
  user: { id: "123", tag: "user#0" },
  options: { getString: vi.fn().mockReturnValue("survival"), getSubcommand: vi.fn() },
  deferReply: vi.fn(),
  editReply: vi.fn(),
  reply: vi.fn(),
  guild: { id: "guild1" },
} as unknown as ChatInputCommandInteraction;
```

Assert on what was sent: `expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({...}))`.

**ServerInstance** is mocked per test via `vi.mock("../src/core/utils/server/server.js", ...)` or by passing a stub object with `sendCommand`, `getList`, `isRunning` as `vi.fn()`. The layering exists precisely so this works without touching sockets.

**RconClient** is tested against an in-process mock socket; see `tests/server/rconClient.test.ts` for the packet encode/decode round trips.

**Database state**: `tests/setup.ts` points `MCBOT_DB_PATH` at `:memory:` globally, so no test can write `data/bot.db` into the working tree. Suites that exercise the stores call `closeDbForTesting()` between tests — closing an in-memory database drops it, which is the cheapest possible reset. The setup file also falls back to the `node:sqlite` driver where better-sqlite3's native binding cannot load.

**Filesystem state**: tests that exercise `loadJson`/`saveJson` or the log watcher create a temp directory (`fs.mkdtemp`) and point the code at it. Never write into the repo's real `data/`.

**Time**: use `vi.useFakeTimers()` plus `vi.setSystemTime()` for cooldowns, streak math, and schedulers. Restore with `vi.useRealTimers()` in `afterEach`.

**Module state**: several modules hold module-level caches (whitelist cache, stats TTL cache, link state). Use the exported invalidate/reset helpers (`invalidateAllStatsCache()`, `invalidateWhitelistCache()`, `_resetStateForTesting()` in the link command) or `vi.resetModules()` between tests so order does not matter.

## What a good test for this repo looks like

1. Arrange: temp dir or fake timers if state/time is involved, mocked server/interaction.
2. Act: call the exported function (commands export `execute`; pure logic like `calcStreak`, `flattenStats`, `parseListOutput` is exported directly so it can be tested without Discord).
3. Assert on observable behavior: what was replied, what command was sent to the server, what was written to disk. Avoid asserting internals.

When fixing a bug, write the failing test first and keep it as the regression guard. The existing B-xx fixes in the code each have one; follow that pattern.

## Mock the seam, not the thing you are testing

The most useful lesson this suite has taught, twice:

- The leaderboard tests mocked `buildLeaderboard` itself, so the whole builder
  and every caller's use of it were asserted against a `vi.fn()`. The suite was
  green while scheduled boards were showing the wrong period. Mock what the unit
  *depends on* (`serverAccess`, the clock), then let the real code run.
- When a helper moves *into* the module under test, the mock that used to stub it
  from outside now stubs the thing being tested. Delete it and mock the new
  dependency instead.

A test whose subject is mocked will pass forever and prove nothing.

## Retention, schedules, and other time-shaped contracts

Anything whose correctness is "the right record still exists N hours later"
needs a test that actually walks the clock: insert a series with
`vi.setSystemTime()`, run the real cleanup, then assert on **what the readers
find afterwards** rather than on the row count. Retention and its readers are one
contract; asserting either alone is how a 24-hour hole went unnoticed through a
green suite. `tests/minecraft/snapshotUtils.test.ts` is the pattern.

## End-to-end

Two scripts, neither in the vitest suite, because both need something real
outside the process.

```bash
docker compose -f docker-compose.e2e.yml up -d --wait
npm run e2e:smoke        # a real Paper server, through the bot's own RCON layer
docker compose -f docker-compose.e2e.yml down -v

WRAPPER_DIR=../api-wrapper npm run e2e:contract   # a real api-wrapper
```

`e2e:smoke` runs nightly against a pinned Paper image: connect, `list`,
whitelist add, `say` round-trip. It exists so a protocol or framing
regression in `RconClient` fails before production does.

### The wrapper contract check

`e2e:contract` runs the bot's **real** `serverAccess` against a **real**
api-wrapper process, and it exists because of one line in `serverAccess`:

```ts
return res.json() as Promise<T>; // pinned first-party contract
```

That cast is correct — the wrapper is first-party and versioned, not arbitrary
input — but it is a promise nothing checks. Rename a field on the wrapper and
the bot still compiles, the wrapper's own tests still pass, and a remote
instance quietly starts returning `undefined`. **Neither repo's suite can catch
that alone.** Same for the feature manifest and the script-action list: each
side can prove its own half is self-consistent, and only running them together
proves they agree.

The script boots the wrapper against a scaffolded instance directory and a
fake-but-real RCON responder on a real socket. Faking the wrapper's *upstream*
is fine here: the contract under test is wrapper → bot, so what sits behind the
wrapper only has to make it produce a genuine response. That keeps the check at
about ten seconds and free of Minecraft, which is why it can run on every PR
rather than nightly.

It runs from **both** repos' CI — the check lives here (it asserts this bot's
expectations), and the wrapper's `contract` workflow checks the bot out and
points it at itself. So a wrapper PR that drops something the bot needs fails
in the wrapper's PR, where it is cheap to fix.

A red build usually means the other repo needs to land its half first. That
ordering is the mechanism working, not a nuisance.

When you change a fixture, mirror the real artifact rather than guessing:
`downloaded_versions.json` keys its mods **by slug**, and the first version of
that fixture used an array — which the wrapper happily read as slugs `["0",
"1"]`. The check caught its own fixture, which is the correct outcome and a
good argument for scaffolding real shapes.

## Coverage expectations

Coverage is currently around 70% statements. There is no hard gate in CI, but the working rule is: new modules arrive with tests, and a PR should not lower coverage of the files it touches. The weakest spots today are Discord-heavy paths (pagination flows, channel provisioning); pure logic should be at or near full coverage because it is cheap to test.

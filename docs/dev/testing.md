# Testing

The project uses [vitest](https://vitest.dev). 48 test files with 600+ tests cover utilities, the RCON client, watchers, schedulers, and most commands. CI (GitHub Actions) runs typecheck, lint, and the full suite on every push and PR.

## Running tests

```bash
npm test               # full suite, single run
npm run test:watch     # watch mode while developing
npm run test:coverage  # adds a text + HTML coverage report (coverage/)
```

Run a single file or pattern:

```bash
npx vitest run tests/daily.test.ts
npx vitest run -t "streak"
```

## Layout and conventions

- All tests live in `tests/`, named `<area>.test.ts`. They are excluded from the production build (`tsconfig.json` excludes `tests`).
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

**ServerInstance** is mocked per test via `vi.mock("../src/utils/server.js", ...)` or by passing a stub object with `sendCommand`, `getList`, `isRunning` as `vi.fn()`. The layering exists precisely so this works without touching sockets.

**RconClient** is tested against an in-process mock socket; see `tests/rconClient.test.ts` for the packet encode/decode round trips.

**Filesystem state**: tests that exercise `loadJson`/`saveJson`, snapshots, or the log watcher create a temp directory (`fs.mkdtemp`) and point the code at it. Never write into the repo's real `data/`.

**Time**: use `vi.useFakeTimers()` plus `vi.setSystemTime()` for cooldowns, streak math, and schedulers. Restore with `vi.useRealTimers()` in `afterEach`.

**Module state**: several modules hold module-level caches (whitelist cache, stats TTL cache, link state). Use the exported invalidate/reset helpers (e.g. `_resetStateForTesting()` in the link command) or `vi.resetModules()` between tests so order does not matter.

## What a good test for this repo looks like

1. Arrange: temp dir or fake timers if state/time is involved, mocked server/interaction.
2. Act: call the exported function (commands export `execute`; pure logic like `calcStreak`, `flattenStats`, `parseListOutput` is exported directly so it can be tested without Discord).
3. Assert on observable behavior: what was replied, what command was sent to the server, what was written to disk. Avoid asserting internals.

When fixing a bug, write the failing test first and keep it as the regression guard. The existing B-xx fixes in the code each have one; follow that pattern.

## Coverage expectations

Coverage is currently around 70% statements. There is no hard gate in CI, but the working rule is: new modules arrive with tests, and a PR should not lower coverage of the files it touches. The weakest spots today are Discord-heavy paths (pagination flows, channel provisioning); pure logic should be at or near full coverage because it is cheap to test.

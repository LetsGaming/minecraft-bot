/**
 * Global test setup.
 *
 * 1. Point the SQLite store at an in-memory database so no test can ever
 *    write data/bot.db into the working tree. Suites exercising the
 *    DB-backed stores close the handle between tests (closeDbForTesting) —
 *    closing an in-memory database drops it, the cheapest per-test reset.
 *
 * 2. Probe the default driver (better-sqlite3). Where its native binding
 *    cannot load (no build toolchain), fall back to the node:sqlite
 *    driver so the suite still runs — the store code is driver-agnostic
 *    behind src/core/db/driver.ts. CI and normal dev machines exercise
 *    better-sqlite3.
 */
import { createRequire } from "module";

process.env.MCBOT_DB_PATH = ":memory:";

const require = createRequire(import.meta.url);
try {
  // v12 loads the native binding lazily at construction — a bare require
  // succeeds even without a compiled binding, so probe with a real open.
  const BetterSqlite3 = require("better-sqlite3") as new (p: string) => {
    close(): void;
  };
  new BetterSqlite3(":memory:").close();
} catch {
  process.env.MCBOT_SQLITE_DRIVER = "node";
  // eslint-disable-next-line no-console
  console.warn(
    "[tests/setup] better-sqlite3 binding unavailable in this environment — " +
      "running the suite on the node:sqlite driver instead.",
  );
}

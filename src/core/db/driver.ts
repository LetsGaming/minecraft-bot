/**
 * SQLite driver seam.
 *
 * The store code above this file speaks a four-method interface
 * (prepare/exec/close + statement run/get/all) that two drivers satisfy
 * identically — both are synchronous C-backed SQLite bindings with the
 * same SQL, the same transaction semantics, and the same parameter
 * binding:
 *
 *   better-sqlite3  (default)  The dependency this project ships. Mature,
 *                              fast, prebuilt for common platforms; on
 *                              Alpine/musl it compiles during `npm ci`
 *                              (the Dockerfile's dep stages carry the
 *                              toolchain).
 *   node:sqlite     (fallback) The built-in module, selected with
 *                              MCBOT_SQLITE_DRIVER=node. Zero native
 *                              build — the escape hatch for hosts without
 *                              a compiler toolchain. Requires Node >=
 *                              22.13 (stable in 24; harmless experimental
 *                              warning on 22.x).
 *
 * The seam is deliberately tiny (~40 lines of adapter): it exists so the
 * driver is a deployment detail, not an architecture decision — swapping
 * costs an env var, and the test suite runs against whichever driver the
 * environment can load.
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);

export interface SqlRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}

export type SqliteDriver = "better-sqlite3" | "node";

export function selectedDriver(): SqliteDriver {
  return process.env.MCBOT_SQLITE_DRIVER === "node" ? "node" : "better-sqlite3";
}

export function openDatabase(path: string): SqlDatabase {
  if (selectedDriver() === "node") {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (p: string) => SqlDatabase;
    };
    return new DatabaseSync(path);
  }

  // Note: v12 loads its native binding lazily — at construction, not at
  // require — so the constructor call must sit inside the same guard.
  try {
    const BetterSqlite3 = require("better-sqlite3") as new (
      p: string,
    ) => SqlDatabase;
    return new BetterSqlite3(path);
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(
      `better-sqlite3 failed to load (${msg}). ` +
        `Run "npm rebuild better-sqlite3" (needs python3/make/g++ on Alpine), ` +
        `or set MCBOT_SQLITE_DRIVER=node to use the built-in driver (Node >= 22.13).`,
    );
  }
}

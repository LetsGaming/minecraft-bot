/**
 * SQLite data layer — the store backend for machine-written state.
 *
 * Built on better-sqlite3 (synchronous C bindings) behind a tiny driver
 * seam (driver.ts) whose fallback is the built-in node:sqlite — same SQL,
 * same transaction semantics, selected per environment.
 *
 * Ownership rule (docs/dev/data-storage.md): human-authored, machine-read
 * data stays JSON (config.json, dailyRewards.json); machine-written state
 * lives here. The database file sits in data/ next to the remaining JSON
 * stores, inside the same bot_data volume.
 *
 * Concurrency model — why this exists at all:
 *   - WAL journal: the bot and the web-ui open the same file; readers
 *     never block the writer, and the single-writer lock is arbitrated by
 *     SQLite itself (busy_timeout absorbs the rare collision). This is
 *     what the per-process saveJson write chain could never provide.
 *   - withTransaction(): BEGIN IMMEDIATE makes the whole read-modify-write
 *     atomic, closing the lost-update window that existed both across
 *     processes (adminAudit) and within one (concurrent /link).
 *
 * Both processes call getDb() at startup; migrations and the one-time
 * legacy-JSON import run there, idempotently, so whichever process starts
 * first — or alone — has a current schema. Neither process ever requires
 * the other.
 */
import path from "path";
import { openDatabase, type SqlDatabase } from "./driver.js";
import { getRootDir } from "../utils/paths.js";
import { log } from "../utils/logger.js";
import { runMigrations } from "./migrations.js";
import { importLegacyJson } from "./importLegacy.js";

let _db: SqlDatabase | null = null;

/** Resolve the database path: env override (tests, exotic deployments) or data/bot.db. */
export function getDbPath(): string {
  return (
    process.env.MCBOT_DB_PATH ??
    path.resolve(getRootDir(), "data", "bot.db")
  );
}

/**
 * The process-wide database handle. First call opens the file, applies
 * pragmas, runs pending migrations, and imports legacy JSON stores.
 */
export function getDb(): SqlDatabase {
  if (_db) return _db;

  const dbPath = getDbPath();
  const db = openDatabase(dbPath);

  // WAL: multi-process safe, readers don't block the writer.
  db.exec("PRAGMA journal_mode = WAL");
  // NORMAL is durable enough under WAL (fsync on checkpoint) and much faster.
  db.exec("PRAGMA synchronous = NORMAL");
  // A colliding writer waits instead of failing (ms).
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  runMigrations(db);
  // Never import (and retire!) legacy JSON into an in-memory database:
  // the store is ephemeral, the renamed source files would not be — a
  // throwaway DB must not destroy real data. Tests run on ":memory:";
  // real deployments never do.
  if (dbPath !== ":memory:") {
    importLegacyJson(db);
  }

  _db = db;
  if (dbPath !== ":memory:") log.info("db", `SQLite store ready (${dbPath})`);
  return _db;
}

/**
 * Run fn atomically. BEGIN IMMEDIATE takes the write lock up front, so the
 * enclosed reads see a stable snapshot and the writes can't interleave with
 * another process — the read-modify-write is one unit or nothing.
 *
 * Not re-entrant by design: nesting indicates a store calling another
 * store mid-transaction, which is a layering smell we'd rather surface.
 */
let inTransaction = false;
export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  if (inTransaction) {
    throw new Error("withTransaction: nested transactions are not supported");
  }
  inTransaction = true;
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* connection-level failure — nothing left to roll back */
    }
    throw err;
  } finally {
    inTransaction = false;
  }
}

/**
 * Close and forget the singleton. Tests use this (with MCBOT_DB_PATH set
 * to ":memory:" or a temp file) to get a fresh database per suite.
 */
export function closeDbForTesting(): void {
  if (_db) {
    try {
      _db.close();
    } catch {
      /* already closed */
    }
    _db = null;
  }
  inTransaction = false;
}

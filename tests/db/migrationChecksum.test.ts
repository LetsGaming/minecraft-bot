/**
 * Migration checksum guard.
 *
 * "Append only, never edit a shipped migration" used to be documentation
 * only: an edited migration silently did nothing on databases that had
 * already applied it, leaving the schema and the code disagreeing. The
 * runner now records each migration's SQL checksum and refuses to start on
 * drift — and has to keep working against databases written before the
 * column existed.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { runMigrations } from "../../src/core/db/migrations.js";
import { openDatabase, type SqlDatabase } from "../../src/core/db/driver.js";
import { mapRows, mapRow, col } from "../../src/core/db/rows.js";

function freshDb(): SqlDatabase {
  const db = openDatabase(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

function checksums(db: SqlDatabase): Array<{ id: number; sum: string | null }> {
  return mapRows(
    db.prepare("SELECT id, checksum FROM schema_migrations ORDER BY id"),
    (r) => ({ id: col.int(r, "id"), sum: col.textOrNull(r, "checksum") }),
  );
}

describe("runMigrations checksums", () => {
  it("records a checksum for every applied migration", () => {
    const db = freshDb();
    runMigrations(db);

    const rows = checksums(db);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.sum).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it("is idempotent — a second run applies nothing and keeps checksums", () => {
    const db = freshDb();
    runMigrations(db);
    const before = checksums(db);

    expect(() => runMigrations(db)).not.toThrow();
    expect(checksums(db)).toEqual(before);
    db.close();
  });

  it("refuses to start when a shipped migration's SQL changed", () => {
    const db = freshDb();
    runMigrations(db);

    // Simulate an edited migration: the recorded checksum no longer
    // matches the SQL the code now carries.
    db.prepare("UPDATE schema_migrations SET checksum = ? WHERE id = 1").run(
      "0".repeat(64),
    );

    expect(() => runMigrations(db)).toThrow(/has changed since it was applied/);
    db.close();
  });

  it("adopts a baseline for rows applied before checksums were tracked", () => {
    const db = freshDb();
    runMigrations(db);

    // A pre-checksum database: rows exist, the column is NULL.
    db.exec("UPDATE schema_migrations SET checksum = NULL");

    expect(() => runMigrations(db)).not.toThrow();
    for (const r of checksums(db)) expect(r.sum).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it("adds the checksum column to a database that predates it", () => {
    const db = freshDb();
    // Exactly the old table shape, with migration 1 already recorded.
    db.exec(`
      CREATE TABLE schema_migrations (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    expect(() => runMigrations(db)).not.toThrow();

    const hasColumn = mapRows(db.prepare("PRAGMA table_info(schema_migrations)"), (r) =>
      col.text(r, "name"),
    );
    expect(hasColumn).toContain("checksum");

    // And the schema really was created, not just recorded.
    const table = mapRow(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_audit'",
      ),
      (r) => col.text(r, "name"),
    );
    expect(table).toBe("admin_audit");
    db.close();
  });
});

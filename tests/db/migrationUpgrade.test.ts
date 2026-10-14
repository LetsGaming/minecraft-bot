/**
 * Upgrade path for migration 6 (gzip snapshot payloads): a database created
 * before it, with plain-JSON snapshots and pre-checksum migration rows,
 * opens, gains payload_gz, and still reads its old snapshots.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { MIGRATIONS } from "../../src/core/db/migrations.js";
import { openDatabase } from "../../src/core/db/driver.js";
import { getDb, closeDbForTesting } from "../../src/core/db/index.js";
import { getSnapshotClosestTo } from "../../src/core/utils/minecraft/snapshotUtils.js";

const originalDbPath = process.env.MCBOT_DB_PATH;
let dir = "";

afterEach(() => {
  closeDbForTesting();
  process.env.MCBOT_DB_PATH = originalDbPath;
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

describe("migration 6 upgrade", () => {
  it("adds payload_gz and keeps old snapshots readable", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbot-upgrade-"));
    const file = path.join(dir, "bot.db");

    // A database as a 5-migration build left it, before checksums existed.
    const old = openDatabase(file);
    old.exec(`CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    for (const m of MIGRATIONS.filter((x) => x.id < 6)) {
      old.exec(m.sql);
      old.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(m.id, m.name, "then");
    }
    const payload = { version: 2, timestamp: 1_000, stats: { "uuid-1": { a: 1 } } };
    old.prepare("INSERT INTO snapshots (server_id, ts, payload) VALUES (?, ?, ?)").run("smp", 1_000, JSON.stringify(payload));
    old.close();

    process.env.MCBOT_DB_PATH = file;
    closeDbForTesting();
    const db = getDb();

    const cols = (db.prepare("PRAGMA table_info(snapshots)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("payload_gz");
    const ids = (db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    expect(ids).toEqual(MIGRATIONS.map((m) => m.id));

    expect(await getSnapshotClosestTo("smp", 2_000)).toEqual(payload);
  });
});

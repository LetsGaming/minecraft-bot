/**
 * Config rollback history (against the real in-memory DB, tests/setup.ts):
 * compact gzip snapshots, exact round-trip, newest-first ordering, and the
 * 3-day retention prune.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting, getDb } from "../../src/core/db/index.js";
import {
  snapshotConfig,
  listConfigHistory,
  getConfigSnapshot,
  RETENTION_DAYS,
} from "../../src/core/utils/config/configHistory.js";

beforeEach(() => closeDbForTesting());
afterEach(() => {
  process.env.MCBOT_DB_PATH = ":memory:";
  closeDbForTesting();
});

describe("configHistory", () => {
  it("snapshots a config and lists it with metadata", () => {
    snapshotConfig('{"token":"x"}', {
      byTag: "admin#1",
      byId: "111",
      note: "test",
    });
    const entries = listConfigHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      byTag: "admin#1",
      byId: "111",
      note: "test",
    });
    expect(entries[0]!.at).toBeTruthy();
    expect(entries[0]!.ts).toBeTypeOf("number");
  });

  it("round-trips the exact config JSON (compressed, then restored)", () => {
    const json =
      JSON.stringify(
        { token: "abc", servers: { s: { serverDir: "/x" } } },
        null,
        2,
      ) + "\n";
    snapshotConfig(json, {});
    const id = listConfigHistory()[0]!.id;
    expect(getConfigSnapshot(id)).toBe(json);
  });

  it("compresses the payload (BLOB smaller than the JSON for a real config)", () => {
    const json = JSON.stringify({ servers: {}, guilds: {} }).repeat(50);
    snapshotConfig(json, {});
    const id = listConfigHistory()[0]!.id;
    const row = getDb()
      .prepare("SELECT config_gz FROM config_history WHERE id = ?")
      .get(id) as { config_gz: Buffer | Uint8Array };
    expect(Buffer.from(row.config_gz).length).toBeLessThan(json.length);
  });

  it("returns null for a missing snapshot id", () => {
    expect(getConfigSnapshot(9999)).toBeNull();
  });

  it("lists newest first", () => {
    snapshotConfig('{"a":1}', { note: "first" });
    snapshotConfig('{"a":2}', { note: "second" });
    expect(listConfigHistory().map((e) => e.note)).toEqual([
      "second",
      "first",
    ]);
  });

  it(`prunes entries older than ${RETENTION_DAYS} days on the next write`, () => {
    const tooOld = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000 + 60_000);
    getDb()
      .prepare(
        `INSERT INTO config_history (ts, at, by_tag, by_id, note, config_gz)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(tooOld, "ancient", null, null, "ancient", Buffer.from([1, 2, 3]));
    expect(listConfigHistory()).toHaveLength(1);

    snapshotConfig('{"a":1}', { note: "fresh" }); // triggers the prune
    expect(listConfigHistory().map((e) => e.note)).toEqual(["fresh"]);
  });
});

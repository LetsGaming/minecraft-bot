/**
 * Snapshot store — table-backed (snapshots in data/bot.db) since v4.0.
 *
 * The read/cleanup contracts are unchanged from the file era: closest-
 * not-after baseline with oldest fallback, v2-only daily-diff baselines,
 * and the keep-newest / latest-per-day / 31-day retention policy.
 * migrateLegacySnapshots now IMPORTS the old snapshot files (both
 * layouts) into the table and retires the directory as
 * data/snapshots.imported — covered against a real temp tree.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { mkdir, rm, writeFile, readdir } from "fs/promises";
import path from "path";

// IMPORTANT: vi.mock is hoisted before const declarations, so the factory
// must use a plain string literal — not a variable — for getRootDir's return value.
const SNAP_ROOT = "/tmp/mc-bot-snap-test-" + process.pid;
const SERVER_ID = "survival";
const SNAPSHOTS_BASE = path.join(SNAP_ROOT, "data", "snapshots");

vi.mock("../src/core/utils/utils.js", () => ({
  // String literals inline — no TDZ risk
  getRootDir: () => "/tmp/mc-bot-snap-test-" + process.pid,
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

vi.mock("../src/core/utils/statUtils.js", () => ({
  loadAllStats: vi.fn().mockResolvedValue({}),
  flattenStats: vi.fn().mockReturnValue([]),
  LEADERBOARD_STATS: {},
  invalidateAllStatsCache: vi.fn(),
}));

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getSnapshotClosestTo,
  getSnapshotForDailyDiff,
  cleanupSnapshots,
  migrateLegacySnapshots,
} from "../src/core/utils/snapshotUtils.js";
import { getDb, closeDbForTesting } from "../src/core/db/index.js";
import type { SnapshotData } from "../src/core/types/index.js";

// ── helpers ────────────────────────────────────────────────────────────────

function insertSnapshot(
  timestamp: number,
  version = 2,
  withFlatStats = true,
  serverId = SERVER_ID,
  players: SnapshotData["players"] = { "uuid-1": { playtime: 1000 } },
): void {
  const data: SnapshotData = {
    version,
    timestamp,
    players,
    ...(withFlatStats
      ? {
          flatStats: {
            "uuid-1": { "minecraft:custom.minecraft:play_time": 1000 },
          },
        }
      : {}),
  };
  getDb()
    .prepare(
      "INSERT INTO snapshots (server_id, ts, payload) VALUES (?, ?, ?)",
    )
    .run(serverId, timestamp, JSON.stringify(data));
}

function listSnapshotTs(serverId = SERVER_ID): number[] {
  return (
    getDb()
      .prepare("SELECT ts FROM snapshots WHERE server_id = ? ORDER BY ts ASC")
      .all(serverId) as unknown as Array<{ ts: number }>
  ).map((r) => r.ts);
}

// ── lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  await mkdir(SNAPSHOTS_BASE, { recursive: true });
});

afterAll(async () => {
  await rm(SNAP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  closeDbForTesting(); // fresh in-memory DB per test
});

// ── getSnapshotClosestTo ───────────────────────────────────────────────────

describe("getSnapshotClosestTo", () => {
  it("returns null when no snapshots exist", async () => {
    expect(await getSnapshotClosestTo(SERVER_ID, Date.now())).toBeNull();
  });

  it("returns the only snapshot when there is exactly one", async () => {
    const ts = Date.now() - 1000;
    insertSnapshot(ts);
    const result = await getSnapshotClosestTo(SERVER_ID, Date.now());
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(ts);
  });

  it("returns the snapshot closest to but not after the target", async () => {
    const now = Date.now();
    insertSnapshot(now - 3000);
    insertSnapshot(now - 1000); // closer
    insertSnapshot(now + 5000); // after target — excluded

    const result = await getSnapshotClosestTo(SERVER_ID, now);
    expect(result!.timestamp).toBe(now - 1000);
  });

  it("falls back to the oldest when all snapshots are newer than target", async () => {
    const now = Date.now();
    const oldest = now + 1000;
    insertSnapshot(oldest);
    insertSnapshot(now + 2000);

    const result = await getSnapshotClosestTo(SERVER_ID, now - 10000);
    expect(result!.timestamp).toBe(oldest);
  });

  it("parses JSON and returns a full SnapshotData object", async () => {
    const ts = Date.now() - 500;
    insertSnapshot(ts);
    const result = await getSnapshotClosestTo(SERVER_ID, Date.now());
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("players");
    expect(result!.version).toBe(2);
  });
});

// ── getSnapshotForDailyDiff ────────────────────────────────────────────────

describe("getSnapshotForDailyDiff", () => {
  it("returns null when no snapshots exist", async () => {
    expect(await getSnapshotForDailyDiff(SERVER_ID, Date.now() - 86400_000)).toBeNull();
  });

  it("returns null when all snapshots are older than the target", async () => {
    const now = Date.now();
    insertSnapshot(now - 100_000);

    const result = await getSnapshotForDailyDiff(SERVER_ID, now - 1000);
    expect(result).toBeNull();
  });

  it("returns a v2 snapshot within the target window", async () => {
    const now = Date.now();
    const target = now - 86400_000;
    insertSnapshot(target + 1000, 2, true);

    const result = await getSnapshotForDailyDiff(SERVER_ID, target);
    expect(result).not.toBeNull();
    expect(result!.flatStats).toBeDefined();
  });

  it("skips snapshots without flatStats (v1 legacy format)", async () => {
    const now = Date.now();
    const target = now - 86400_000;
    insertSnapshot(target + 1000, 1, false);

    const result = await getSnapshotForDailyDiff(SERVER_ID, target);
    expect(result).toBeNull();
  });

  it("picks the oldest valid v2 snapshot within the window", async () => {
    const now = Date.now();
    const target = now - 86400_000;
    const ts1 = target + 1000;
    const ts2 = target + 10000;
    insertSnapshot(ts1, 2, true);
    insertSnapshot(ts2, 2, true);

    const result = await getSnapshotForDailyDiff(SERVER_ID, target);
    expect(result!.timestamp).toBe(ts1);
  });
});

// ── cleanupSnapshots ───────────────────────────────────────────────────────

describe("cleanupSnapshots", () => {
  it("does not throw when the table is empty", async () => {
    await expect(cleanupSnapshots(SERVER_ID)).resolves.toBeUndefined();
  });

  it("keeps the newest snapshot even if very old", async () => {
    const veryOld = Date.now() - 32 * 24 * 60 * 60 * 1000;
    insertSnapshot(veryOld);

    await cleanupSnapshots(SERVER_ID);

    expect(listSnapshotTs()).toHaveLength(1);
  });

  it("keeps recent snapshots untouched", async () => {
    const recent = Date.now() - 60_000;
    insertSnapshot(recent);

    await cleanupSnapshots(SERVER_ID);

    expect(listSnapshotTs()).toHaveLength(1);
  });

  it("keeps only the latest snapshot for days older than 24h", async () => {
    const dayStart = Date.now() - 2 * 24 * 60 * 60 * 1000;
    insertSnapshot(dayStart + 1000); // earlier on that day
    insertSnapshot(dayStart + 5000); // later — should win

    await cleanupSnapshots(SERVER_ID);

    expect(listSnapshotTs()).toEqual([dayStart + 5000]);
  });
});

// ── Per-server isolation ─────────────────────────────────────────────

describe("per-server snapshot isolation", () => {
  it("does not return another server's snapshot as a baseline", async () => {
    const now = Date.now();
    // Snapshot for "survival" (the default test server)
    insertSnapshot(now - 5000);

    // Snapshot for a second server at a closer timestamp
    insertSnapshot(now - 1000, 2, true, "creative", {
      "uuid-other": { playtime: 999 },
    });

    const result = await getSnapshotClosestTo(SERVER_ID, now);
    // Must be survival's snapshot — never the closer-in-time creative one
    expect(result?.players["uuid-1"]).toBeDefined();
    expect(result?.players["uuid-other"]).toBeUndefined();

    const other = await getSnapshotClosestTo("creative", now);
    expect(other?.players["uuid-other"]).toBeDefined();
    expect(other?.players["uuid-1"]).toBeUndefined();
  });
});

// ── Legacy migration ─────────────────────────────────────────────────

describe("migrateLegacySnapshots", () => {
  it("imports legacy snapshot files (both layouts) and retires the directory", async () => {
    // Ancient loose file (pre per-server directories) → first server.
    const looseTs = Date.now() - 12345;
    await writeFile(
      path.join(SNAPSHOTS_BASE, `${looseTs}.json`),
      JSON.stringify({
        version: 2,
        timestamp: looseTs,
        players: {},
        flatStats: {},
      }),
    );
    // Per-server layout → its own server id.
    const dirTs = Date.now() - 5000;
    await mkdir(path.join(SNAPSHOTS_BASE, "creative"), { recursive: true });
    await writeFile(
      path.join(SNAPSHOTS_BASE, "creative", `${dirTs}.json`),
      JSON.stringify({
        version: 2,
        timestamp: dirTs,
        players: {},
        flatStats: {},
      }),
    );

    await migrateLegacySnapshots(SERVER_ID);

    expect(listSnapshotTs()).toContain(looseTs);
    expect(listSnapshotTs("creative")).toContain(dirTs);

    // The directory was retired, not deleted.
    await expect(readdir(SNAPSHOTS_BASE)).rejects.toThrow();
    const retired = await readdir(
      path.join(SNAP_ROOT, "data", "snapshots.imported"),
    );
    expect(retired).toContain(`${looseTs}.json`);
    expect(retired).toContain("creative");
  });

  it("is a no-op when there is nothing to migrate", async () => {
    // The directory was renamed away by the previous test.
    await expect(migrateLegacySnapshots(SERVER_ID)).resolves.toBeUndefined();
    expect(listSnapshotTs()).toHaveLength(0);
  });
});

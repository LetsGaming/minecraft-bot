/**
 * Snapshot store — table-backed (snapshots in data/bot.db) since v4.0.
 *
 * The read contracts are unchanged from the file era: closest-not-after
 * baseline with oldest fallback, and v2-only daily-diff baselines.
 * Retention is a rolling window (full resolution for ~26h, one per day
 * beyond it, hard age cap sized from the longest board interval) — see
 * the retention block below for why that shape and not calendar days.
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

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: () => "/tmp/mc-bot-snap-test-" + process.pid,
}));

vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  loadAllStats: vi.fn().mockResolvedValue({}),
  flattenStats: vi.fn().mockReturnValue([]),
  LEADERBOARD_STATS: {},
  invalidateAllStatsCache: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getSnapshotClosestTo,
  getSnapshotForDailyDiff,
  cleanupSnapshots,
  migrateLegacySnapshots,
  takeSnapshot,
} from "../../src/core/utils/minecraft/snapshotUtils.js";
import { loadAllStats } from "../../src/core/utils/minecraft/statUtils.js";
import { log } from "../../src/core/utils/logger.js";
import { getDb, closeDbForTesting } from "../../src/core/db/index.js";
import type { SnapshotData } from "../../src/core/types/index.js";

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

  it("keeps only the latest snapshot for days older than the window", async () => {
    const dayStart = Date.now() - 2 * 24 * 60 * 60 * 1000;
    insertSnapshot(dayStart + 1000); // earlier on that day
    insertSnapshot(dayStart + 5000); // later — should win

    await cleanupSnapshots(SERVER_ID);

    expect(listSnapshotTs()).toEqual([dayStart + 5000]);
  });
});

// ── Retention ↔ baseline-lookup contract ─────────────────────────────
//
// Regression: cleanup used to thin a whole calendar day as soon as that
// day's *first* snapshot aged past 24h. Yesterday's 00:00 snapshot is
// always over 24h old, so yesterday always collapsed to a single entry —
// tearing a hole through the rolling window exactly where the daily
// baselines are looked up. The daily board then anchored 26–48h back
// (on a young server: the oldest snapshot there was, i.e. all-time
// totals) and /stats daily silently shrank its window to match.
//
// Retention only means something in terms of what the lookups can still
// find afterwards, so these assert the two together.

describe("retention keeps the baselines the boards look up", () => {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  /** 48 hourly snapshots, oldest first, ending one hour ago. */
  function insertHourlySnapshots(now: number): void {
    for (let h = 48; h >= 1; h--) insertSnapshot(now - h * HOUR);
  }

  it("never thins a snapshot inside the rolling 24h window", async () => {
    const now = Date.now();
    insertHourlySnapshots(now);

    await cleanupSnapshots(SERVER_ID);

    const kept = listSnapshotTs();
    for (let h = 24; h >= 1; h--) {
      expect(kept).toContain(now - h * HOUR);
    }
  });

  it("anchors a daily board 24h back, not further", async () => {
    const now = Date.now();
    insertHourlySnapshots(now);

    await cleanupSnapshots(SERVER_ID);

    // What the scheduler asks for on a daily board: the newest baseline
    // at or before the period start.
    const snap = await getSnapshotClosestTo(SERVER_ID, now - DAY);
    expect(snap!.timestamp).toBe(now - DAY);
  });

  it("gives /stats daily a full ~24h window", async () => {
    const now = Date.now();
    insertHourlySnapshots(now);

    await cleanupSnapshots(SERVER_ID);

    // The oldest baseline still inside the 24h window.
    const snap = await getSnapshotForDailyDiff(SERVER_ID, now - DAY);
    expect(snap!.timestamp).toBe(now - DAY);
  });

  it("still thins beyond the window so history stays bounded", async () => {
    const now = Date.now();
    insertHourlySnapshots(now);

    await cleanupSnapshots(SERVER_ID);

    // 48 hourly snapshots span three local days at most; past the
    // ~26h full-resolution window only one per day survives.
    const kept = listSnapshotTs();
    expect(kept.length).toBeLessThan(48);
    expect(kept.filter((ts) => ts < now - 26 * HOUR).length).toBeLessThanOrEqual(3);
  });

  it("keeps a baseline old enough for a monthly board", async () => {
    const now = Date.now();
    for (let d = 31; d >= 0; d--) insertSnapshot(now - d * DAY);

    await cleanupSnapshots(SERVER_ID);

    const snap = await getSnapshotClosestTo(SERVER_ID, now - 30 * DAY);
    expect(snap).not.toBeNull();
    expect(snap!.timestamp).toBeLessThanOrEqual(now - 30 * DAY);
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

// ── takeSnapshot never records an empty snapshot ──────────────────────────
// Found in production: a remote instance whose wrapper could not read the
// stats directory answered `{uuids: []}` with a 200, so loadAllStats
// returned {} and every hourly snapshot recorded zero players. Baselines
// are looked up by time and a missing player reads as zero
// (`baseline[uuid] ?? 0`), so one of those in the window makes a period
// board subtract nothing and report all-time totals as the period's gains.

describe("takeSnapshot refuses to record an empty snapshot", () => {
  const HOUR = 60 * 60 * 1000;

  function fakeServer() {
    return { id: SERVER_ID, config: { id: SERVER_ID } } as never;
  }

  function storedCount(): number {
    return (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM snapshots WHERE server_id = ?")
        .get(SERVER_ID) as { n: number }
    ).n;
  }

  beforeEach(() => {
    getDb().prepare("DELETE FROM snapshots WHERE server_id = ?").run(SERVER_ID);
    vi.mocked(log.warn).mockClear();
  });

  it("writes nothing when no player stats are readable", async () => {
    vi.mocked(loadAllStats).mockResolvedValue({});

    await takeSnapshot(fakeServer());

    expect(storedCount()).toBe(0);
  });

  it("says why, and names the likely cause", async () => {
    vi.mocked(loadAllStats).mockResolvedValue({});

    await takeSnapshot(fakeServer());

    expect(log.warn).toHaveBeenCalledTimes(1);
    const [tag, message] = vi.mocked(log.warn).mock.calls[0]!;
    expect(tag).toBe("snapshots");
    expect(message).toContain("zero baseline");
    expect(message).toContain("stats directory");
  });

  it("still records a snapshot when a player does have stats", async () => {
    vi.mocked(loadAllStats).mockResolvedValue({
      "069a79f4-44e9-4726-a5be-fca90e38aaf5": {} as never,
    });

    await takeSnapshot(fakeServer());

    expect(storedCount()).toBe(1);
  });

  it("leaves an existing baseline intact when a later read fails", async () => {
    // The dangerous sequence: a good snapshot, then stats become unreadable.
    // The good one must survive as the baseline; the empty read must not
    // land beside it and win the "closest to now-24h" lookup.
    const now = Date.now();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now - 24 * HOUR);
      vi.mocked(loadAllStats).mockResolvedValue({
        "069a79f4-44e9-4726-a5be-fca90e38aaf5": {} as never,
      });
      await takeSnapshot(fakeServer());

      vi.setSystemTime(now);
      vi.mocked(loadAllStats).mockResolvedValue({});
      await takeSnapshot(fakeServer());

      expect(storedCount()).toBe(1);
      const baseline = await getSnapshotClosestTo(SERVER_ID, now - 24 * HOUR);
      expect(baseline).not.toBeNull();
      expect(Object.keys(baseline!.players)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

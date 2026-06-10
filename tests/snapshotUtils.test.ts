import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdir, rm, writeFile, readdir } from "fs/promises";
import path from "path";

// IMPORTANT: vi.mock is hoisted before const declarations, so the factory
// must use a plain string literal — not a variable — for getRootDir's return value.
const SNAP_ROOT = "/tmp/mc-bot-snap-test-" + process.pid;
const SNAPSHOTS_DIR = SNAP_ROOT + "/data/snapshots";

vi.mock("../src/utils/utils.js", () => ({
  // String literals inline — no TDZ risk
  getRootDir: () => "/tmp/mc-bot-snap-test-" + process.pid,
  loadJson: vi.fn(),
  saveJson: vi.fn(),
}));

vi.mock("../src/utils/statUtils.js", () => ({
  loadAllStats: vi.fn().mockResolvedValue({}),
  flattenStats: vi.fn().mockReturnValue([]),
  LEADERBOARD_STATS: {},
  invalidateAllStatsCache: vi.fn(),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  getSnapshotClosestTo,
  getSnapshotForDailyDiff,
  cleanupSnapshots,
} from "../src/utils/snapshotUtils.js";
import type { SnapshotData } from "../src/types/index.js";

// ── helpers ────────────────────────────────────────────────────────────────

async function writeSnapshot(
  timestamp: number,
  version = 2,
  withFlatStats = true,
): Promise<void> {
  const data: SnapshotData = {
    version,
    timestamp,
    players: { "uuid-1": { playtime: 1000 } },
    ...(withFlatStats
      ? { flatStats: { "uuid-1": { "minecraft:custom.minecraft:play_time": 1000 } } }
      : {}),
  };
  await writeFile(
    path.join(SNAPSHOTS_DIR, `${timestamp}.json`),
    JSON.stringify(data),
  );
}

async function listSnapshotFiles(): Promise<string[]> {
  return readdir(SNAPSHOTS_DIR).catch(() => []);
}

// ── lifecycle ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  await mkdir(SNAPSHOTS_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(SNAP_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  const files = await listSnapshotFiles();
  await Promise.all(files.map((f) => rm(path.join(SNAPSHOTS_DIR, f), { force: true })));
});

// ── getSnapshotClosestTo ───────────────────────────────────────────────────

describe("getSnapshotClosestTo", () => {
  it("returns null when no snapshots exist", async () => {
    expect(await getSnapshotClosestTo(Date.now())).toBeNull();
  });

  it("returns the only snapshot when there is exactly one", async () => {
    const ts = Date.now() - 1000;
    await writeSnapshot(ts);
    const result = await getSnapshotClosestTo(Date.now());
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(ts);
  });

  it("returns the snapshot closest to but not after the target", async () => {
    const now = Date.now();
    await writeSnapshot(now - 3000);
    await writeSnapshot(now - 1000); // closer
    await writeSnapshot(now + 5000); // after target — excluded

    const result = await getSnapshotClosestTo(now);
    expect(result!.timestamp).toBe(now - 1000);
  });

  it("falls back to the oldest when all snapshots are newer than target", async () => {
    const now = Date.now();
    const oldest = now + 1000;
    await writeSnapshot(oldest);
    await writeSnapshot(now + 2000);

    const result = await getSnapshotClosestTo(now - 10000);
    expect(result!.timestamp).toBe(oldest);
  });

  it("parses JSON and returns a full SnapshotData object", async () => {
    const ts = Date.now() - 500;
    await writeSnapshot(ts);
    const result = await getSnapshotClosestTo(Date.now());
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("players");
    expect(result!.version).toBe(2);
  });
});

// ── getSnapshotForDailyDiff ────────────────────────────────────────────────

describe("getSnapshotForDailyDiff", () => {
  it("returns null when no snapshots exist", async () => {
    expect(await getSnapshotForDailyDiff(Date.now() - 86400_000)).toBeNull();
  });

  it("returns null when all snapshots are older than the target", async () => {
    const now = Date.now();
    await writeSnapshot(now - 100_000);

    const result = await getSnapshotForDailyDiff(now - 1000);
    expect(result).toBeNull();
  });

  it("returns a v2 snapshot within the target window", async () => {
    const now = Date.now();
    const target = now - 86400_000;
    await writeSnapshot(target + 1000, 2, true);

    const result = await getSnapshotForDailyDiff(target);
    expect(result).not.toBeNull();
    expect(result!.flatStats).toBeDefined();
  });

  it("skips snapshots without flatStats (v1 legacy format)", async () => {
    const now = Date.now();
    const target = now - 86400_000;
    await writeSnapshot(target + 1000, 1, false);

    const result = await getSnapshotForDailyDiff(target);
    expect(result).toBeNull();
  });

  it("picks the oldest valid v2 snapshot within the window", async () => {
    const now = Date.now();
    const target = now - 86400_000;
    const ts1 = target + 1000;
    const ts2 = target + 10000;
    await writeSnapshot(ts1, 2, true);
    await writeSnapshot(ts2, 2, true);

    const result = await getSnapshotForDailyDiff(target);
    expect(result!.timestamp).toBe(ts1);
  });
});

// ── cleanupSnapshots ───────────────────────────────────────────────────────

describe("cleanupSnapshots", () => {
  it("does not throw when directory is empty", async () => {
    await expect(cleanupSnapshots()).resolves.toBeUndefined();
  });

  it("keeps the newest snapshot even if very old (B-04 protection)", async () => {
    const veryOld = Date.now() - 32 * 24 * 60 * 60 * 1000;
    await writeSnapshot(veryOld);

    await cleanupSnapshots();

    const remaining = await listSnapshotFiles();
    expect(remaining).toHaveLength(1);
  });

  it("keeps recent snapshots untouched", async () => {
    const recent = Date.now() - 60_000;
    await writeSnapshot(recent);

    await cleanupSnapshots();

    const remaining = await listSnapshotFiles();
    expect(remaining).toHaveLength(1);
  });

  it("keeps only the latest snapshot for days older than 24h", async () => {
    const dayStart = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await writeSnapshot(dayStart + 1000); // earlier on that day
    await writeSnapshot(dayStart + 5000); // later — should win

    await cleanupSnapshots();

    const remaining = await listSnapshotFiles();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(`${dayStart + 5000}.json`);
  });
});

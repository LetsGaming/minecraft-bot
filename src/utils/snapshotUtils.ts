import path from "path";
import { promises as fsPromises } from "fs";
import { getRootDir } from "./utils.js";
import { formatDate } from "./time.js";
import {
  loadAllStats,
  flattenStats,
  LEADERBOARD_STATS,
  invalidateAllStatsCache,
} from "./statUtils.js";
import type { ServerInstance } from "./server.js";
import { log } from "./logger.js";
import type { SnapshotData } from "../types/index.js";

const SNAPSHOTS_DIR = path.resolve(getRootDir(), "data", "snapshots");
const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 days
const DAY_MS = 24 * 60 * 60 * 1000;

// NOTE: SnapshotData type lives in types/index.ts — extend it there with:
//   version?: number;
//   flatStats?: Record<string, Record<string, number>>;
// Both optional so legacy v1 snapshots still parse.
const SNAPSHOT_VERSION = 2;

/**
 * Extract only the leaderboard-relevant values from flattened stats.
 * Keeps the leaderboard hot-path independent of the full stats dump.
 */
function extractStatValues(
  flat: ReturnType<typeof flattenStats>,
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const [key, def] of Object.entries(LEADERBOARD_STATS)) {
    values[key] = def.extract(flat);
  }
  return values;
}

/**
 * Convert flattened stats array to a flat fullKey -> value map.
 * Used by the /stats daily diff to compare snapshots against current state.
 */
function flattenedToMap(
  flat: ReturnType<typeof flattenStats>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const s of flat) map[s.fullKey] = s.value;
  return map;
}

/**
 * Take a snapshot of all current player stats.
 * v2 format stores both the leaderboard values (small, hot path) and the
 * full flattened stat map (used for /stats daily diffs).
 */
export async function takeSnapshot(
  server?: ServerInstance,
): Promise<SnapshotData> {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const allStats = await loadAllStats(server);
  const players: Record<string, Record<string, number>> = {};
  const flatStats: Record<string, Record<string, number>> = {};

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const flat = flattenStats(statsFile);
    players[uuid] = extractStatValues(flat);
    flatStats[uuid] = flattenedToMap(flat);
  }

  const timestamp = Date.now();
  const filePath = path.join(SNAPSHOTS_DIR, `${timestamp}.json`);
  const payload: SnapshotData = {
    version: SNAPSHOT_VERSION,
    timestamp,
    players,
    flatStats,
  };
  await fsPromises.writeFile(filePath, JSON.stringify(payload));

  // Snapshot captures the current state — force fresh load on next leaderboard query
  invalidateAllStatsCache();

  log.info(
    "snapshots",
    `Snapshot taken (${Object.keys(players).length} players, v${SNAPSHOT_VERSION})`,
  );

  await cleanupSnapshots();

  return payload;
}

/**
 * Find and load the snapshot closest to (but not after) a target timestamp.
 * If all snapshots are newer than the target (e.g. bot just started and hasn't
 * been running for a full interval yet), falls back to the oldest available
 * snapshot so callers always get a meaningful baseline rather than nothing.
 * Returns null only if no snapshots exist at all.
 */
export async function getSnapshotClosestTo(
  targetTimestamp: number,
): Promise<SnapshotData | null> {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const files = await fsPromises.readdir(SNAPSHOTS_DIR);
  const timestamps = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseInt(f.replace(".json", ""), 10))
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) return null;

  let closest: number | null = null;
  for (const ts of timestamps) {
    if (ts <= targetTimestamp) closest = ts;
    else break;
  }

  // If every snapshot is newer than the target (bot hasn't been running for a
  // full interval yet), fall back to the oldest available snapshot so the
  // leaderboard shows a partial-period baseline rather than silently showing
  // all-time stats.
  if (closest === null) closest = timestamps[0]!;

  const filePath = path.join(SNAPSHOTS_DIR, `${closest}.json`);
  const raw = await fsPromises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as SnapshotData;
}

/**
 * Find the snapshot closest to (but not after) `targetTimestamp` that
 * actually contains full flattened stats (v2+). Skips legacy v1 snapshots
 * which only stored leaderboard values.
 *
 * Returns null if no v2 snapshot exists yet — caller should treat this as
 * "no baseline available, can't compute diff".
 */
export async function getSnapshotForDailyDiff(
  targetTimestamp: number,
): Promise<SnapshotData | null> {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const files = await fsPromises.readdir(SNAPSHOTS_DIR);
  const timestamps = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseInt(f.replace(".json", ""), 10))
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) return null;

  // Walk newest-to-oldest among snapshots <= target, return first v2 hit.
  // If none found at-or-before target, fall back to oldest v2 snapshot so
  // a freshly-upgraded bot still produces some output.
  const eligible = timestamps.filter((t) => t <= targetTimestamp);
  const candidates = eligible.length > 0 ? [...eligible].reverse() : timestamps;

  for (const ts of candidates) {
    const filePath = path.join(SNAPSHOTS_DIR, `${ts}.json`);
    try {
      const raw = await fsPromises.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as SnapshotData;
      if (data.flatStats && Object.keys(data.flatStats).length > 0) {
        return data;
      }
    } catch {
      // unreadable snapshot — skip
    }
  }

  return null;
}

interface SnapshotFileEntry {
  file: string;
  timestamp: number;
}

/**
 * Clean up old snapshots to avoid wasting storage.
 */
export async function cleanupSnapshots(): Promise<void> {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const files = await fsPromises.readdir(SNAPSHOTS_DIR);
  const entries: SnapshotFileEntry[] = files
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ file: f, timestamp: parseInt(f.replace(".json", ""), 10) }))
    .filter((e) => !isNaN(e.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (entries.length === 0) return;

  const now = Date.now();
  const oneDayAgo = now - DAY_MS;
  const maxAge = now - MAX_AGE_MS;

  // B-04: always keep the newest snapshot regardless of age so there is
  // always a baseline for leaderboard queries. Identify it up-front.
  const newestTimestamp = entries[entries.length - 1]!.timestamp;

  const byDay = new Map<string, SnapshotFileEntry[]>();
  for (const entry of entries) {
    const day = formatDate(entry.timestamp);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }

  let deleted = 0;

  for (const [, dayEntries] of byDay) {
    const toDelete: SnapshotFileEntry[] = [];

    for (const e of dayEntries) {
      // B-04: never delete the single newest snapshot even if it's past maxAge
      if (e.timestamp < maxAge && e.timestamp !== newestTimestamp)
        toDelete.push(e);
    }

    const remaining = dayEntries.filter((e) => e.timestamp >= maxAge);

    if (remaining.length > 1 && remaining[0]!.timestamp < oneDayAgo) {
      // Keep only the latest per day; but never delete the overall newest
      toDelete.push(
        ...remaining
          .slice(0, -1)
          .filter((e) => e.timestamp !== newestTimestamp),
      );
    }

    for (const e of toDelete) {
      await fsPromises.unlink(path.join(SNAPSHOTS_DIR, e.file)).catch(() => {});
      deleted++;
    }
  }

  if (deleted > 0) {
    log.info("snapshots", `Cleanup: removed ${deleted} old snapshot(s)`);
  }
}

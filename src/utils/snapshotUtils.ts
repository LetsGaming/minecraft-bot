import path from "path";
import { promises as fsPromises } from "fs";
import { getRootDir } from "./utils.js";
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

/**
 * Extract only the leaderboard-relevant values from flattened stats.
 * Keeps snapshots small regardless of how many total stats a player has.
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
 * Take a snapshot of all current player stats (leaderboard values only).
 * Saves to data/snapshots/{timestamp}.json and runs cleanup afterwards.
 */
export async function takeSnapshot(
  server?: ServerInstance,
): Promise<SnapshotData> {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const allStats = await loadAllStats(server);
  const players: Record<string, Record<string, number>> = {};

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const flat = flattenStats(statsFile);
    players[uuid] = extractStatValues(flat);
  }

  const timestamp = Date.now();
  const filePath = path.join(SNAPSHOTS_DIR, `${timestamp}.json`);
  await fsPromises.writeFile(filePath, JSON.stringify({ timestamp, players }));

  // Snapshot captures the current state — force fresh load on next leaderboard query
  invalidateAllStatsCache();

  log.info(
    "snapshots",
    `Snapshot taken (${Object.keys(players).length} players)`,
  );

  await cleanupSnapshots();

  return { timestamp, players };
}

/**
 * Find and load the snapshot closest to (but not after) a target timestamp.
 * Returns null if no snapshots exist at all.
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

  // If nothing before target, use the earliest available
  if (closest === null) closest = timestamps[0]!;

  const filePath = path.join(SNAPSHOTS_DIR, `${closest}.json`);
  const raw = await fsPromises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as SnapshotData;
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
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const maxAge = now - MAX_AGE_MS;

  const byDay = new Map<string, SnapshotFileEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.timestamp).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(entry);
  }

  let deleted = 0;

  for (const [, dayEntries] of byDay) {
    const toDelete: SnapshotFileEntry[] = [];

    for (const e of dayEntries) {
      if (e.timestamp < maxAge) toDelete.push(e);
    }

    const remaining = dayEntries.filter((e) => e.timestamp >= maxAge);

    if (remaining.length > 1 && remaining[0]!.timestamp < oneDayAgo) {
      toDelete.push(...remaining.slice(0, -1));
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

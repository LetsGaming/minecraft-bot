import path from "path";
import { promises as fsPromises } from "fs";
import { getRootDir } from "./utils.js";
import { loadAllStats, flattenStats, LEADERBOARD_STATS } from "./statUtils.js";
import { log } from "./logger.js";

const SNAPSHOTS_DIR = path.resolve(getRootDir(), "data", "snapshots");
const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 days

/**
 * Extract only the leaderboard-relevant values from flattened stats.
 * Keeps snapshots small regardless of how many total stats a player has.
 */
function extractStatValues(flat) {
  const values = {};
  for (const [key, def] of Object.entries(LEADERBOARD_STATS)) {
    values[key] = def.extract(flat);
  }
  return values;
}

/**
 * Take a snapshot of all current player stats (leaderboard values only).
 * Saves to data/snapshots/{timestamp}.json and runs cleanup afterwards.
 */
export async function takeSnapshot() {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const allStats = await loadAllStats();
  const players = {};

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const flat = flattenStats(statsFile);
    players[uuid] = extractStatValues(flat);
  }

  const timestamp = Date.now();
  const filePath = path.join(SNAPSHOTS_DIR, `${timestamp}.json`);
  await fsPromises.writeFile(filePath, JSON.stringify({ timestamp, players }));

  log.info("snapshots", `Snapshot taken (${Object.keys(players).length} players)`);

  await cleanupSnapshots();

  return { timestamp, players };
}

/**
 * Find and load the snapshot closest to (but not after) a target timestamp.
 * Returns null if no snapshots exist at all.
 */
export async function getSnapshotClosestTo(targetTimestamp) {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const files = await fsPromises.readdir(SNAPSHOTS_DIR);
  const timestamps = files
    .filter(f => f.endsWith(".json"))
    .map(f => parseInt(f.replace(".json", ""), 10))
    .filter(t => !isNaN(t))
    .sort((a, b) => a - b);

  if (timestamps.length === 0) return null;

  // Find the latest timestamp that is <= targetTimestamp
  let closest = null;
  for (const ts of timestamps) {
    if (ts <= targetTimestamp) closest = ts;
    else break;
  }

  // If nothing before target, use the earliest available
  if (closest === null) closest = timestamps[0];

  const filePath = path.join(SNAPSHOTS_DIR, `${closest}.json`);
  const raw = await fsPromises.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Clean up old snapshots to avoid wasting storage:
 * - Delete everything older than 31 days (nothing needs it).
 * - For days older than 24h, keep only one snapshot per day (the latest).
 * - Current day keeps full hourly resolution.
 */
export async function cleanupSnapshots() {
  await fsPromises.mkdir(SNAPSHOTS_DIR, { recursive: true });

  const files = await fsPromises.readdir(SNAPSHOTS_DIR);
  const entries = files
    .filter(f => f.endsWith(".json"))
    .map(f => ({ file: f, timestamp: parseInt(f.replace(".json", ""), 10) }))
    .filter(e => !isNaN(e.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (entries.length === 0) return;

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const maxAge = now - MAX_AGE_MS;

  // Group by UTC date
  const byDay = new Map();
  for (const entry of entries) {
    const day = new Date(entry.timestamp).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }

  let deleted = 0;

  for (const [, dayEntries] of byDay) {
    const toDelete = [];

    // Remove everything older than 31 days
    for (const e of dayEntries) {
      if (e.timestamp < maxAge) toDelete.push(e);
    }

    const remaining = dayEntries.filter(e => e.timestamp >= maxAge);

    // For completed days (older than 24h), keep only the latest snapshot
    if (remaining.length > 1 && remaining[0].timestamp < oneDayAgo) {
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

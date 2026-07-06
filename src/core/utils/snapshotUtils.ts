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
import { getDb, withTransaction } from "../db/index.js";
import type { ServerInstance } from "./server.js";
import { log } from "./logger.js";
import type { SnapshotData } from "../types/index.js";

// Snapshots live in the snapshots table keyed (server_id, ts) — the key
// the old per-server directories encoded in paths, and the one the
// original flat files got wrong across servers. Legacy snapshot FILES
// (both layouts) are imported once by migrateLegacySnapshots() below.
const SNAPSHOTS_BASE_DIR = path.resolve(getRootDir(), "data", "snapshots");

const MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 days
const DAY_MS = 24 * 60 * 60 * 1000;

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

function tsList(serverId: string): number[] {
  return (
    getDb()
      .prepare("SELECT ts FROM snapshots WHERE server_id = ? ORDER BY ts ASC")
      .all(serverId) as unknown as Array<{ ts: number }>
  ).map((r) => r.ts);
}

function loadPayload(serverId: string, ts: number): SnapshotData | null {
  const row = getDb()
    .prepare("SELECT payload FROM snapshots WHERE server_id = ? AND ts = ?")
    .get(serverId, ts) as { payload: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as SnapshotData;
  } catch {
    return null; // unreadable snapshot — treat like an unreadable file
  }
}

/**
 * Take a snapshot of all current player stats.
 * v2 format stores both the leaderboard values (small, hot path) and the
 * full flattened stat map (used for /stats daily diffs).
 */
export async function takeSnapshot(
  server: ServerInstance,
): Promise<SnapshotData> {
  const allStats = await loadAllStats(server);
  const players: Record<string, Record<string, number>> = {};
  const flatStats: Record<string, Record<string, number>> = {};

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const flat = flattenStats(statsFile);
    players[uuid] = extractStatValues(flat);
    flatStats[uuid] = flattenedToMap(flat);
  }

  const timestamp = Date.now();
  const payload: SnapshotData = {
    version: SNAPSHOT_VERSION,
    timestamp,
    players,
    flatStats,
  };
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO snapshots (server_id, ts, payload) VALUES (?, ?, ?)",
    )
    .run(server.id, timestamp, JSON.stringify(payload));

  // Snapshot captures the current state — force fresh load on next leaderboard query
  invalidateAllStatsCache();

  log.info(
    "snapshots",
    `Snapshot taken for ${server.id} (${Object.keys(players).length} players, v${SNAPSHOT_VERSION})`,
  );

  await cleanupSnapshots(server.id);

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
  serverId: string,
  targetTimestamp: number,
): Promise<SnapshotData | null> {
  const db = getDb();
  const hit = db
    .prepare(
      `SELECT ts FROM snapshots WHERE server_id = ? AND ts <= ?
       ORDER BY ts DESC LIMIT 1`,
    )
    .get(serverId, targetTimestamp) as { ts: number } | undefined;

  // If every snapshot is newer than the target (bot hasn't been running
  // for a full interval yet), fall back to the oldest available snapshot
  // so the leaderboard shows a partial-period baseline rather than
  // silently showing all-time stats.
  const fallback = hit
    ? undefined
    : (db
        .prepare(
          "SELECT ts FROM snapshots WHERE server_id = ? ORDER BY ts ASC LIMIT 1",
        )
        .get(serverId) as { ts: number } | undefined);

  const ts = hit?.ts ?? fallback?.ts;
  if (ts === undefined) return null;
  return loadPayload(serverId, ts);
}

/**
 * Find the oldest v2 snapshot whose timestamp is at or after
 * `targetTimestamp`. Skips legacy v1 snapshots which only stored
 * leaderboard values.
 *
 * The caller passes `now - 24h` as the target, so this returns the
 * longest baseline that is guaranteed to be <= 24h old. Picking an
 * older snapshot would silently extend the window past 24h, which is
 * not what users expect from a "daily" stat.
 *
 * If no v2 snapshot exists in the [target, now] window (e.g. the bot
 * just started and hasn't taken its first snapshot yet), returns null —
 * caller should treat this as "no baseline available, can't compute
 * diff".
 */
export async function getSnapshotForDailyDiff(
  serverId: string,
  targetTimestamp: number,
): Promise<SnapshotData | null> {
  // Walk snapshots oldest-first, skip anything older than the target
  // (those would push the window past 24h). First v2 hit wins — that's
  // the oldest baseline still inside the 24h window, giving the largest
  // valid period. Payloads load one at a time: a day of snapshots can be
  // megabytes, and the first candidate almost always wins.
  for (const ts of tsList(serverId)) {
    if (ts < targetTimestamp) continue;
    const data = loadPayload(serverId, ts);
    if (data?.flatStats && Object.keys(data.flatStats).length > 0) {
      return data;
    }
  }
  return null;
}

/**
 * Clean up old snapshots to avoid wasting storage. Retention policy is
 * unchanged from the file era: hard cap at MAX_AGE, thin to the latest
 * per day once a day is older than 24h, never delete the overall newest.
 */
export async function cleanupSnapshots(serverId: string): Promise<void> {
  const timestamps = tsList(serverId);
  if (timestamps.length === 0) return;

  const now = Date.now();
  const oneDayAgo = now - DAY_MS;
  const maxAge = now - MAX_AGE_MS;

  // Always keep the newest snapshot regardless of age so there is
  // always a baseline for leaderboard queries. Identify it up-front.
  const newestTimestamp = timestamps[timestamps.length - 1]!;

  const byDay = new Map<string, number[]>();
  for (const ts of timestamps) {
    const day = formatDate(ts);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(ts);
  }

  const toDelete: number[] = [];

  for (const [, dayTs] of byDay) {
    for (const ts of dayTs) {
      // Never delete the single newest snapshot even if it's past maxAge
      if (ts < maxAge && ts !== newestTimestamp) toDelete.push(ts);
    }

    const remaining = dayTs.filter((ts) => ts >= maxAge);

    if (remaining.length > 1 && remaining[0]! < oneDayAgo) {
      // Keep only the latest per day; but never delete the overall newest
      toDelete.push(
        ...remaining.slice(0, -1).filter((ts) => ts !== newestTimestamp),
      );
    }
  }

  if (toDelete.length === 0) return;

  withTransaction(() => {
    const del = getDb().prepare(
      "DELETE FROM snapshots WHERE server_id = ? AND ts = ?",
    );
    for (const ts of toDelete) del.run(serverId, ts);
  });

  log.info(
    "snapshots",
    `Cleanup (${serverId}): removed ${toDelete.length} old snapshot(s)`,
  );
}

/**
 * One-time import: move legacy snapshot FILES into the snapshots table —
 * both layouts, per-server directories (data/snapshots/<serverId>/<ts>.json)
 * and the ancient loose files (data/snapshots/<ts>.json, attributed to the
 * first configured server). The directory is then renamed to
 * data/snapshots.imported, same retire-don't-delete contract as every
 * other legacy import. Call once at startup, after initServers().
 */
export async function migrateLegacySnapshots(
  firstServerId: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fsPromises.readdir(SNAPSHOTS_BASE_DIR);
  } catch {
    return; // no snapshots dir — nothing to import
  }

  const ins = getDb().prepare(
    "INSERT OR IGNORE INTO snapshots (server_id, ts, payload) VALUES (?, ?, ?)",
  );

  let imported = 0;
  const importFile = async (
    serverId: string,
    filePath: string,
    ts: number,
  ): Promise<void> => {
    try {
      const raw = await fsPromises.readFile(filePath, "utf-8");
      JSON.parse(raw); // corrupt files are skipped, not imported
      ins.run(serverId, ts, raw);
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("snapshots", `Import skipped ${filePath}: ${msg}`);
    }
  };

  for (const entry of entries) {
    const full = path.join(SNAPSHOTS_BASE_DIR, entry);
    const looseMatch = /^(\d+)\.json$/.exec(entry);
    if (looseMatch) {
      await importFile(firstServerId, full, parseInt(looseMatch[1]!, 10));
      continue;
    }
    let stat;
    try {
      stat = await fsPromises.stat(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let files: string[];
    try {
      files = await fsPromises.readdir(full);
    } catch {
      continue;
    }
    for (const f of files) {
      const m = /^(\d+)\.json$/.exec(f);
      if (!m) continue;
      await importFile(entry, path.join(full, f), parseInt(m[1]!, 10));
    }
  }

  try {
    await fsPromises.rename(
      SNAPSHOTS_BASE_DIR,
      `${SNAPSHOTS_BASE_DIR}.imported`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("snapshots", `Could not retire snapshots dir: ${msg}`);
  }

  if (imported > 0) {
    log.info(
      "snapshots",
      `Imported ${imported} legacy snapshot file(s) into the snapshots table`,
    );
  }
}

import path from "path";
import { promises as fsPromises } from "fs";
import { getRootDir } from "../paths.js";
import { formatDate } from "../time.js";
import {
  loadAllStats,
  flattenStats,
  LEADERBOARD_STATS,
  invalidateAllStatsCache,
} from "./statUtils.js";
import { getDb, withTransaction } from "../../db/index.js";
import { mapRow, mapRows, col } from "../../db/rows.js";
import type { ServerInstance } from "../server/server.js";
import { log } from "../logger.js";
import type { SnapshotData } from "../../types/index.js";
import { LONGEST_LEADERBOARD_INTERVAL_MS } from "@mcbot/schema/stats.js";

// Snapshots live in the snapshots table keyed (server_id, ts) — the key
// the old per-server directories encoded in paths, and the one the
// original flat files got wrong across servers. Legacy snapshot FILES
// (both layouts) are imported once by migrateLegacySnapshots() below.
const SNAPSHOTS_BASE_DIR = path.resolve(getRootDir(), "data", "snapshots");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back every snapshot is kept, unthinned. The daily lookups need
 * granularity on both sides of the 24h boundary, so the window is a day
 * plus a margin that comfortably exceeds one snapshot interval.
 */
const FULL_RESOLUTION_MS = DAY_MS + 2 * 60 * 60 * 1000; // 26 h

/**
 * Hard age cap. Derived from the longest period a board can ask for, plus
 * a day for the once-per-day thinning granularity beyond the full-
 * resolution window, plus a day of slack — so a monthly baseline is never
 * evicted just before the board that needs it runs.
 */
const MAX_AGE_MS = LONGEST_LEADERBOARD_INTERVAL_MS + 2 * DAY_MS; // 32 days

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
  return mapRows(
    getDb().prepare(
      "SELECT ts FROM snapshots WHERE server_id = ? ORDER BY ts ASC",
    ),
    (r) => col.int(r, "ts"),
    serverId,
  );
}

function loadPayload(serverId: string, ts: number): SnapshotData | null {
  return mapRow(
    getDb().prepare(
      "SELECT payload FROM snapshots WHERE server_id = ? AND ts = ?",
    ),
    (r) => {
      try {
        return col.json<SnapshotData>(r, "payload");
      } catch {
        return null; // unreadable snapshot — treat like an unreadable file
      }
    },
    serverId,
    ts,
  );
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

  // An empty snapshot is not "nobody has stats" — it is indistinguishable
  // from "the stats could not be read", and recording it is worse than
  // recording nothing. Baselines are looked up by time and a missing player
  // reads as zero (statUtils: `baseline[uuid] ?? 0`), so one empty snapshot
  // in the window makes every period board subtract nothing and report
  // all-time totals as the period's gains — labelled as the period, which is
  // the part that makes it a lie.
  //
  // Skipping costs nothing: with no baseline the readers return null and the
  // callers say so, and a server nobody has played simply has no board yet.
  if (Object.keys(players).length === 0) {
    log.warn(
      "snapshots",
      `No player stats readable for ${server.id} — skipping this snapshot ` +
        `rather than recording an empty one, which would act as a zero ` +
        `baseline and make period leaderboards report all-time totals. ` +
        `Expected on a server nobody has played yet; otherwise the stats ` +
        `directory is unreadable (check the API wrapper's serverPath, the ` +
        `world's level-name, and read permissions on <world>/stats).`,
    );
    return payload;
  }

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
  const hit = mapRow(
    db.prepare(
      `SELECT ts FROM snapshots WHERE server_id = ? AND ts <= ?
       ORDER BY ts DESC LIMIT 1`,
    ),
    (r) => col.int(r, "ts"),
    serverId,
    targetTimestamp,
  );

  // If every snapshot is newer than the target (bot hasn't been running
  // for a full interval yet), fall back to the oldest available snapshot
  // so the leaderboard shows a partial-period baseline rather than
  // silently showing all-time stats.
  const fallback =
    hit !== null
      ? null
      : mapRow(
          db.prepare(
            "SELECT ts FROM snapshots WHERE server_id = ? ORDER BY ts ASC LIMIT 1",
          ),
          (r) => col.int(r, "ts"),
          serverId,
        );

  const ts = hit ?? fallback;
  if (ts === null) return null;
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
 * Clean up old snapshots to avoid wasting storage.
 *
 * Retention is defined by what the baseline lookups above actually need,
 * because a period is only meaningful if the snapshot that anchors it
 * still exists:
 *
 *   1. Full resolution inside FULL_RESOLUTION_MS. Both daily lookups need
 *      snapshot-interval granularity right up to the 24h boundary:
 *      getSnapshotClosestTo wants the newest snapshot just *outside* it,
 *      getSnapshotForDailyDiff the oldest just *inside*. Nothing in this
 *      window is ever thinned.
 *   2. One per local day beyond it, which is all the weekly and monthly
 *      boards need — their baseline lands within a day of the boundary.
 *   3. Nothing past MAX_AGE_MS at all.
 *   4. The newest snapshot always survives, whatever its age, so a board
 *      on a long-idle server still has a baseline.
 *
 * This replaces a calendar-day rule that thinned a whole day the moment
 * that day's *first* snapshot aged past 24h. Since yesterday's 00:00
 * snapshot is over 24h old at any time after midnight, yesterday always
 * collapsed to its last snapshot — punching a hole through the rolling
 * window right where every daily baseline is looked up. The daily board
 * then anchored on a 26–48h-old snapshot (on a young server: the oldest
 * one there was, i.e. effectively all-time), and /stats daily silently
 * shortened its window to whatever survived.
 */
export async function cleanupSnapshots(serverId: string): Promise<void> {
  const timestamps = tsList(serverId);
  if (timestamps.length === 0) return;

  const now = Date.now();
  const fullResolutionCutoff = now - FULL_RESOLUTION_MS;
  const maxAge = now - MAX_AGE_MS;
  const newestTimestamp = timestamps[timestamps.length - 1]!;

  const toDelete = new Set<number>();

  // Past the full-resolution window, keep only the newest snapshot per
  // local day. tsList is ASC, so the last write per day key wins.
  const thinnable = timestamps.filter((ts) => ts < fullResolutionCutoff);
  const keepPerDay = new Map<string, number>();
  for (const ts of thinnable) keepPerDay.set(formatDate(ts), ts);
  const dailySurvivors = new Set(keepPerDay.values());
  for (const ts of thinnable) {
    if (!dailySurvivors.has(ts)) toDelete.add(ts);
  }

  // Hard age cap, applied to every snapshot regardless of the above.
  for (const ts of timestamps) {
    if (ts < maxAge) toDelete.add(ts);
  }

  // The newest snapshot is always a usable baseline — never drop it.
  toDelete.delete(newestTimestamp);

  if (toDelete.size === 0) return;

  withTransaction(() => {
    const del = getDb().prepare(
      "DELETE FROM snapshots WHERE server_id = ? AND ts = ?",
    );
    for (const ts of toDelete) del.run(serverId, ts);
  });

  log.info(
    "snapshots",
    `Cleanup (${serverId}): removed ${toDelete.size} old snapshot(s)`,
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

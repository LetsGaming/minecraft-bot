/**
 * Uptime checks: single owner of the uptime_checks table. The downtime
 * monitor records one row per polling cycle; `/status`, `/uptime` and the
 * dashboard read 24 h / 7 d / 30 d windows, the current state and an hourly
 * sparkline from it.
 */
import { getDb, withTransaction } from "../../db/index.js";
import { mapRow, mapRows, col } from "../../db/rows.js";
import {
  ANALYTICS_CAP_HOURS,
  ANALYTICS_RETENTION_DAYS,
} from "@mcbot/schema/analytics.js";
import { MS } from "@mcbot/schema/time.js";
import type { UptimeStats } from "../../types/index.js";
import { renderSparkline } from "../sparkline.js";

export type { UptimeStats };

/** Checks older than this are deleted; the /uptime "last 30 days" row depends on it. */
const RETENTION_MS = ANALYTICS_RETENTION_DAYS.uptime * MS.day;

/**
 * Row cap per server, only a safety net against a runaway caller: the
 * guarantee is the time window above, and two checks per minute over it
 * is already twice what the monitor writes.
 */
const MAX_ROWS_PER_SERVER = ANALYTICS_RETENTION_DAYS.uptime * 24 * 60 * 2;

const SPARKLINE_HOURS = 24;

interface CheckEntry {
  /** Unix timestamp in ms */
  t: number;
  /** 1 = online, 0 = offline */
  up: number;
}

/**
 * Record a single uptime check result: one INSERT plus a retention trim,
 * atomically. Called from the downtime monitor on each polling cycle.
 */
export async function recordCheck(
  serverId: string,
  online: boolean,
): Promise<void> {
  const now = Date.now();
  withTransaction(() => {
    const db = getDb();
    db.prepare(
      "INSERT INTO uptime_checks (server_id, t, up) VALUES (?, ?, ?)",
    ).run(serverId, now, online ? 1 : 0);
    db.prepare(
      "DELETE FROM uptime_checks WHERE server_id = ? AND t < ?",
    ).run(serverId, now - RETENTION_MS);
    db.prepare(
      `DELETE FROM uptime_checks WHERE server_id = ? AND id IN (
         SELECT id FROM uptime_checks WHERE server_id = ?
         ORDER BY t DESC LIMIT -1 OFFSET ?)`,
    ).run(serverId, serverId, MAX_ROWS_PER_SERVER);
  });
}

/** Writes are immediate, so there is nothing to flush; kept for the shutdown path. */
export async function flushUptimeHistory(): Promise<void> {
  /* no-op */
}

/**
 * Render an hourly sparkline from raw check entries.
 * Buckets the last `hours` hours (oldest first); each bucket becomes one
 * block character scaled by its uptime percentage, or "·" when the bucket
 * contains no checks (bot offline / outside the retention window).
 * Exported for tests.
 */
export function buildSparkline(
  entries: ReadonlyArray<{ t: number; up: number }>,
  now: number,
  hours = SPARKLINE_HOURS,
): string {
  const start = now - hours * MS.hour;

  const total = new Array<number>(hours).fill(0);
  const online = new Array<number>(hours).fill(0);
  for (const e of entries) {
    if (e.t < start || e.t > now) continue;
    const bucket = Math.min(hours - 1, Math.floor((e.t - start) / MS.hour));
    total[bucket]!++;
    online[bucket]! += e.up;
  }

  return renderSparkline(
    total.map((count, i) => (count === 0 ? null : online[i]! / count)),
  );
}

/**
 * When the most recent online period began: the first online check after
 * the last offline check that precedes the latest online check. Null when
 * the server was never seen online.
 */
export function lastOnlineStreakStart(serverId: string): number | null {
  return mapRow(
    getDb().prepare(
      `SELECT MIN(t) AS t FROM uptime_checks
       WHERE server_id = ? AND up = 1 AND t > COALESCE((
         SELECT MAX(t) FROM uptime_checks
         WHERE server_id = ? AND up = 0 AND t < (
           SELECT MAX(t) FROM uptime_checks WHERE server_id = ? AND up = 1
         )
       ), -1)`,
    ),
    (r) => col.intOrNull(r, "t"),
    serverId,
    serverId,
    serverId,
  );
}

/** When the current offline period began: the first offline check after the last online one. */
function offlineStreakStart(serverId: string): number | null {
  return mapRow(
    getDb().prepare(
      `SELECT MIN(t) AS t FROM uptime_checks
       WHERE server_id = ? AND up = 0 AND t > COALESCE((
         SELECT MAX(t) FROM uptime_checks WHERE server_id = ? AND up = 1
       ), -1)`,
    ),
    (r) => col.intOrNull(r, "t"),
    serverId,
    serverId,
  );
}

export interface UptimeStatsOptions {
  /** Also compute uptime over this many hours, clamped to the retained history. */
  rangeHours?: number;
}

/** Uptime over the last `hours` hours, aggregated in SQL. */
function uptimeSince(
  serverId: string,
  now: number,
  hours: number,
): { total: number; online: number } {
  const counts = mapRow(
    getDb().prepare(
      "SELECT COUNT(*) AS total, COALESCE(SUM(up), 0) AS online FROM uptime_checks WHERE server_id = ? AND t >= ?",
    ),
    (r) => ({ total: col.int(r, "total"), online: col.int(r, "online") }),
    serverId,
    now - hours * MS.hour,
  );
  return counts ?? { total: 0, online: 0 };
}

const pct = (c: { total: number; online: number }): number | null =>
  c.total > 0 ? Math.round((c.online / c.total) * 10000) / 100 : null;

export async function getUptimeStats(
  serverId: string,
  options: UptimeStatsOptions = {},
): Promise<UptimeStats> {
  const now = Date.now();

  const checks24h = uptimeSince(serverId, now, 24);
  const checks7d = uptimeSince(serverId, now, 7 * 24);
  const checks30d = uptimeSince(serverId, now, 30 * 24);

  const recent = mapRows(
    getDb().prepare(
      "SELECT t, up FROM uptime_checks WHERE server_id = ? AND t >= ? ORDER BY t ASC",
    ),
    (r): CheckEntry => ({ t: col.int(r, "t"), up: col.int(r, "up") }),
    serverId,
    now - SPARKLINE_HOURS * MS.hour,
  );

  const last = mapRow(
    getDb().prepare(
      "SELECT t, up FROM uptime_checks WHERE server_id = ? ORDER BY t DESC LIMIT 1",
    ),
    (r): CheckEntry => ({ t: col.int(r, "t"), up: col.int(r, "up") }),
    serverId,
  );

  let currentState: "online" | "offline" | "unknown" = "unknown";
  let currentStateDuration = 0;
  if (last) {
    currentState = last.up ? "online" : "offline";
    const since = last.up
      ? lastOnlineStreakStart(serverId)
      : offlineStreakStart(serverId);
    currentStateDuration = now - (since ?? last.t);
  }

  let range: UptimeStats["range"];
  if (options.rangeHours !== undefined) {
    const rangeHours = Math.min(
      Math.max(1, Math.floor(options.rangeHours)),
      ANALYTICS_CAP_HOURS.uptime,
    );
    const checks = uptimeSince(serverId, now, rangeHours);
    range = { rangeHours, pct: pct(checks), checks };
  }

  return {
    pct24h: pct(checks24h),
    pct7d: pct(checks7d),
    pct30d: pct(checks30d),
    checks24h,
    checks7d,
    checks30d,
    currentState,
    currentStateDuration,
    sparkline24h: buildSparkline(recent, now),
    ...(range ? { range } : {}),
  };
}

import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";
import { log } from "./logger.js";
import type { UptimeStats } from "../types/index.js";

export type { UptimeStats };

const STATE_PATH = path.resolve(getRootDir(), "data", "uptimeHistory.json");

/**
 * Maximum number of check entries to retain per server.
 * H-06: the /uptime command displays a "Last 30 days" figure, so retention
 * must cover 30 days (43,200 checks at one per minute). The old cap of
 * 10,080 (~7 days) silently turned the 30d row into a 7d number. At ~20
 * bytes/entry this is ~860 KB per server in uptimeHistory.json.
 */
const MAX_ENTRIES = 43_200;

interface CheckEntry {
  /** Unix timestamp in ms */
  t: number;
  /** 1 = online, 0 = offline */
  up: number;
}

interface UptimeHistory {
  [serverId: string]: CheckEntry[];
}

let history: UptimeHistory | null = null;
let dirty = false;

async function load(): Promise<UptimeHistory> {
  if (history) return history;
  const data = await loadJson(STATE_PATH).catch(() => ({}));
  history = (data as UptimeHistory) || {};
  return history;
}

async function persist(): Promise<void> {
  if (!dirty || !history) return;
  await saveJson(STATE_PATH, history);
  dirty = false;
}

/**
 * Record a single uptime check result.
 * Called from the downtime monitor on each polling cycle.
 */
export async function recordCheck(
  serverId: string,
  online: boolean,
): Promise<void> {
  const h = await load();
  if (!h[serverId]) h[serverId] = [];

  const entries = h[serverId]!;
  entries.push({ t: Date.now(), up: online ? 1 : 0 });

  // Trim to max length
  if (entries.length > MAX_ENTRIES) {
    h[serverId] = entries.slice(-MAX_ENTRIES);
  }

  dirty = true;
}

/**
 * Flush pending changes to disk.
 * Call this periodically (e.g. every 5 minutes) rather than on every check
 * to avoid excessive disk writes.
 */
export async function flushUptimeHistory(): Promise<void> {
  await persist();
}


/**
 * Compute uptime statistics for a server over 24h / 7d / 30d windows.
 */
/**
 * F-06: render an hourly sparkline from raw check entries.
 * Buckets the last `hours` hours (oldest first); each bucket becomes one
 * block character scaled by its uptime percentage, or "·" when the bucket
 * contains no checks (bot offline / before H-06's retention window).
 * Exported for tests.
 */
export function buildSparkline(
  entries: ReadonlyArray<{ t: number; up: number }>,
  now: number,
  hours = 24,
): string {
  const HOUR = 60 * 60 * 1000;
  const LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const start = now - hours * HOUR;

  const total = new Array<number>(hours).fill(0);
  const online = new Array<number>(hours).fill(0);
  for (const e of entries) {
    if (e.t < start || e.t > now) continue;
    const bucket = Math.min(hours - 1, Math.floor((e.t - start) / HOUR));
    total[bucket]!++;
    online[bucket]! += e.up;
  }

  let out = "";
  for (let i = 0; i < hours; i++) {
    if (total[i] === 0) {
      out += "·";
      continue;
    }
    const pct = online[i]! / total[i]!;
    out += LEVELS[Math.round(pct * (LEVELS.length - 1))]!;
  }
  return out;
}

export async function getUptimeStats(serverId: string): Promise<UptimeStats> {
  const h = await load();
  const entries = h[serverId] ?? [];

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  function calcWindow(windowMs: number): { total: number; online: number } {
    const cutoff = now - windowMs;
    let total = 0;
    let online = 0;
    for (const e of entries) {
      if (e.t >= cutoff) {
        total++;
        online += e.up;
      }
    }
    return { total, online };
  }

  const checks24h = calcWindow(1 * DAY);
  const checks7d = calcWindow(7 * DAY);
  const checks30d = calcWindow(30 * DAY);

  const pct = (c: { total: number; online: number }) =>
    c.total > 0 ? Math.round((c.online / c.total) * 10000) / 100 : null;

  // Current state and duration
  let currentState: "online" | "offline" | "unknown" = "unknown";
  let currentStateDuration = 0;

  if (entries.length > 0) {
    const last = entries[entries.length - 1]!;
    currentState = last.up ? "online" : "offline";
    currentStateDuration = now - last.t;

    // Walk backwards to find how long we've been in this state
    for (let i = entries.length - 2; i >= 0; i--) {
      if (entries[i]!.up !== last.up) {
        currentStateDuration = now - entries[i + 1]!.t;
        break;
      }
      if (i === 0) {
        currentStateDuration = now - entries[0]!.t;
      }
    }
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
    sparkline24h: buildSparkline(entries, now),
  };
}

/**
 * Start the periodic flush scheduler (every 5 minutes).
 * Call this explicitly at startup rather than relying on module-level side effects.
 * The timer is unref'd so it won't prevent a clean process exit.
 */
export function startUptimeFlushScheduler(): ReturnType<typeof setInterval> {
  const timer = setInterval(
    () => {
      flushUptimeHistory().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("uptime", `Failed to flush history: ${msg}`);
      });
    },
    5 * 60 * 1000,
  );
  timer.unref();
  return timer;
}

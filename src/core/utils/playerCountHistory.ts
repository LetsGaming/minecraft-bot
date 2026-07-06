/**
 * Player-count history — a compact per-hour series answering "when is the
 * server busy". Single owner of the player_count_hours table.
 *
 * Storage: one aggregate per server per hour bucket
 *
 *   { "version": 1, "servers": { "<id>": [{ "h": epochMs, "sum": n,
 *     "max": n, "samples": n }] } }
 *
 * where `h` is the bucket's hour start. Samples come for free from the
 * status pass when it runs (60 s cadence); deployments without the status
 * embed or presence get a standalone 5-minute sampler that no-ops while
 * fresh samples keep arriving from elsewhere.
 *
 * Retention is RETENTION_HOURS buckets per server (14 days), enough for a
 * stable hour-of-day average without the file growing forever.
 */
import { getDb, withTransaction } from "../db/index.js";
import { log } from "./logger.js";
import { TZ } from "./time.js";
import type { ServerInstance } from "./server.js";

export const RETENTION_HOURS = 14 * 24;
const SAMPLER_INTERVAL_MS = 5 * 60_000;
/** The standalone sampler stands down while other samples are fresher. */
const FRESH_SAMPLE_MS = 4 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface HourBucket {
  /** Bucket start (epoch ms, aligned to the hour). */
  h: number;
  /** Sum of sampled online counts (avg = sum / samples). */
  sum: number;
  max: number;
  samples: number;
}

export interface PlayerCountStore {
  version: 1;
  servers: Record<string, HourBucket[]>;
}

export async function loadPlayerCountStore(): Promise<PlayerCountStore> {
  const rows = getDb()
    .prepare(
      "SELECT server_id, h, sum, max, samples FROM player_count_hours ORDER BY h ASC",
    )
    .all() as unknown as Array<{
    server_id: string;
    h: number;
    sum: number;
    max: number;
    samples: number;
  }>;
  const servers: Record<string, HourBucket[]> = {};
  for (const r of rows) {
    (servers[r.server_id] ??= []).push({
      h: r.h,
      sum: r.sum,
      max: r.max,
      samples: r.samples,
    });
  }
  return { version: 1, servers };
}

export async function savePlayerCountStore(
  store: PlayerCountStore,
): Promise<void> {
  withTransaction(() => {
    const db = getDb();
    db.exec("DELETE FROM player_count_hours");
    const ins = db.prepare(
      "INSERT INTO player_count_hours (server_id, h, sum, max, samples) VALUES (?, ?, ?, ?, ?)",
    );
    for (const [serverId, buckets] of Object.entries(store.servers)) {
      for (const b of buckets) ins.run(serverId, b.h, b.sum, b.max, b.samples);
    }
  });
}

/** serverId → epoch ms of the last recorded sample (any source). */
const lastSampleAt = new Map<string, number>();

/** Exposed for tests. */
export function _resetSamplerStateForTesting(): void {
  lastSampleAt.clear();
}

/**
 * Record one online-count sample into the server's current hour bucket.
 * Called from the status pass (free ride) and the standalone sampler.
 */
export async function recordPlayerCountSample(
  serverId: string,
  online: number,
): Promise<void> {
  const now = Date.now();
  lastSampleAt.set(serverId, now);

  const store = await loadPlayerCountStore();
  const series = (store.servers[serverId] ??= []);
  const bucketStart = Math.floor(now / HOUR_MS) * HOUR_MS;

  const last = series[series.length - 1];
  if (last && last.h === bucketStart) {
    last.sum += online;
    last.max = Math.max(last.max, online);
    last.samples += 1;
  } else {
    series.push({ h: bucketStart, sum: online, max: online, samples: 1 });
    if (series.length > RETENTION_HOURS) {
      store.servers[serverId] = series.slice(-RETENTION_HOURS);
    }
  }
  await savePlayerCountStore(store);
}

/**
 * Standalone sampler for deployments where the status pass is off. Skips
 * a server when a fresh sample already arrived from elsewhere, so counts
 * are never double-recorded.
 */
export function startPlayerCountSampler(
  getServers: () => ServerInstance[],
): ReturnType<typeof setInterval> {
  const timer = setInterval(async () => {
    for (const server of getServers()) {
      const last = lastSampleAt.get(server.id) ?? 0;
      if (Date.now() - last < FRESH_SAMPLE_MS) continue;
      try {
        if (!(await server.isRunning())) continue;
        const list = await server.getList();
        const online = parseInt(String(list.playerCount), 10) || 0;
        await recordPlayerCountSample(server.id, online);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn("activity", `Sample failed for ${server.id}: ${msg}`);
      }
    }
  }, SAMPLER_INTERVAL_MS);
  return timer;
}

// ── Read side ─────────────────────────────────────────────────────────────

/** Hourly sparkline of average players over the last `hours` hours. */
export function buildActivitySparkline(
  series: ReadonlyArray<HourBucket>,
  now: number,
  hours = 24,
): { line: string; peak: number } {
  const LEVELS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const start = Math.floor((now - (hours - 1) * HOUR_MS) / HOUR_MS) * HOUR_MS;

  const byHour = new Map(series.map((b) => [b.h, b] as const));
  const avgs: Array<number | null> = [];
  let peak = 0;
  for (let i = 0; i < hours; i++) {
    const bucket = byHour.get(start + i * HOUR_MS);
    if (!bucket || bucket.samples === 0) {
      avgs.push(null);
      continue;
    }
    const avg = bucket.sum / bucket.samples;
    peak = Math.max(peak, bucket.max);
    avgs.push(avg);
  }

  const scale = Math.max(peak, 1);
  const line = avgs
    .map((a) =>
      a === null
        ? "·"
        : LEVELS[Math.min(LEVELS.length - 1, Math.round((a / scale) * (LEVELS.length - 1)))]!,
    )
    .join("");
  return { line, peak };
}

export interface BusyHour {
  /** Local hour of day (0–23) in the configured TZ. */
  hour: number;
  avg: number;
}

/** Local hour of day for an epoch, respecting the configured TZ. */
function localHour(epochMs: number): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(epochMs)),
  );
}

/**
 * The busiest local hours of day, averaged over the whole retained
 * series. Buckets without samples don't count against an hour.
 */
export function busiestHours(
  series: ReadonlyArray<HourBucket>,
  top = 3,
): BusyHour[] {
  const sums = new Array<number>(24).fill(0);
  const counts = new Array<number>(24).fill(0);
  for (const b of series) {
    if (b.samples === 0) continue;
    const hour = localHour(b.h);
    sums[hour]! += b.sum / b.samples;
    counts[hour]! += 1;
  }
  const rows: BusyHour[] = [];
  for (let hour = 0; hour < 24; hour++) {
    if (counts[hour] === 0) continue;
    rows.push({ hour, avg: sums[hour]! / counts[hour]! });
  }
  return rows.sort((a, b) => b.avg - a.avg).slice(0, top);
}

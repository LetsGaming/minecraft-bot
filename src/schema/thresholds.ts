/**
 * Health cutoffs for TPS and disk fullness, shared by the dashboard's chips
 * and meters and the bot's embeds and alerts.
 *
 * Isomorphic: no Node imports.
 */

export type HealthLevel = "ok" | "warn" | "critical";

/** TPS at or above `ok` is healthy, at or above `warn` degraded, below it critical. */
export const TPS_LEVELS = { ok: 18, warn: 12 } as const;

/**
 * TPS below which the TPS monitor alerts when `tpsWarningThreshold` is not
 * configured. The configured value replaces only this alert threshold; the
 * level table above is fixed.
 */
export const DEFAULT_TPS_ALERT_THRESHOLD = 15;

/** Disk fullness (percent used) at or above `warn` is warned, at or above `critical` is critical. */
export const DISK_LEVELS = { warn: 75, critical: 90 } as const;

/**
 * Disk fullness at which the host monitor alerts when
 * `hostAlerts.diskWarnPercent` is not configured. The configured value
 * replaces only this alert threshold; the level table above is fixed.
 */
export const DEFAULT_DISK_ALERT_PERCENT = DISK_LEVELS.critical;

export function classifyTps(tps: number): HealthLevel {
  if (tps >= TPS_LEVELS.ok) return "ok";
  if (tps >= TPS_LEVELS.warn) return "warn";
  return "critical";
}

export function classifyDiskUsage(usedPercent: number): HealthLevel {
  if (usedPercent >= DISK_LEVELS.critical) return "critical";
  if (usedPercent >= DISK_LEVELS.warn) return "warn";
  return "ok";
}

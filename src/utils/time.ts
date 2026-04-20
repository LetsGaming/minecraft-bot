/**
 * Centralised time helpers.
 *
 * All display-facing helpers read the runtime timezone from the TZ environment
 * variable (set via docker-compose) so the bot always shows local time without
 * any hardcoded zone strings scattered across the codebase.
 *
 * Epoch/timestamp arithmetic (Date.now(), getTime(), …) is intentionally left
 * alone — those are always UTC milliseconds and are correct as-is.
 */

/** The timezone configured for this process (e.g. "Europe/Berlin"). */
export const TZ: string = process.env.TZ ?? "UTC";

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a date as "YYYY-MM-DD HH:MM:SS" in the configured timezone.
 * Used by the logger and anywhere a compact local datetime string is needed.
 */
export function formatDatetime(date: Date | number = new Date()): string {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Format a date as "YYYY-MM-DD" in the configured timezone.
 * Use this for day-bucketing instead of toISOString().slice(0,10) (which is UTC).
 */
export function formatDate(date: Date | number = new Date()): string {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Format a date as "HH:MM" in the configured timezone.
 * Use this for user-facing "ready at …" times instead of toLocaleTimeString.
 */
export function formatTime(date: Date | number = new Date()): string {
  return new Date(date).toLocaleString("sv-SE", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ── Scheduling helpers ────────────────────────────────────────────────────────

/**
 * Milliseconds until the next local midnight (00:00:00) in the configured
 * timezone. Used for scheduling daily tasks (channel purge, etc.).
 *
 * This replaces the naive `setHours(24, 0, 0, 0)` approach, which computes
 * the next UTC midnight when TZ is not set correctly in older Node versions.
 */
export function msUntilMidnight(): number {
  const now = Date.now();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "en-CA" gives "YYYY-MM-DD" — parse that as a local-midnight in TZ
  const [year, month, day] = formatter
    .format(new Date(now))
    .split("-")
    .map(Number) as [number, number, number];

  // Build tomorrow 00:00:00 in TZ by finding the UTC ms that corresponds to
  // that wall-clock moment using the offset at that instant.
  const tomorrowNaive = new Date(year, month - 1, day + 1).getTime();
  // Adjust for the difference between the local-TZ wall clock and UTC.
  const tzOffset = getTzOffsetMs(tomorrowNaive);
  const midnight = tomorrowNaive + tzOffset;
  return midnight - now;
}

/**
 * Return the UTC offset in milliseconds for a given epoch time in TZ.
 * Positive means TZ is ahead of UTC (e.g. Europe/Berlin in summer = +7_200_000).
 */
function getTzOffsetMs(epochMs: number): number {
  const d = new Date(epochMs);
  // Format the date in TZ and in UTC, then diff them
  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "")
    .replace(" 24:", " 00:"); // midnight edge case

  const localEpoch = new Date(localParts + "Z").getTime();
  return epochMs - localEpoch;
}

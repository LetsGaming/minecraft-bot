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
 * Return the UTC offset in milliseconds for a given epoch time in TZ.
 * Positive means TZ is ahead of UTC (e.g. Europe/Berlin in summer = +7_200_000).
 */
function getTzOffsetMs(epochMs: number): number {
  const d = new Date(epochMs);
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

/**
 * The UTC epoch (ms) of the next local midnight (00:00:00) in TZ.
 *
 * Uses only Intl APIs — never constructs a `new Date(year, month, day)` which
 * would silently use the *system* timezone instead of TZ, producing an offset
 * that is wrong whenever system-TZ ≠ TZ (e.g. container locale = UTC,
 * TZ = Europe/Berlin gives a 1–2 h error before any correction can run).
 *
 * Algorithm:
 *  1. Find today's date components in TZ via Intl.
 *  2. Build the ISO wall-clock string "YYYY-MM-(DD+1)T00:00:00Z" — treating it
 *     as UTC gives a naïve epoch with no system-TZ involvement.
 *  3. Subtract the TZ offset at that naïve epoch to arrive at the true UTC
 *     epoch for local midnight. One-step correction; exact for all IANA zones.
 */
export function nextMidnightEpoch(): number {
  const now = Date.now();

  // Step 1: today's date in TZ
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(now))
    .split("-")
    .map(Number) as [number, number, number];

  // Step 2: tomorrow 00:00:00 as a naïve UTC epoch (no system-TZ involved)
  const tomorrowIso = `${year}-${String(month).padStart(2, "0")}-${String(day + 1).padStart(2, "0")}T00:00:00Z`;
  const naiveEpoch = new Date(tomorrowIso).getTime();

  // Step 3: subtract the TZ offset to land on the correct UTC epoch for midnight
  return naiveEpoch - getTzOffsetMs(naiveEpoch);
}

/**
 * Milliseconds until the next local midnight in TZ.
 * Used for scheduling daily tasks (channel purge, etc.).
 */
export function msUntilMidnight(): number {
  return nextMidnightEpoch() - Date.now();
}

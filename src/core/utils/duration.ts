/**
 * Human duration strings ("30m", "2h", "3d", "1w", "2mo", "1.5y") →
 * milliseconds, and back for display.
 *
 * One parser for every command that takes a period, so the accepted
 * syntax can't drift between /ban, /mute and whatever comes next.
 * Segments may be concatenated ("1d12h"); `mo` (month) is matched before
 * the bare `m` (minute) so "2mo" never reads as two minutes.
 *
 * Months and years are the calendar averages (30.44 d / 365.25 d) — a
 * ban that ends "in a month" is a rough promise, not a calendar event,
 * and treating them as fixed spans keeps the whole thing pure arithmetic.
 */

export const MS = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_746_000, // 30.44 d
  year: 31_556_952_000, // 365.25 d
} as const;

const UNITS: ReadonlyArray<readonly [suffix: string, ms: number]> = [
  ["mo", MS.month],
  ["y", MS.year],
  ["w", MS.week],
  ["d", MS.day],
  ["h", MS.hour],
  ["m", MS.minute],
  ["s", MS.second],
];

/** Below a second there is nothing to schedule; above 10 years it is a perma-ban. */
export const MIN_DURATION_MS = MS.second;
export const MAX_DURATION_MS = 10 * MS.year;

const SEGMENT = /(\d+(?:\.\d+)?)(mo|[ywdhms])/giu;

/**
 * Parse a duration string. Returns null when the input is not a valid
 * duration or falls outside [MIN_DURATION_MS, MAX_DURATION_MS] — callers
 * decide how to surface that (errors-as-values, no throwing parser).
 */
export function parseDuration(raw: string): number | null {
  const input = raw.toLowerCase().replace(/\s+/gu, "");
  if (input === "") return null;

  let total = 0;
  let consumed = 0;
  for (const match of input.matchAll(SEGMENT)) {
    const [segment, amount, suffix] = match;
    if (amount === undefined || suffix === undefined) return null;
    const unit = UNITS.find(([s]) => s === suffix);
    if (!unit) return null;
    total += Number(amount) * unit[1];
    consumed += segment.length;
  }

  // Trailing/leading junk ("2h then some") must not silently parse.
  if (consumed !== input.length) return null;
  if (!Number.isFinite(total)) return null;
  if (total < MIN_DURATION_MS || total > MAX_DURATION_MS) return null;
  return Math.round(total);
}

/**
 * Compact human rendering of a span ("2d 4h", "45m"). Shows the two
 * largest non-zero units, which is as precise as a ban readout needs.
 */
export function formatDuration(ms: number): string {
  if (ms < MS.second) return "0s";

  const parts: string[] = [];
  let rest = ms;
  for (const [suffix, unitMs] of [
    ["y", MS.year],
    ["mo", MS.month],
    ["d", MS.day],
    ["h", MS.hour],
    ["m", MS.minute],
    ["s", MS.second],
  ] as const) {
    const value = Math.floor(rest / unitMs);
    if (value > 0) {
      parts.push(`${value}${suffix}`);
      rest -= value * unitMs;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

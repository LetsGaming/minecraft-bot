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

import { MS } from "@mcbot/schema/time.js";

export { MS };

interface DurationUnit {
  /** Suffix accepted by the parser and printed by formatDuration. */
  readonly suffix: string;
  readonly ms: number;
  /** Suffix printed by formatSpan; absent for units it never shows. */
  readonly spanSuffix?: string;
  /** Whether formatDuration prints this unit (weeks parse but never print). */
  readonly compact: boolean;
}

/** Largest first. The single source for the parser, the regex and both renderers. */
const UNITS: readonly DurationUnit[] = [
  { suffix: "y", ms: MS.year, compact: true },
  { suffix: "mo", ms: MS.month, compact: true },
  { suffix: "w", ms: MS.week, compact: false },
  { suffix: "d", ms: MS.day, spanSuffix: "d", compact: true },
  { suffix: "h", ms: MS.hour, spanSuffix: "h", compact: true },
  { suffix: "m", ms: MS.minute, spanSuffix: "min", compact: true },
  { suffix: "s", ms: MS.second, spanSuffix: "s", compact: true },
];

/** Below a second there is nothing to schedule; above 10 years it is a perma-ban. */
export const MIN_DURATION_MS = MS.second;
export const MAX_DURATION_MS = 10 * MS.year;

// Longer suffixes first so "mo" wins over "m".
const SEGMENT = new RegExp(
  `(\d+(?:\.\d+)?)(${[...UNITS]
    .sort((a, b) => b.suffix.length - a.suffix.length)
    .map((u) => u.suffix)
    .join("|")})`,
  "giu",
);

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
    const unit = UNITS.find((u) => u.suffix === suffix);
    if (!unit) return null;
    total += Number(amount) * unit.ms;
    consumed += segment.length;
  }

  // Trailing/leading junk ("2h then some") must not silently parse.
  if (consumed !== input.length) return null;
  if (!Number.isFinite(total)) return null;
  if (total < MIN_DURATION_MS || total > MAX_DURATION_MS) return null;
  return Math.round(total);
}

interface RenderStyle {
  readonly units: ReadonlyArray<readonly [label: string, ms: number]>;
  /** Text between the number and its label. */
  readonly gap: string;
  /** Stop at the first zero unit after the first printed one. */
  readonly adjacentOnly: boolean;
  readonly zero: string;
}

const COMPACT: RenderStyle = {
  units: UNITS.filter((u) => u.compact).map((u) => [u.suffix, u.ms] as const),
  gap: "",
  adjacentOnly: false,
  zero: "0s",
};

const SPACED: RenderStyle = {
  units: UNITS.flatMap((u) => (u.spanSuffix ? [[u.spanSuffix, u.ms] as const] : [])),
  gap: " ",
  adjacentOnly: true,
  zero: "0 s",
};

function renderSpan(ms: number, style: RenderStyle, maxUnits: number): string {
  if (!Number.isFinite(ms) || ms < MS.second) return style.zero;

  const parts: string[] = [];
  let rest = ms;
  for (const [label, unitMs] of style.units) {
    const value = Math.floor(rest / unitMs);
    if (value > 0) {
      parts.push(`${value}${style.gap}${label}`);
      rest -= value * unitMs;
    } else if (style.adjacentOnly && parts.length > 0) {
      break;
    }
    if (parts.length === maxUnits) break;
  }
  return parts.join(" ");
}

/**
 * Compact human rendering of a span ("2d 4h", "45m"). Shows the two
 * largest non-zero units, which is as precise as a ban readout needs.
 */
export function formatDuration(ms: number): string {
  return renderSpan(ms, COMPACT, 2);
}

/**
 * Spaced rendering for message text ("2 d 7 h", "4 min 18 s"), the form the
 * Discord embeds use. The unit abbreviations read the same in English and
 * German. Only adjacent units are shown, so "2 d 0 h 5 min" becomes "2 d".
 */
export function formatSpan(ms: number, maxUnits = 2): string {
  return renderSpan(ms, SPACED, maxUnits);
}

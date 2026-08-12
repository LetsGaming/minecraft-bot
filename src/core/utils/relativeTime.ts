/**
 * One way to say "how long ago", shared by every surface.
 *
 * This began as a frontend util, which meant the dashboard and the bot would
 * have formatted the same instant differently — the web card saying "3 h ago"
 * while a Discord embed said something else, for the same fact from the same
 * source. That is the exact class of divergence this move exists to remove, so
 * the pure formatting lives here and both sides import it.
 *
 * Framework-free and dependency-free: no `Intl` locale, no timezone. The rules
 * are fixed on purpose — relative for the recent past, a stable
 * `YYYY-MM-DD HH:mm` absolute below that — because the value is usually being
 * read against a log line or a filename, where an order that never means two
 * different dates to two people matters more than locale niceties.
 */

/** What a timestamp can arrive as: epoch ms, an ISO string, or "YYYY-MM-DD HH:mm:ss". */
export type Timestamp = number | string;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Under this, "ago" is noise: the thing effectively just happened. */
const JUST_NOW_MS = 45_000;
/** Past this, a relative age stops being easier to read than a date. */
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

/**
 * Parse the three shapes callers actually emit, or null if it is something
 * else. Null is a real answer here: rendering "Invalid Date" or silently
 * showing the epoch would both be worse than showing the raw value.
 */
export function parseStamp(value: Timestamp): Date | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  const text = value.trim();
  if (text === "") return null;
  // "2026-08-08 11:37:34" is not ISO-8601. Browsers mostly accept it, but not
  // all of them and not consistently, so normalise before parsing.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
    ? text.replace(" ", "T")
    : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `2026-08-11 23:00`, local time, locale-independent. */
export function absoluteStamp(value: Timestamp, withSeconds = false): string {
  const date = parseStamp(value);
  if (!date) return typeof value === "string" ? value : "";
  const base =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

/**
 * "just now" · "12 min ago" · "3 h ago" · "2 days ago", then the absolute
 * stamp once relative stops being the more useful reading.
 *
 * The unit ladder escalates at its own boundary — 24 hours becomes days, not
 * 48 — so two rows in the same table can't express the same age two ways.
 */
export function relativeAge(value: Timestamp, now: number = Date.now()): string {
  const date = parseStamp(value);
  if (!date) return typeof value === "string" ? value : "";
  const elapsed = now - date.getTime();
  // A future stamp means clock skew between the host and the reader, not a
  // scheduled event. Counting up from it would print "-3 h ago".
  if (elapsed < JUST_NOW_MS) return "just now";
  if (elapsed < HOUR_MS) {
    const minutes = Math.round(elapsed / MINUTE_MS);
    return `${minutes} min ago`;
  }
  if (elapsed < DAY_MS) {
    const hours = Math.round(elapsed / HOUR_MS);
    return `${hours} h ago`;
  }
  if (elapsed < RELATIVE_LIMIT_MS) {
    const days = Math.round(elapsed / DAY_MS);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  return absoluteStamp(date.getTime());
}

/**
 * The full moment, seconds included — for a hover title on a relative label,
 * or anywhere a relative string should never hide the detail behind it.
 */
export function timestampTitle(value: Timestamp): string {
  return absoluteStamp(value, true);
}

/**
 * Query-string parsing shared by the routes. Values arrive as strings (the
 * schemas keep them that way), and the range or default is a domain rule, so
 * it is applied here rather than in the schema.
 */

/** The integer in `raw`, or null when it is absent or not a number. */
export function intParam(raw: string | undefined): number | null {
  const n = parseInt(raw ?? "", 10);
  return Number.isNaN(n) ? null : n;
}

/** `raw` as an integer clamped to [min, max]; `def` when it is absent or unparseable. */
export function clampIntParam(
  raw: string | undefined,
  range: { def: number; min: number; max: number },
): number {
  const n = intParam(raw);
  if (n === null) return range.def;
  return Math.min(Math.max(n, range.min), range.max);
}

/** A boolean flag: `1`/`true` are on, `0`/`false` are off, anything else is `def`. */
export function flagParam(raw: string | undefined, def = false): boolean {
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return def;
}

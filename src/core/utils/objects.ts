/**
 * Type guard for a plain, string-keyed object (excludes `null` and arrays).
 *
 * Narrows `unknown` to `Record<string, unknown>` *without* a cast, so code that
 * walks dynamic or schema-driven data (config validation, config diffing, stats
 * files) can iterate keys type-safely instead of asserting a shape onto values
 * it hasn't checked. This is the single place that "is it a plain object?" lives.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

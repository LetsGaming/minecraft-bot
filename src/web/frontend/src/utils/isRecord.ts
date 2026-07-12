// Narrow `unknown` (e.g. the redacted, schema-driven config the API returns as
// `unknown`) to a plain object without a cast, so composables can read/mutate
// it type-safely. Mirrors the backend guard of the same name.

/** Type guard for a plain, string-keyed object (excludes null and arrays). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

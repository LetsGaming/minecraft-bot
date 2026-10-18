function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/**
 * JSON with object keys sorted at every depth, so two values that differ
 * only in key order serialise identically. Array order is preserved.
 * `undefined` serialises as the string "undefined".
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? "undefined";
}

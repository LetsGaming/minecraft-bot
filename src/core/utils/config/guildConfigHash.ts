import { createHash } from "crypto";

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
 * Concurrency token for one guild's config block: a digest of the block's
 * content alone, independent of key order and of every other part of
 * config.json. Editing guild A therefore never conflicts with a save to guild
 * B or to a server entry.
 */
export function guildConfigHash(block: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(block ?? {})))
    .digest("hex");
}

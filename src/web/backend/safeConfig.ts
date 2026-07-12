/**
 * Safe-config layer for the dashboard.
 *
 * Reading: secrets (bot token, per-server rconPassword and apiKey) are
 * replaced by a placeholder before the config ever leaves the process.
 * Writing: a submitted config may still CONTAIN those placeholders — the
 * merge step swaps every placeholder back for the value currently on
 * disk, so "save without touching secrets" is the default and a secret
 * only changes when the user actually typed a new one.
 *
 * Works on the RAW config (what's on disk), not the resolved one — the
 * dashboard edits the file, resolution happens in the bot process.
 */
import type { RawBotConfig } from "@mcbot/core/types/index.js";

export const SECRET_PLACEHOLDER = "•••••";

const SERVER_SECRET_KEYS = ["rconPassword", "apiKey"] as const;

function clone<T>(value: T): T {
  // Deep clone via JSON round-trip. Config is plain JSON data (no functions,
  // dates, or cycles), so the structure of a T survives intact and the assert
  // is sound.
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A deep copy of the raw config with every secret masked. */
export function toSafeConfig(raw: RawBotConfig): RawBotConfig {
  const safe = clone(raw);
  if (typeof safe.token === "string" && safe.token.length > 0) {
    safe.token = SECRET_PLACEHOLDER;
  }
  for (const server of Object.values(safe.servers ?? {})) {
    // Widen to an index type to mask secrets by key name: RawServerConfig is an
    // interface (no index signature), so a dynamic — though known-set — key
    // access needs this. Safe: `server` is always a config object.
    const rec = server as Record<string, unknown>;
    for (const key of SERVER_SECRET_KEYS) {
      const value = rec[key];
      if (typeof value === "string" && value.length > 0) {
        rec[key] = SECRET_PLACEHOLDER;
      }
    }
  }
  return safe;
}

/**
 * Replace placeholders in a submitted config with the on-disk values.
 * Placeholders in positions that have no current value are dropped —
 * saving a masked secret into a server that never had one would store
 * the literal placeholder string as a password.
 */
export function mergeSecretPlaceholders(
  submitted: RawBotConfig,
  current: RawBotConfig,
): RawBotConfig {
  const merged = clone(submitted);

  if (merged.token === SECRET_PLACEHOLDER) {
    if (typeof current.token === "string") merged.token = current.token;
    // `token` is a declared field, so deleting it needs the index-type widening
    // (you can't `delete` a statically-known property). This drops a masked
    // token that has no stored value, rather than persisting the placeholder.
    else delete (merged as unknown as Record<string, unknown>).token;
  }

  for (const [id, server] of Object.entries(merged.servers ?? {})) {
    // Same index-type widening as toSafeConfig (see note): mask/unmask secrets
    // by key name over interface-typed server configs.
    const rec = server as Record<string, unknown>;
    const currentServer = current.servers?.[id] as
      | Record<string, unknown>
      | undefined;
    for (const key of SERVER_SECRET_KEYS) {
      if (rec[key] !== SECRET_PLACEHOLDER) continue;
      if (currentServer && typeof currentServer[key] === "string") {
        rec[key] = currentServer[key];
      } else {
        delete rec[key];
      }
    }
  }

  return merged;
}

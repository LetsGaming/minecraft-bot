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
import type { RawBotConfig } from "../../common/types/index.js";

export const SECRET_PLACEHOLDER = "•••••";

const SERVER_SECRET_KEYS = ["rconPassword", "apiKey"] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A deep copy of the raw config with every secret masked. */
export function toSafeConfig(raw: RawBotConfig): RawBotConfig {
  const safe = clone(raw);
  if (typeof safe.token === "string" && safe.token.length > 0) {
    safe.token = SECRET_PLACEHOLDER;
  }
  for (const server of Object.values(safe.servers ?? {})) {
    for (const key of SERVER_SECRET_KEYS) {
      const rec = server as Record<string, unknown>;
      if (typeof rec[key] === "string" && (rec[key] as string).length > 0) {
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
    else delete (merged as unknown as Record<string, unknown>).token;
  }

  for (const [id, server] of Object.entries(merged.servers ?? {})) {
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

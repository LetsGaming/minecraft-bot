import { StatusRole, statusEmbedColor } from "@mcbot/schema/status.js";
import {
  defaultEmbedColor,
  parseHexColor,
  type EmbedColorKey,
} from "@mcbot/schema/embedCategories.js";
import { loadConfig } from "@mcbot/core/config.js";

/**
 * Embed side-bar colours. Every semantic value is a status role from
 * `@mcbot/schema` (the same colours as the dashboard chips), so Discord and
 * the dashboard cannot drift apart.
 */
export const EmbedColor = {
  /** Running, answering. */
  Online: statusEmbedColor(StatusRole.Online),
  /** Done and live; also the only celebration colour. */
  Success: statusEmbedColor(StatusRole.Applied),
  /** Not responding, warning, needs a look. */
  Warning: statusEmbedColor(StatusRole.Degraded),
  /** Stopped, failed, denied. */
  Error: statusEmbedColor(StatusRole.Offline),
  /** No data, plain events (join, leave, death). */
  Neutral: statusEmbedColor(StatusRole.Unknown),
  /** Waiting for someone: confirmations, applications. */
  Pending: statusEmbedColor(StatusRole.Pending),
  /** Neutral answers and running jobs. */
  Info: statusEmbedColor(StatusRole.Info),
} as const;

/**
 * Side-bar colour of a category or rarity tier: the admin's `embedColors`
 * override when valid, else the built-in default. Read at send time, so a
 * saved override shows up on the next embed without a restart.
 */
export function embedColorFor(key: EmbedColorKey): number {
  try {
    const override = parseHexColor(loadConfig().embedColors?.[key]);
    if (override !== undefined) return override;
  } catch {
    // No loadable config (early boot, tests): defaults still work.
  }
  return defaultEmbedColor(key);
}

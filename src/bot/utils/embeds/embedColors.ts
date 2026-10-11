import { StatusRole, statusEmbedColor } from "@mcbot/schema/status.js";

/**
 * Embed side-bar colours. Every semantic value is a status role from
 * `@mcbot/schema` (the same colours as the dashboard chips), so Discord and
 * the dashboard cannot drift apart. Only external brand colours live here
 * as literals.
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
  Modrinth: 0x1bd96a,
} as const;

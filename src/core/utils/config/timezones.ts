/**
 * Which timezone applies to a given piece of work.
 *
 * The bot has two kinds of wall-clock, and they do not have the same owner:
 *
 *   Discord-facing  A nightly channel purge, "busiest hour" in /activity, a
 *                   digest. These belong to a *guild* — its members are the
 *                   ones who experience "midnight". Two guilds watching one
 *                   server can legitimately disagree.
 *
 *   Server-facing   A restart at 04:00. This belongs to the *Minecraft
 *                   server's* operator, not to any guild. With two guilds
 *                   watching one server there is no guild answer to give.
 *
 * So there are two lookups, not one. Both fall back to UTC — the same zone
 * everything is stored in — which makes an unconfigured deployment coherent
 * rather than arbitrary.
 *
 * For merely *displaying* a moment in Discord, prefer `<t:epoch:f>`: Discord
 * renders it in each reader's own zone, which is better than anything a
 * server-side setting can do. These lookups are for the cases that must pick
 * one zone — a scheduled action, or an aggregate bucketed by local hour.
 */
import { loadConfig } from "../../config.js";
import { UTC, isValidTimeZone } from "../time.js";
import { log } from "../logger.js";

/** Zones already reported as invalid, so the warning is logged once each. */
const warned = new Set<string>();

function validated(tz: string | undefined, where: string): string {
  if (!tz) return UTC;
  if (isValidTimeZone(tz)) return tz;
  if (!warned.has(`${where}:${tz}`)) {
    warned.add(`${where}:${tz}`);
    log.warn(
      "timezone",
      `${where}: "${tz}" is not a known IANA timezone (e.g. "Europe/Berlin") — using UTC`,
    );
  }
  return UTC;
}

/**
 * The zone a guild's wall-clock features run in.
 *
 * Falls back to the global `timezone`, then UTC. Reading config on each call
 * rather than caching keeps /config reload live, and these are called at
 * human cadence, not in a loop.
 */
export function guildTimeZone(guildId: string | null | undefined): string {
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    return UTC; // config unreadable: neutral rather than throwing at a caller
  }
  const guildTz = guildId ? cfg.guilds?.[guildId]?.timezone : undefined;
  if (guildTz) return validated(guildTz, `guilds.${guildId}.timezone`);
  return validated(cfg.timezone, "timezone");
}

/**
 * The zone a server's schedules run in — restarts, and anything else pinned
 * to the machine rather than to an audience.
 */
export function scheduleTimeZone(serverId: string): string {
  let cfg;
  try {
    cfg = loadConfig();
  } catch {
    return UTC;
  }
  const scheduleTz = cfg.schedules?.[serverId]?.timezone;
  if (scheduleTz) {
    return validated(scheduleTz, `schedules.${serverId}.timezone`);
  }
  return validated(cfg.timezone, "timezone");
}

/** Exposed for tests, which assert the once-per-zone warning. */
export function _resetTimezoneWarnings(): void {
  warned.clear();
}

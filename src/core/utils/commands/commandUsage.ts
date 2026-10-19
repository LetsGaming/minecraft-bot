/**
 * Which commands actually get used.
 *
 * Written because the discoverability problem could not be measured. Every
 * argument about which features players ignore was a guess, and the fix for
 * an unused feature ("advertise it") is the opposite of the fix for an
 * unwanted one ("delete it") so guessing wrong is expensive in both
 * directions.
 *
 * Raw events rather than a counter, because two different questions are
 * asked of the same data:
 *
 *   the dashboard  how often was each command used in the last N days, 
 *                  an aggregate over commands
 *   /help          which commands has THIS user never run, a per-user set
 *
 * A counter answers the first and not the second. Events answer both, and
 * the volume is trivial: a busy server produces a few hundred rows a day,
 * pruned to a fixed window.
 *
 * Recording never throws. A failed metric must not fail the command it was
 * measuring, that would make the observability worse than none.
 */
import { MS } from "@mcbot/schema/time.js";
import { getDb } from "../../db/index.js";
import { mapRows, col } from "../../db/rows.js";
import { log } from "../logger.js";
import { errMsg } from "../error.js";
import { ANALYTICS_RETENTION_DAYS } from "@mcbot/schema/analytics.js";

/** How far back usage is kept. Long enough to show a monthly pattern. */
export const USAGE_RETENTION_DAYS = ANALYTICS_RETENTION_DAYS.commands;

/** Default window for "recently used" questions. */
export const USAGE_WINDOW_DAYS = 30;

const DAY_MS = MS.day;

export type CommandSurface = "slash" | "ingame";

const toSurface = (raw: string): CommandSurface => (raw === "ingame" ? "ingame" : "slash");

/** Read failures degrade to "no usage", but are visible: once per distinct message. */
const reportedReadFailures = new Set<string>();
function reportReadFailure(what: string, err: unknown): void {
  const message = `${what} failed: ${errMsg(err)}`;
  if (reportedReadFailures.has(message)) return;
  reportedReadFailures.add(message);
  log.warn("usage", message);
}

export interface UsageEvent {
  command: string;
  surface: CommandSurface;
  /** Discord id. Null for in-game use by a player with no linked account. */
  userId?: string | null;
  guildId?: string | null;
  serverId?: string | null;
}

export interface CommandUsageCount {
  command: string;
  surface: CommandSurface;
  count: number;
  /** Distinct users, so one enthusiast is not mistaken for adoption. */
  users: number;
  lastUsedAt: number | null;
}

/** Record one invocation. Best-effort; never throws. */
export function recordCommandUsage(
  event: UsageEvent,
  at: number = Date.now(),
): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO command_usage (ts, command, surface, user_id, guild_id, server_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        event.command,
        event.surface,
        event.userId ?? null,
        event.guildId ?? null,
        event.serverId ?? null,
      );
  } catch (err) {
    log.debug("usage", `Could not record ${event.command}: ${errMsg(err)}`);
  }
}

/**
 * Usage per command over the window, busiest first.
 *
 * Commands with no rows are absent rather than zero, the caller knows the
 * full command list and a zero is more useful when it comes from there,
 * since a command can be missing here because it is new, disabled, or
 * genuinely unused, and only the caller can tell those apart.
 */
export function usageByCommand(
  windowDays: number = USAGE_WINDOW_DAYS,
  now: number = Date.now(),
): CommandUsageCount[] {
  return usageByCommandSince(now - windowDays * DAY_MS);
}

/** Same aggregate as `usageByCommand`, from an exact timestamp (hour-precise windows). */
export function usageByCommandSince(since: number): CommandUsageCount[] {
  try {
    return mapRows(
      getDb().prepare(
        `SELECT command, surface,
                COUNT(*)                  AS uses,
                COUNT(DISTINCT user_id)   AS users,
                MAX(ts)                   AS last_ts
           FROM command_usage
          WHERE ts >= ?
          GROUP BY command, surface
          ORDER BY uses DESC`,
      ),
      (row) => ({
        command: col.text(row, "command"),
        surface: toSurface(col.text(row, "surface")),
        count: col.int(row, "uses"),
        users: col.int(row, "users"),
        lastUsedAt: col.intOrNull(row, "last_ts"),
      }),
      since,
    );
  } catch (err) {
    reportReadFailure("Usage query", err);
    return [];
  }
}

/**
 * The commands this user has ever run. Deliberately not windowed: /help
 * asks "have you seen this before", and something tried once six months
 * ago has been seen.
 */
export function commandsUsedBy(userId: string): Set<string> {
  try {
    const rows = mapRows(
      getDb().prepare(
        `SELECT DISTINCT command FROM command_usage WHERE user_id = ?`,
      ),
      (row) => col.text(row, "command"),
      userId,
    );
    return new Set(rows);
  } catch (err) {
    reportReadFailure("Per-user usage query", err);
    return new Set();
  }
}

/** Drop rows past the retention window. Returns how many went. */
export function pruneCommandUsage(now: number = Date.now()): number {
  try {
    const result = getDb()
      .prepare(`DELETE FROM command_usage WHERE ts < ?`)
      .run(now - USAGE_RETENTION_DAYS * DAY_MS);
    return Number(result.changes ?? 0);
  } catch (err) {
    log.debug("usage", `Usage prune failed: ${errMsg(err)}`);
    return 0;
  }
}

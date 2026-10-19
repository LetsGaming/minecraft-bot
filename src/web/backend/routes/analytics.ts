/**
 * Analytics: the data the bot already collects, finally reachable from the
 * dashboard.
 *
 * Every number here has existed for a long time and was only ever available
 * through a Discord command: `/uptime`, `/activity`, and the usage counters
 * behind `/help`. All of it is a table or a time series, which is to say it
 * was being rendered as a sparkline made of block characters in an embed
 * because that was the only surface available.
 *
 * Nothing new is collected. These are read paths over `uptime_checks`,
 * `player_count_hours`, `command_usage`, the session store and the stat
 * snapshots, which is why this is a routes file and not a subsystem.
 *
 * Every route takes `hours` and clamps it to what its own store retains
 * (`ANALYTICS_CAP_HOURS`), reporting the range it actually answered.
 *
 * Deliberately not through the wrapper except for the leaderboard: this is the
 * bot's own history, so it keeps working when a wrapper is unreachable, which
 * is exactly when someone wants to know how long the server has been down.
 */
import type { FastifyInstance } from "fastify";
import { MS } from "@mcbot/schema";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  ANALYTICS_CAP_HOURS,
  type AnalyticsCaps,
  type CommandUsageResponse,
  type LeaderboardResponse,
  type ServerAnalyticsResponse,
} from "@mcbot/schema/analytics.js";
import { getUptimeStats } from "@mcbot/core/utils/stores/uptimeTracker.js";
import {
  loadPlayerCountSeries,
  busiestHours,
} from "@mcbot/core/utils/stores/playerCountHistory.js";
import {
  LEADERBOARD_STATS,
  buildLeaderboard,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { getSnapshotClosestTo } from "@mcbot/core/utils/minecraft/snapshotUtils.js";
import { usageByCommandSince } from "@mcbot/core/utils/commands/commandUsage.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { BadRequest, BadGateway, HttpError } from "../errors.js";
import { IdParams, LeaderboardQuery, AnalyticsRangeQuery } from "./schemas.js";
import { clampIntParam, intParam } from "./query.js";
import { requireServer } from "./support.js";

const ACTIVITY_HOURS_DEFAULT = ANALYTICS_CAP_HOURS.activity;
const COMMAND_HOURS_DEFAULT = 30 * 24;

const CAPS: AnalyticsCaps = { ...ANALYTICS_CAP_HOURS };

function clampHours(raw: string | undefined, def: number, max: number): number {
  return clampIntParam(raw, { def, min: 1, max });
}

function formatRange(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/analytics",
    {
      schema: { params: IdParams, querystring: AnalyticsRangeQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req): Promise<ServerAnalyticsResponse> => {
      const serverId = req.params.id;
      requireServer(serverId);

      try {
        const requested = clampHours(
          req.query.hours,
          ACTIVITY_HOURS_DEFAULT,
          Number.MAX_SAFE_INTEGER,
        );
        const hours = Math.min(requested, CAPS.activity);
        const uptime = await getUptimeStats(serverId, {
          rangeHours: Math.min(requested, CAPS.uptime),
        });

        const since = Date.now() - hours * MS.hour;
        const series = loadPlayerCountSeries(serverId, since);

        return {
          uptime,
          activity: {
            // The resolved (clamped) range, so the client can label what it
            // actually got rather than what it asked for.
            rangeHours: hours,
            // `sum / samples` is the mean concurrent players for that hour,
            // which is the honest reading: `max` alone makes one person
            // logging in at 03:00 look like a busy night.
            hours: series.map((bucket) => ({
              at: bucket.h,
              avg: bucket.samples > 0 ? bucket.sum / bucket.samples : 0,
              peak: bucket.max,
              samples: bucket.samples,
            })),
            busiest: busiestHours(series),
          },
          caps: CAPS,
        };
      } catch (err) {
        log.error("web", `Analytics for ${serverId} failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read analytics history.");
      }
    },
  );

  /**
   * A stat leaderboard, built by the same function `/leaderboard`
   * uses, so a board in the dashboard and a board in Discord cannot rank the
   * same players differently. With `hours` it is a delta against the snapshot
   * closest to the start of the range, like the scheduled boards.
   */
  api.get(
    "/api/servers/:id/analytics/leaderboard",
    {
      schema: { params: IdParams, querystring: LeaderboardQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req): Promise<LeaderboardResponse> => {
      const server = requireServer(req.params.id);
      const statKey = req.query.stat ?? "playtime";
      if (!LEADERBOARD_STATS[statKey]) {
        throw new BadRequest(`Unknown stat "${statKey}".`);
      }
      const requested = intParam(req.query.hours);
      const rangeHours =
        requested === null ? null : Math.min(Math.max(requested, 1), CAPS.leaderboard);
      try {
        // Stats live in the world folder, so this is the one analytics panel
        // an outage can take out. Player stats move slowly enough that an
        // hour-old board is still a useful board.
        const { value, stale } = await readThrough(
          req.params.id,
          `leaderboard:${statKey}:${rangeHours ?? "all"}`,
          async () => {
            if (rangeHours === null) {
              const board = await buildLeaderboard(statKey, { limit: 25, server });
              return { board, baselineAt: null, historyShorterThanRange: false };
            }
            const target = Date.now() - rangeHours * MS.hour;
            const snapshot = await getSnapshotClosestTo(server.id, target);
            const board = await buildLeaderboard(statKey, {
              limit: 25,
              server,
              baseline: snapshot?.players ?? null,
              periodLabel: formatRange(rangeHours),
            });
            return {
              board,
              baselineAt: snapshot?.timestamp ?? null,
              // getSnapshotClosestTo falls back to the oldest snapshot when
              // none is old enough, and that one starts after the range does.
              historyShorterThanRange: !snapshot || snapshot.timestamp > target,
            };
          },
        );
        return {
          stat: statKey,
          title: value.board.title,
          entries: value.board.entries,
          stale,
          // The catalogue ships with the board so the picker cannot offer a
          // stat this build does not know how to extract.
          available: Object.entries(LEADERBOARD_STATS).map(([key, def]) => ({
            key,
            label: def.label,
          })),
          rangeHours,
          baselineAt: value.baselineAt,
          historyShorterThanRange: value.historyShorterThanRange,
          caps: CAPS,
        };
      } catch (err) {
        // Stats come off the server's world folder through the wrapper, so
        // this is the one analytics route that can fail on an outage.
        log.warn("web", `Leaderboard ${statKey} on ${req.params.id}: ${errMsg(err)}`);
        throw new BadGateway("Could not read player stats from the server.");
      }
    },
  );

  api.get(
    "/api/analytics/commands",
    // Command usage is fleet-wide, not per server, so the scope is global;
    // the gate refuses an unscoped declaration rather than guessing.
    {
      schema: { querystring: AnalyticsRangeQuery },
      config: { capability: "audit:read", scope: "global" },
    },
    async (req): Promise<CommandUsageResponse> => {
      const hours = clampHours(
        req.query.hours,
        COMMAND_HOURS_DEFAULT,
        CAPS.commands,
      );
      const since = Date.now() - hours * MS.hour;
      try {
        const commands = usageByCommandSince(since).map((r) => ({
          command: r.command,
          surface: r.surface,
          uses: r.count,
          users: r.users,
          lastUsed: r.lastUsedAt,
        }));
        return { since, rangeHours: hours, commands, caps: CAPS };
      } catch (err) {
        log.error("web", `Command analytics failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read command usage.");
      }
    },
  );
}

/**
 * Analytics: the data the bot already collects, finally reachable from the
 * dashboard.
 *
 * Every number here has existed for a long time and was only ever available
 * through a Discord command — `/uptime`, `/activity`, and the usage counters
 * behind `/help`. All of it is a table or a time series, which is to say it
 * was being rendered as a sparkline made of block characters in an embed
 * because that was the only surface available.
 *
 * Nothing new is collected. These are read paths over `uptime_checks`,
 * `player_count_hours` and `command_usage`, which is why this is a routes file
 * and not a subsystem.
 *
 * Deliberately not through the wrapper: this is the bot's own history, so it
 * keeps working when a wrapper is unreachable — which is exactly when someone
 * wants to know how long the server has been down.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { getUptimeStats } from "@mcbot/core/utils/stores/uptimeTracker.js";
import {
  loadPlayerCountStore,
  busiestHours,
  type HourBucket,
} from "@mcbot/core/utils/stores/playerCountHistory.js";
import {
  loadSessionStore,
  totalPlaytimeMs,
} from "@mcbot/core/utils/stores/sessionStore.js";
import {
  LEADERBOARD_STATS,
  buildLeaderboard,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { getDb } from "@mcbot/core/db/index.js";
import { mapRows, col } from "@mcbot/core/db/rows.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { NotFound, BadRequest, HttpError } from "../errors.js";
import { IdParams, LeaderboardQuery } from "./schemas.js";

const HOUR_MS = 3_600_000;

/**
 * How far back the activity series runs.
 *
 * Two weeks: long enough to show a weekday/weekend shape, short enough that
 * the payload stays a few hundred points rather than something the browser
 * has to thin before charting.
 */
const ACTIVITY_HOURS = 24 * 14;

export function registerAnalyticsRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/analytics",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const serverId = req.params.id;
      if (!getServerInstance(serverId)) {
        throw new NotFound(`No server named "${serverId}" is configured.`);
      }

      try {
        const [uptime, store] = await Promise.all([
          getUptimeStats(serverId),
          loadPlayerCountStore(),
        ]);

        const now = Date.now();
        const since = now - ACTIVITY_HOURS * HOUR_MS;
        // The store keeps every server's buckets in one series; filter here
        // rather than widening the store's API for one caller.
        const series: HourBucket[] = (store.servers[serverId] ?? []).filter(
          (bucket) => bucket.h >= since,
        );

        return {
          uptime,
          activity: {
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
        };
      } catch (err) {
        log.error("web", `Analytics for ${serverId} failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read analytics history.");
      }
    },
  );

  /**
   * Who plays, and how much.
   *
   * `/playtime` and `/sessions` answer this one player at a time, in an embed,
   * which is the wrong shape for the question people actually have — "who is
   * still around, and who stopped coming". That is a sorted table, and it has
   * been one row per Discord message until now.
   */
  api.get(
    "/api/servers/:id/analytics/players",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const serverId = req.params.id;
      if (!getServerInstance(serverId)) {
        throw new NotFound(`No server named "${serverId}" is configured.`);
      }
      try {
        const store = await loadSessionStore();
        const entries = Object.values(store.servers[serverId] ?? {});
        const now = Date.now();

        const players = entries.map((entry) => {
          const open = entry.sessions.some((session) => session.leftAt === null);
          return {
            name: entry.name,
            // Counts an open session up to now, so someone mid-session is not
            // reported as having played less than they have.
            playtimeMs: totalPlaytimeMs(entry, now),
            sessions: entry.sessions.length,
            lastSeen: entry.lastSeen,
            online: open,
            firstSeen: entry.sessions[0]?.joinedAt ?? null,
          };
        });
        players.sort((a, b) => b.playtimeMs - a.playtimeMs);

        return { players, totalPlayers: players.length };
      } catch (err) {
        log.error("web", `Player analytics for ${serverId} failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read session history.");
      }
    },
  );

  /**
   * A stat leaderboard, built by the same function `/leaderboard` and `/top`
   * use — so a board in the dashboard and a board in Discord cannot rank the
   * same players differently.
   */
  api.get(
    "/api/servers/:id/analytics/leaderboard",
    {
      schema: { params: IdParams, querystring: LeaderboardQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = getServerInstance(req.params.id);
      if (!server) {
        throw new NotFound(`No server named "${req.params.id}" is configured.`);
      }
      const statKey = req.query.stat ?? "playtime";
      if (!LEADERBOARD_STATS[statKey]) {
        throw new BadRequest(`Unknown stat "${statKey}".`);
      }
      try {
        // Stats live in the world folder, so this is the one analytics panel
        // an outage can take out. Player stats move slowly enough that an
        // hour-old board is still a useful board.
        const { value: board, stale } = await readThrough(
          req.params.id,
          `leaderboard:${statKey}`,
          () => buildLeaderboard(statKey, { limit: 25, server }),
        );
        return {
          stat: statKey,
          title: board.title,
          entries: board.entries,
          stale,
          // The catalogue ships with the board so the picker cannot offer a
          // stat this build does not know how to extract.
          available: Object.entries(LEADERBOARD_STATS).map(([key, def]) => ({
            key,
            label: def.label,
          })),
        };
      } catch (err) {
        // Stats come off the server's world folder through the wrapper, so
        // this is the one analytics route that can fail on an outage.
        log.warn("web", `Leaderboard ${statKey} on ${req.params.id}: ${errMsg(err)}`);
        throw new HttpError(502, "Could not read player stats from the server.");
      }
    },
  );

  api.get(
    "/api/analytics/commands",
    // Command usage is fleet-wide, not per server, so the scope is global —
    // the gate refuses an unscoped declaration rather than guessing.
    { config: { capability: "audit:read", scope: "global" } },
    async () => {
      const since = Date.now() - 30 * 24 * HOUR_MS;
      try {
        // Grouped in SQL rather than in JS: the raw table is one row per
        // invocation and can run to hundreds of thousands, none of which the
        // dashboard needs individually.
        const rows = mapRows(
          getDb().prepare(
            `SELECT command,
                    surface,
                    COUNT(*)                AS uses,
                    COUNT(DISTINCT user_id) AS users,
                    MAX(ts)                 AS last_used
             FROM command_usage
             WHERE ts >= ?
             GROUP BY command, surface
             ORDER BY uses DESC`,
          ),
          (row) => ({
            command: col.text(row, "command"),
            surface: col.text(row, "surface"),
            uses: col.int(row, "uses"),
            users: col.int(row, "users"),
            lastUsed: col.int(row, "last_used"),
          }),
          since,
        );
        return { since, commands: rows };
      } catch (err) {
        log.error("web", `Command analytics failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read command usage.");
      }
    },
  );
}

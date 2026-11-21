/**
 * Player audit: a searchable, paged list of the players a server has seen and
 * one player's detail.
 *
 * Read-only, and built from stores the bot already keeps (see
 * `@mcbot/core/utils/minecraft/playerDetail`). The base view needs
 * `server:read`, like Analytics. The part of the detail that joins a name to a
 * Discord account and to moderation notes is included only when the session
 * also holds `audit:read` on that server; the response says whether it did,
 * so the page can explain a missing section instead of showing nothing.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { MS } from "@mcbot/schema";
import { ANALYTICS_CAP_HOURS } from "@mcbot/schema/analytics.js";
import {
  PLAYER_SORT_FIELDS,
  PLAYER_STATUS_FILTERS,
  type PlayerDetail,
  type PlayerHeadInfo,
  type PlayerHeadRefresh,
  type PlayerListResponse,
  type PlayerSortField,
  type PlayerStatusFilter,
} from "@mcbot/schema/players.js";
import {
  listPlayerSummaries,
  SESSION_RETENTION_DAYS,
} from "@mcbot/core/utils/stores/sessionStore.js";
import { buildPlayerDetail } from "@mcbot/core/utils/minecraft/playerDetail.js";
import {
  headVersion,
  playerHeadUrl,
  probeHead,
  type HeadProbe,
} from "@mcbot/core/utils/minecraft/playerHead.js";
import { getSkin, headInfo, refreshHead } from "@mcbot/core/utils/stores/headStore.js";
import { resolveSkin } from "@mcbot/core/utils/minecraft/skinResolver.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { log } from "@mcbot/core/utils/logger.js";
import { currentSession } from "../auth/auth.js";
import { sessionHolds } from "../auth/capabilities.js";
import { fetchDiscordUserName } from "../auth/discordRest.js";
import { fetchIcon } from "../iconProxy.js";
import { BadGateway, BadRequest, HttpError, NotFound } from "../errors.js";
import { IdParams, PlayerListQuery, PlayerParams } from "./schemas.js";
import { clampIntParam } from "./query.js";
import { requireServer } from "./support.js";

const DEFAULT_RANGE_HOURS = 14 * 24;
const DEFAULT_QUIET_DAYS = 14;
const MAX_QUIET_DAYS = SESSION_RETENTION_DAYS;
const PAGE_LIMIT = { def: 20, min: 1, max: 50 } as const;
const OFFSET = { def: 0, min: 0, max: 100_000 } as const;

const HEAD_UA = "LetsGaming/minecraft-bot dashboard (head proxy)";
const HEAD_BROWSER_CACHE_SECONDS = 3600;

function headInfoOf(name: string, probe: HeadProbe): PlayerHeadInfo {
  const skin = getSkin(name);
  return {
    version: headVersion(name),
    reachable: probe.ok,
    cacheAgeSeconds: probe.ageSeconds,
    refreshedAt: headInfo(name)?.refreshedAt ?? null,
    keyedBy: skin?.hash ? "skin" : "name",
    skinCheckedAt: skin !== null && skin.checkedAt > 0 ? skin.checkedAt : null,
  };
}

function oneOf<T extends string>(raw: string | undefined, allowed: readonly T[], def: T, what: string): T {
  if (raw === undefined || raw === "") return def;
  const hit = allowed.find((a) => a === raw);
  if (!hit) throw new BadRequest(`Unknown ${what} "${raw}".`);
  return hit;
}

function requireMcName(raw: string): string {
  if (!isValidMcName(raw)) throw new BadRequest("That is not a valid Minecraft name.");
  return raw;
}

export function registerPlayerRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/players",
    {
      schema: { params: IdParams, querystring: PlayerListQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req): Promise<PlayerListResponse> => {
      const serverId = req.params.id;
      requireServer(serverId);

      const q = req.query;
      const status = oneOf<PlayerStatusFilter>(q.status, PLAYER_STATUS_FILTERS, "all", "status");
      const sort = oneOf<PlayerSortField>(q.sort, PLAYER_SORT_FIELDS, "playtimeMs", "sort field");
      const order = oneOf(q.order, ["asc", "desc"] as const, sort === "name" ? "asc" : "desc", "order");
      const hours = clampIntParam(q.hours, {
        def: DEFAULT_RANGE_HOURS,
        min: 1,
        max: ANALYTICS_CAP_HOURS.sessions,
      });
      const quietDays = clampIntParam(q.quietDays, { def: DEFAULT_QUIET_DAYS, min: 1, max: MAX_QUIET_DAYS });
      const limit = clampIntParam(q.limit, PAGE_LIMIT);
      const offset = clampIntParam(q.offset, OFFSET);

      const now = Date.now();
      try {
        const { rows, total } = listPlayerSummaries(serverId, {
          now,
          sinceMs: now - hours * MS.hour,
          q: q.q,
          status,
          quietBeforeMs: now - quietDays * MS.day,
          sort,
          order,
          limit,
          offset,
        });
        return {
          players: rows,
          total,
          rangeHours: hours,
          historyDays: SESSION_RETENTION_DAYS,
          limit,
          offset,
        };
      } catch (err) {
        log.error("web", `Player list for ${serverId} failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read session history.");
      }
    },
  );

  api.get(
    "/api/servers/:id/players/:name",
    {
      schema: { params: PlayerParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req): Promise<PlayerDetail> => {
      const server = requireServer(req.params.id);
      const name = requireMcName(req.params.name);
      const includeSensitive = sessionHolds(currentSession(req), "audit:read", req.params.id);

      let detail: PlayerDetail | null;
      try {
        detail = await buildPlayerDetail({
          serverId: req.params.id,
          server,
          name,
          includeSensitive,
          resolveDiscordName: fetchDiscordUserName,
        });
      } catch (err) {
        log.error("web", `Player detail for ${name} on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(500, "Could not read this player's history.");
      }
      if (!detail) throw new NotFound(`Nothing is known about "${name}" on ${req.params.id}.`);
      return detail;
    },
  );

  // Heads are fetched by name from one fixed host and served same-origin, so
  // the CSP stays closed to third-party images and the viewer's address is
  // not sent to it. Never an open relay: the host is a constant.
  api.get(
    "/api/servers/:id/players/:name/head",
    {
      schema: { params: PlayerParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req, reply) => {
      requireServer(req.params.id);
      const name = requireMcName(req.params.name);
      try {
        // The page adds its own ?v= to get past the browser cache; the upstream
        // address is always the one Discord uses, never taken from the request.
        const img = await fetchIcon(playerHeadUrl(name), HEAD_UA);
        reply.header("content-type", img.contentType);
        reply.header("cache-control", `private, max-age=${HEAD_BROWSER_CACHE_SECONDS}`);
        reply.header("content-security-policy", "default-src 'none'; sandbox");
        return reply.send(img.body);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new BadGateway("Head fetch failed.");
      }
    },
  );

  api.get(
    "/api/servers/:id/players/:name/head/info",
    {
      schema: { params: PlayerParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req): Promise<PlayerHeadInfo> => {
      requireServer(req.params.id);
      const name = requireMcName(req.params.name);
      return headInfoOf(name, await probeHead(name));
    },
  );

  // Reads the skin from Mojang, then makes the next head URL differ from every
  // earlier one, so Discord fetches the image again.
  api.post(
    "/api/servers/:id/players/:name/head/refresh",
    {
      schema: { params: PlayerParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req): Promise<PlayerHeadRefresh> => {
      requireServer(req.params.id);
      const name = requireMcName(req.params.name);
      const outcome = await resolveSkin(name);
      refreshHead(name, currentSession(req)?.uid ?? "dashboard");
      log.info("web", `Head of ${name} refreshed from the dashboard (${outcome.kind}).`);
      return { ...headInfoOf(name, await probeHead(name)), outcome: outcome.kind };
    },
  );
}

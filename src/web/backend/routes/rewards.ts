/**
 * The daily-rewards editor's server side.
 *
 *   GET/PUT /api/rewards              the shared pool (data/dailyRewards.json)
 *   POST    /api/rewards/impact       what a proposed shared pool would change per server
 *   GET/PUT /api/servers/:id/rewards  one server's exceptions (data/dailyRewards_<id>.json)
 *
 * Gated like the mod config editor: `config:read` to look, `config:write` to
 * save. A server's file needs the capability on that server; the shared pool
 * hands out items on every server, so it needs it fleet-wide (`"*"`).
 *
 * The browser sends the whole document (it is small and the editor owns its
 * layout), and the same validator the bot loads it with decides whether it
 * may be written. The file hash read with the document is the concurrency
 * token, so a hand edit or a second admin turns into a 409, not a clobber.
 *
 * A shared save may also carry, per server, entries to keep or exclude. Those
 * are written into the servers' files first (each needs `config:write` on that
 * server, checked before anything is written), the shared file last.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerIds } from "@mcbot/core/config.js";
import {
  readServerDocument,
  readSharedDocument,
  readShippedDefaults,
  writeRewardsDocument,
  RewardsWriteError,
  type RewardsScope,
} from "@mcbot/core/utils/stores/rewardsConfig.js";
import { rewardsImpact, saveSharedWithServers } from "@mcbot/core/utils/stores/rewardsSave.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import type {
  OverridePool,
  RewardPool,
  RewardsImpactResponse,
  RewardsWriteResult,
  ServerRewardsResponse,
  SharedRewardsResponse,
} from "@mcbot/schema/dailyRewards.js";
import { currentSession } from "../auth/auth.js";
import { sessionHolds } from "../auth/capabilities.js";
import { Conflict, Forbidden, HttpError, ValidationFailed } from "../errors.js";
import { IdParams, RewardsImpactBody, RewardsWriteBody, SharedRewardsWriteBody } from "./schemas.js";
import { auditedAction, requireServer } from "./support.js";

/** "12 items, 13 streak days, bonus 5 %", what the saved document holds, for the audit log. */
function describePool(pool: RewardPool): string {
  const parts: string[] = [];
  if (pool.default) parts.push(`${pool.default.length} items`);
  if (pool.streakBonuses) parts.push(`${Object.keys(pool.streakBonuses).length} streak days`);
  if (pool.bonusChance !== undefined) parts.push(`bonus ${pool.bonusChance} %`);
  return parts.length > 0 ? parts.join(", ") : "inherits everything";
}

/** What a server's file changes against the shared pool, for the audit log. */
function describeOverride(pool: OverridePool): string {
  const parts: string[] = [];
  const list = (label: string, patch: OverridePool["default"]): void => {
    if (!patch) return;
    const bits = [
      patch.add?.length ? `+${patch.add.length}` : "",
      patch.remove?.length ? `-${patch.remove.length}` : "",
      patch.set && Object.keys(patch.set).length > 0 ? `${Object.keys(patch.set).length} changed` : "",
    ].filter(Boolean);
    parts.push(`${label} ${bits.join(" ")}`);
  };
  list("items", pool.default);
  const days = Object.keys(pool.streakBonuses?.days ?? {}).length;
  const removed = pool.streakBonuses?.removeDays?.length ?? 0;
  if (days > 0) parts.push(`${days} streak days changed`);
  if (removed > 0) parts.push(`${removed} streak days removed`);
  if (pool.bonusChance !== undefined) parts.push(`bonus ${pool.bonusChance} %`);
  return parts.length > 0 ? parts.join(", ") : "inherits everything";
}

/** Turn a store failure into the API's typed errors. */
function asHttpError(err: unknown): never {
  if (err instanceof RewardsWriteError) {
    const where = err.serverId ? ` (server ${err.serverId})` : "";
    if (err.kind === "conflict") throw new Conflict(err.message + where);
    throw new ValidationFailed(err.serverId ? err.errors.map((e) => `${err.serverId}: ${e}`) : err.errors);
  }
  log.error("web", `Rewards write failed: ${errMsg(err)}`);
  throw new HttpError(500, "Could not write the reward file. Check the dashboard (web) logs for details.");
}

async function write(scope: RewardsScope, pool: unknown, baseHash: string): Promise<{ hash: string }> {
  try {
    return { hash: await writeRewardsDocument(scope, pool, baseHash) };
  } catch (err) {
    return asHttpError(err);
  }
}

export function registerRewardsRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/rewards",
    { config: { capability: "config:read", scope: "global" } },
    async (): Promise<SharedRewardsResponse> => {
      const [shared, shipped] = await Promise.all([readSharedDocument(), readShippedDefaults()]);
      return { shared, shipped };
    },
  );

  api.post(
    "/api/rewards/impact",
    {
      schema: { body: RewardsImpactBody },
      config: { capability: "config:write", scope: "global" },
    },
    async (req): Promise<RewardsImpactResponse> => {
      const session = currentSession(req);
      try {
        const rows = await rewardsImpact(req.body.pool, getServerIds());
        return {
          servers: rows.map((row) => ({ ...row, canEdit: sessionHolds(session, "config:write", row.serverId) })),
        };
      } catch (err) {
        return asHttpError(err);
      }
    },
  );

  api.put(
    "/api/rewards",
    {
      schema: { body: SharedRewardsWriteBody },
      config: { capability: "config:write", scope: "global" },
    },
    async (req): Promise<RewardsWriteResult> => {
      const selections = req.body.servers ?? {};
      const session = currentSession(req);
      for (const serverId of Object.keys(selections)) {
        requireServer(serverId);
        if (!sessionHolds(session, "config:write", serverId)) {
          throw new Forbidden(`You may not change the rewards of server "${serverId}".`);
        }
      }
      try {
        const result = await saveSharedWithServers(req.body.baseHash, req.body.pool, selections, {
          onWritten: async (serverId, pool) => {
            await auditedAction(req, {
              action: "daily rewards edit",
              ...(serverId ? { server: serverId } : {}),
              detail: serverId
                ? `override (with a shared save): ${describeOverride(pool as OverridePool)}`
                : `shared pool: ${describePool(pool as RewardPool)}`,
            });
          },
        });
        return result;
      } catch (err) {
        return asHttpError(err);
      }
    },
  );

  api.get(
    "/api/servers/:id/rewards",
    {
      schema: { params: IdParams },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req): Promise<ServerRewardsResponse> => {
      requireServer(req.params.id);
      const [override, shared] = await Promise.all([readServerDocument(req.params.id), readSharedDocument()]);
      return { override, shared: { pool: shared.pool, problems: shared.problems } };
    },
  );

  api.put(
    "/api/servers/:id/rewards",
    {
      schema: { params: IdParams, body: RewardsWriteBody },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      requireServer(req.params.id);
      const result = await write({ kind: "server", serverId: req.params.id }, req.body.pool, req.body.baseHash);
      await auditedAction(req, {
        action: "daily rewards edit",
        server: req.params.id,
        detail: `override: ${describeOverride(req.body.pool as OverridePool)}`,
      });
      return result;
    },
  );
}

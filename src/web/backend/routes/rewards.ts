/**
 * The daily-rewards editor's server side.
 *
 *   GET/PUT /api/rewards              the shared pool (data/dailyRewards.json)
 *   GET/PUT /api/servers/:id/rewards  one server's override (data/dailyRewards_<id>.json)
 *
 * Gated like the mod config editor: `config:read` to look, `config:write` to
 * save. A server's override needs the capability on that server; the shared
 * pool hands out items on every server, so it needs it fleet-wide (`"*"`).
 *
 * The browser sends the whole document (it is small and the editor owns its
 * layout), and the same validator the bot loads it with decides whether it
 * may be written. The file hash read with the document is the concurrency
 * token, so a hand edit or a second admin turns into a 409, not a clobber.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  readRewardsDocument,
  readShippedDefaults,
  writeRewardsDocument,
  RewardsWriteError,
  type RewardsScope,
} from "@mcbot/core/utils/stores/rewardsConfig.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import type {
  RewardPool,
  ServerRewardsResponse,
  SharedRewardsResponse,
} from "@mcbot/schema/dailyRewards.js";
import { Conflict, HttpError, ValidationFailed } from "../errors.js";
import { IdParams, RewardsWriteBody } from "./schemas.js";
import { auditedAction, requireServer } from "./support.js";

/** "12 items, 13 streak days, bonus 5 %" — what the saved document holds, for the audit log. */
function describePool(pool: RewardPool): string {
  const parts: string[] = [];
  if (pool.default) parts.push(`${pool.default.length} items`);
  if (pool.streakBonuses) parts.push(`${Object.keys(pool.streakBonuses).length} streak days`);
  if (pool.bonusChance !== undefined) parts.push(`bonus ${pool.bonusChance} %`);
  return parts.length > 0 ? parts.join(", ") : "inherits everything";
}

async function write(
  scope: RewardsScope,
  pool: unknown,
  baseHash: string,
): Promise<{ hash: string }> {
  try {
    return { hash: await writeRewardsDocument(scope, pool, baseHash) };
  } catch (err) {
    if (err instanceof RewardsWriteError) {
      if (err.kind === "conflict") throw new Conflict(err.message);
      throw new ValidationFailed(err.errors);
    }
    log.error("web", `Rewards write failed: ${errMsg(err)}`);
    throw new HttpError(500, "Could not write the reward file. Check the dashboard (web) logs for details.");
  }
}

export function registerRewardsRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/rewards",
    { config: { capability: "config:read", scope: "global" } },
    async (): Promise<SharedRewardsResponse> => {
      const [shared, shipped] = await Promise.all([readRewardsDocument({ kind: "shared" }), readShippedDefaults()]);
      return { shared, shipped };
    },
  );

  api.put(
    "/api/rewards",
    {
      schema: { body: RewardsWriteBody },
      config: { capability: "config:write", scope: "global" },
    },
    async (req) => {
      const result = await write({ kind: "shared" }, req.body.pool, req.body.baseHash);
      await auditedAction(req, {
        action: "daily rewards edit",
        detail: `shared pool: ${describePool(req.body.pool as RewardPool)}`,
      });
      return result;
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
      const [override, shared] = await Promise.all([
        readRewardsDocument({ kind: "server", serverId: req.params.id }),
        readRewardsDocument({ kind: "shared" }),
      ]);
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
      const result = await write(
        { kind: "server", serverId: req.params.id },
        req.body.pool,
        req.body.baseHash,
      );
      await auditedAction(req, {
        action: "daily rewards edit",
        server: req.params.id,
        detail: `override: ${describePool(req.body.pool as RewardPool)}`,
      });
      return result;
    },
  );
}

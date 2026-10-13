/**
 * Chunk pruning from the dashboard: scan for unused chunks, tune the
 * parameters, look at the map, and delete.
 *
 * Everything needs `server:update`, the same irreversible-level capability as
 * the version upgrade: a scan reads the whole world (heavy), and the delete
 * stops the server and removes generated terrain for good, with the backup the
 * job takes as the only way back. Progress of the delete is read through the
 * upgrade job routes, since it is the same kind of job.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  supportsPrune,
  startPruneScan,
  getPruneScan,
  getPruneDimensions,
  getPruneStatus,
  cancelPruneScan,
  getPruneSettings,
  setPruneSettings,
  getPruneMap,
  getPruneChunk,
  startPrune,
} from "@mcbot/core/utils/server/serverAccess.js";
import { ApiError } from "@mcbot/core/utils/server/access/apiClient.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { cached } from "@mcbot/core/utils/cache.js";
import { log } from "@mcbot/core/utils/logger.js";
import { logFields } from "@mcbot/core/utils/logSafe.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { sessionFromRequest } from "../auth/auth.js";
import { NotFound, HttpError } from "../errors.js";
import { busyKind } from "./upgrades.js";
import {
  IdParams,
  PruneApplyBody,
  PruneChunkQuery,
  PrunePlanParams,
  PruneMapParams,
  PruneParamsBody,
  PruneScanParams,
} from "./schemas.js";

const OPERATION_FAILED =
  "The operation failed unexpectedly. See the web logs for details.";

const TTL_PRUNE_SUPPORT = 60_000;

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

export function registerPruneRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  function pruneSupported(id: string, cfg: Parameters<typeof supportsPrune>[0]): Promise<boolean> {
    return cached(`prune:support:${id}`, TTL_PRUNE_SUPPORT, () => supportsPrune(cfg));
  }

  async function requireSupport(id: string, cfg: Parameters<typeof supportsPrune>[0]): Promise<void> {
    if (!(await pruneSupported(id, cfg))) {
      throw new HttpError(
        501,
        "This server's API wrapper or setup suite cannot prune chunks. Update them.",
      );
    }
  }

  /** Wrapper failures reach the client as one fixed message; the cause goes to the log. */
  function failed(what: string, id: string, err: unknown): never {
    log.error("web", `${what} failed ${logFields({ server: id, detail: errMsg(err) })}`);
    throw new HttpError(502, OPERATION_FAILED);
  }

  api.get(
    "/api/servers/:id/prune/support",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      return { supported: await pruneSupported(req.params.id, server.config) };
    },
  );

  api.get(
    "/api/servers/:id/prune/settings",
    {
      schema: { params: IdParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      try {
        return await getPruneSettings(server.config);
      } catch (err) {
        return failed("Prune settings read", req.params.id, err);
      }
    },
  );

  api.put(
    "/api/servers/:id/prune/settings",
    {
      schema: { params: IdParams, body: PruneParamsBody },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      try {
        return await setPruneSettings(server.config, req.body);
      } catch (err) {
        return failed("Prune settings save", req.params.id, err);
      }
    },
  );

  api.post(
    "/api/servers/:id/prune/scans",
    {
      schema: { params: IdParams, body: PruneParamsBody },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      try {
        return await startPruneScan(server.config, req.body);
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) {
          throw new HttpError(409, "A scan is already running. Wait for it to finish.");
        }
        return failed("Prune scan start", req.params.id, err);
      }
    },
  );

  api.get(
    "/api/servers/:id/prune/dimensions",
    {
      schema: { params: IdParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      try {
        return await getPruneDimensions(server.config);
      } catch (err) {
        return failed("Prune dimensions", req.params.id, err);
      }
    },
  );

  api.get(
    "/api/servers/:id/prune/status",
    {
      schema: { params: IdParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      try {
        return await getPruneStatus(server.config);
      } catch (err) {
        return failed("Prune status", req.params.id, err);
      }
    },
  );

  api.post(
    "/api/servers/:id/prune/scans/:jobId/cancel",
    {
      schema: { params: PruneScanParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      try {
        if (!(await cancelPruneScan(server.config, req.params.jobId))) {
          throw new NotFound("That scan is not running.");
        }
        return { cancelled: true };
      } catch (err) {
        if (err instanceof NotFound) throw err;
        return failed("Prune scan cancel", req.params.id, err);
      }
    },
  );

  api.get(
    "/api/servers/:id/prune/scans/:jobId",
    {
      schema: { params: PruneScanParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      let job;
      try {
        job = await getPruneScan(server.config, req.params.jobId);
      } catch (err) {
        return failed("Prune scan poll", req.params.id, err);
      }
      if (!job) throw new NotFound("Unknown or expired scan.");
      return job;
    },
  );

  api.get(
    "/api/servers/:id/prune/plans/:planId/chunk",
    {
      schema: { params: PrunePlanParams, querystring: PruneChunkQuery },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      const { dimension, cx, cz } = req.query;
      let info;
      try {
        info = await getPruneChunk(server.config, req.params.planId, dimension, cx, cz);
      } catch (err) {
        return failed("Prune chunk read", req.params.id, err);
      }
      if (!info) throw new NotFound("That scan has expired. Scan again.");
      return info;
    },
  );

  api.get(
    "/api/servers/:id/prune/plans/:planId/map/:index",
    {
      schema: { params: PruneMapParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      let map;
      try {
        map = await getPruneMap(server.config, req.params.planId, Number(req.params.index));
      } catch (err) {
        return failed("Prune map read", req.params.id, err);
      }
      if (!map) throw new NotFound("That scan has expired. Scan again.");
      return map;
    },
  );

  api.post(
    "/api/servers/:id/prune",
    {
      schema: { params: IdParams, body: PruneApplyBody },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await requireSupport(req.params.id, server.config);
      const session = sessionFromRequest(req)!;
      // Recorded before it runs, like every irreversible action here.
      await recordAdminAction({
        action: "chunk prune (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: req.body.planId,
      });
      try {
        return await startPrune(server.config, req.body.planId, req.body.countdownSeconds);
      } catch (err) {
        if (err instanceof ApiError && err.status === 423) {
          throw new HttpError(
            409,
            `The server is busy (${busyKind(err.message)}). Try again when it has finished.`,
          );
        }
        return failed("Prune start", req.params.id, err);
      }
    },
  );
}

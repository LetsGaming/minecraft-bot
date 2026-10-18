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
  getPruneTile,
  startPrune,
} from "@mcbot/core/utils/server/serverAccess.js";
import { ApiError } from "@mcbot/core/utils/server/access/apiClient.js";
import { NotFound, Conflict } from "../errors.js";
import { busyConflict } from "./busy.js";
import { capabilityProbe } from "./capabilityProbe.js";
import { auditedAction, requireServer, wrapperCall } from "./support.js";
import {
  IdParams,
  PruneApplyBody,
  PruneChunkQuery,
  PrunePlanParams,
  PruneMapParams,
  PruneParamsBody,
  PruneTileParams,
  PruneScanParams,
} from "./schemas.js";

const pruneProbe = capabilityProbe(
  "prune",
  (cfg) => supportsPrune(cfg),
  "This server's API wrapper or setup suite cannot prune chunks. Update them.",
);

export function registerPruneRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/prune/support",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      return { supported: await pruneProbe.supported(req.params.id, server.config) };
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      return wrapperCall("Prune settings read", { server: req.params.id }, () => getPruneSettings(server.config));
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      return wrapperCall("Prune settings save", { server: req.params.id }, () =>
        setPruneSettings(server.config, req.body),
      );
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      return wrapperCall("Prune scan start", { server: req.params.id }, () => startPruneScan(server.config, req.body), {
        translate: (err) =>
          err instanceof ApiError && err.status === 429
            ? new Conflict("A scan is already running. Wait for it to finish.")
            : null,
      });
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      return wrapperCall("Prune dimensions", { server: req.params.id }, () => getPruneDimensions(server.config));
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      return wrapperCall("Prune status", { server: req.params.id }, () => getPruneStatus(server.config));
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      return wrapperCall("Prune scan cancel", { server: req.params.id }, async () => {
        if (!(await cancelPruneScan(server.config, req.params.jobId))) {
          throw new NotFound("That scan is not running.");
        }
        return { cancelled: true };
      });
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
      const job = await wrapperCall("Prune scan poll", { server: req.params.id }, () =>
        getPruneScan(server.config, req.params.jobId),
      );
      if (!job) throw new NotFound("Unknown or expired scan.");
      return job;
    },
  );

  api.get(
    "/api/servers/:id/prune/tiles/:dimension/:rx/:rz",
    {
      schema: { params: PruneTileParams },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req, reply) => {
      const server = requireServer(req.params.id);
      await pruneProbe.requireSupport(req.params.id, server.config);
      const { dimension, rx, rz } = req.params;
      const tile = await wrapperCall("Prune tile read", { server: req.params.id }, () =>
        getPruneTile(server.config, dimension, rx, rz),
      );
      if (!tile) throw new NotFound("That region does not exist.");
      reply.header("cache-control", "private, max-age=0, must-revalidate");
      if (tile.etag) {
        reply.header("etag", tile.etag);
        if (req.headers["if-none-match"] === tile.etag) return reply.status(304).send();
      }
      return reply.type("image/png").send(tile.png);
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      const { dimension, cx, cz } = req.query;
      const info = await wrapperCall("Prune chunk read", { server: req.params.id }, () =>
        getPruneChunk(server.config, req.params.planId, dimension, cx, cz),
      );
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
      const map = await wrapperCall("Prune map read", { server: req.params.id }, () =>
        getPruneMap(server.config, req.params.planId, Number(req.params.index)),
      );
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
      await pruneProbe.requireSupport(req.params.id, server.config);
      // Recorded before it runs, like every irreversible action here.
      await auditedAction(req, {
        action: "chunk prune",
        server: req.params.id,
        detail: req.body.planId,
      });
      return wrapperCall(
        "Prune start",
        { server: req.params.id },
        () => startPrune(server.config, req.body.planId, req.body.countdownSeconds),
        { translate: busyConflict },
      );
    },
  );
}

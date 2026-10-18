/**
 * Minecraft version upgrade, from the dashboard.
 *
 * The wrapper runs the whole job (stop, backup, install, start, fall back to
 * disabling mods and then to the backup); this proxies its start and progress
 * routes. `server:update` is irreversible-level: the server goes down, the
 * world is converted to the new version on first start, and going back means
 * losing what happened since. Progress reads only need `server:read`.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  supportsUpgrade,
  startUpgrade,
  getUpgrade,
  getCurrentUpgrade,
} from "@mcbot/core/utils/server/serverAccess.js";
import { ApiError } from "@mcbot/core/utils/server/access/apiClient.js";
import { NotFound, Conflict } from "../errors.js";
import { IdParams, UpgradeStartBody, UpgradeJobParams, UpgradePollQuery } from "./schemas.js";
import { busyConflict } from "./busy.js";
import { capabilityProbe } from "./capabilityProbe.js";
import { auditedAction, requireServer, wrapperCall } from "./support.js";

const upgradeProbe = capabilityProbe(
  "upgrade",
  (cfg) => supportsUpgrade(cfg),
  "This server's API wrapper or setup suite cannot upgrade the Minecraft version. Update them.",
);

function sinceOf(query: { since?: string }): number {
  return query.since ? Number(query.since) : 0;
}

export function registerUpgradeRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/upgrade/support",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      return { supported: await upgradeProbe.supported(req.params.id, server.config) };
    },
  );

  api.post(
    "/api/servers/:id/upgrade",
    {
      schema: { params: IdParams, body: UpgradeStartBody },
      config: { capability: "server:update", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await upgradeProbe.requireSupport(req.params.id, server.config);
      // Recorded before it runs: what was attempted is the fact people ask
      // about afterwards, whether or not the job got as far as starting.
      await auditedAction(req, {
        action: "server upgrade",
        server: req.params.id,
        detail: req.body.prunePlan ? `${req.body.mcVersion} + prune ${req.body.prunePlan}` : req.body.mcVersion,
      });
      return wrapperCall(
        "Upgrade start",
        { server: req.params.id, mcVersion: req.body.mcVersion },
        () =>
          startUpgrade(server.config, {
            mcVersion: req.body.mcVersion,
            ...(req.body.expectUnavailable ? { expectUnavailable: req.body.expectUnavailable } : {}),
            ...(req.body.countdownSeconds !== undefined
              ? { countdownSeconds: req.body.countdownSeconds }
              : {}),
            ...(req.body.prunePlan ? { prunePlan: req.body.prunePlan } : {}),
          }),
        {
          translate: (err) => {
            if (err instanceof ApiError && err.status === 404 && req.body.prunePlan) {
              return new Conflict("The stored prune plan is gone. Scan again, then start the upgrade.");
            }
            return busyConflict(err);
          },
        },
      );
    },
  );

  api.get(
    "/api/servers/:id/upgrade/current",
    {
      schema: { params: IdParams, querystring: UpgradePollQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const job = await wrapperCall("Upgrade poll", { server: req.params.id }, () =>
        getCurrentUpgrade(server.config, sinceOf(req.query)),
      );
      // "Nothing has run" is the normal state of a page that just opened, so it is an
      // answer, not a 404 that every visit would print in the browser console.
      return { job: job ?? null };
    },
  );

  api.get(
    "/api/servers/:id/upgrade/:jobId",
    {
      schema: { params: UpgradeJobParams, querystring: UpgradePollQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const job = await wrapperCall(
        "Upgrade poll",
        { server: req.params.id, job: req.params.jobId },
        () => getUpgrade(server.config, req.params.jobId, sinceOf(req.query)),
      );
      if (!job) throw new NotFound("Unknown or expired upgrade.");
      return job;
    },
  );
}

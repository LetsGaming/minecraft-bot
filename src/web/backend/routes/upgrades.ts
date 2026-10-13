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
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  supportsUpgrade,
  startUpgrade,
  getUpgrade,
  getCurrentUpgrade,
} from "@mcbot/core/utils/server/serverAccess.js";
import { ApiError } from "@mcbot/core/utils/server/access/apiClient.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { cached } from "@mcbot/core/utils/cache.js";
import { log } from "@mcbot/core/utils/logger.js";
import { logFields } from "@mcbot/core/utils/logSafe.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { isRecord } from "@mcbot/core/utils/objects.js";
import { sessionFromRequest } from "../auth/auth.js";
import { NotFound, HttpError } from "../errors.js";
import { IdParams, UpgradeStartBody, UpgradeJobParams, UpgradePollQuery } from "./schemas.js";

const OPERATION_FAILED =
  "The operation failed unexpectedly. See the web logs for details.";

const TTL_UPGRADE_SUPPORT = 60_000;

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

/** What holds the instance, from a 423 error message; "another operation" when it cannot be read. */
export function busyKind(message: string): string {
  const start = message.indexOf("{");
  if (start === -1) return "another operation";
  try {
    const parsed: unknown = JSON.parse(message.slice(start));
    if (isRecord(parsed) && isRecord(parsed.busy) && typeof parsed.busy.kind === "string") {
      return parsed.busy.kind;
    }
  } catch {
    /* fall through */
  }
  return "another operation";
}

function sinceOf(query: { since?: string }): number {
  return query.since ? Number(query.since) : 0;
}

export function registerUpgradeRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  function upgradeSupported(
    id: string,
    cfg: Parameters<typeof supportsUpgrade>[0],
  ): Promise<boolean> {
    return cached(`upgrade:support:${id}`, TTL_UPGRADE_SUPPORT, () => supportsUpgrade(cfg));
  }

  api.get(
    "/api/servers/:id/upgrade/support",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      return { supported: await upgradeSupported(req.params.id, server.config) };
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
      if (!(await upgradeSupported(req.params.id, server.config))) {
        throw new HttpError(
          501,
          "This server's API wrapper or setup suite cannot upgrade the Minecraft version. Update them.",
        );
      }
      const session = sessionFromRequest(req)!;
      // Recorded before it runs: what was attempted is the fact people ask
      // about afterwards, whether or not the job got as far as starting.
      await recordAdminAction({
        action: "server upgrade (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: req.body.prunePlan ? `${req.body.mcVersion} + prune ${req.body.prunePlan}` : req.body.mcVersion,
      });
      try {
        return await startUpgrade(server.config, {
          mcVersion: req.body.mcVersion,
          ...(req.body.expectUnavailable ? { expectUnavailable: req.body.expectUnavailable } : {}),
          ...(req.body.countdownSeconds !== undefined
            ? { countdownSeconds: req.body.countdownSeconds }
            : {}),
          ...(req.body.prunePlan ? { prunePlan: req.body.prunePlan } : {}),
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 423) {
          throw new HttpError(
            409,
            `The server is busy (${busyKind(err.message)}). Try again when it has finished.`,
          );
        }
        if (err instanceof ApiError && err.status === 404 && req.body.prunePlan) {
          throw new HttpError(409, "The stored prune plan is gone. Scan again, then start the upgrade.");
        }
        log.error(
          "web",
          `Upgrade start failed ${logFields({ server: req.params.id, mcVersion: req.body.mcVersion, detail: errMsg(err) })}`,
        );
        throw new HttpError(502, OPERATION_FAILED);
      }
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
      let job;
      try {
        job = await getCurrentUpgrade(server.config, sinceOf(req.query));
      } catch (err) {
        log.error("web", `Upgrade poll failed ${logFields({ server: req.params.id, detail: errMsg(err) })}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
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
      let job;
      try {
        job = await getUpgrade(server.config, req.params.jobId, sinceOf(req.query));
      } catch (err) {
        log.error(
          "web",
          `Upgrade poll failed ${logFields({ server: req.params.id, job: req.params.jobId, detail: errMsg(err) })}`,
        );
        throw new HttpError(502, OPERATION_FAILED);
      }
      if (!job) throw new NotFound("Unknown or expired upgrade.");
      return job;
    },
  );
}

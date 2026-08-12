/**
 * DSH-03/DSH-04 — the backup panel's server side: list, download, restore.
 *
 * Every one of these proxies the wrapper. That is not indirection for its own
 * sake: the wrapper's API key authenticates the request and must never reach a
 * browser, so the connection terminates here and the dashboard relays. The
 * cost is that a multi-gigabyte archive passes through this process, and the
 * whole design of the download route below is about paying that cost in
 * constant memory rather than in a heap the size of the world.
 *
 * Three capabilities, not one, because these differ by more than degree:
 * listing is metadata, downloading takes the entire world off the host, and
 * restoring destroys the current one.
 */
import { Readable } from "stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  indexBackupFiles,
  openBackupDownload,
  restoreBackupFile,
} from "@mcbot/core/utils/server/serverAccess.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { recordIntent } from "@mcbot/core/utils/wrapper/deferredIntents.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { sessionFromRequest } from "../auth/auth.js";
import { BadRequest, NotFound, HttpError } from "../errors.js";
import { IdParams, BackupFileParams, BackupIndexQuery } from "./schemas.js";

const OPERATION_FAILED =
  "The operation failed unexpectedly — see the bot logs for details.";

/** Ids are 22 base64url chars, produced by the wrapper's index. */
const FILE_ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** Headers worth passing straight through from the wrapper's response. */
const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "content-range",
  "accept-ranges",
] as const;

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

function requireFileId(fileId: string): string {
  if (!FILE_ID_RE.test(fileId)) throw new BadRequest("Invalid backup id.");
  return fileId;
}

export function registerBackupRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/backups/files",
    {
      schema: { params: IdParams, querystring: BackupIndexQuery },
      // Metadata, at the same level as the log tail: filenames, sizes, dates.
      // Taking the archive off the host is backup:download, below.
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const limit = parseInt(req.query.limit ?? "50", 10);
      const opts = {
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
        limit: Number.isNaN(limit) ? 50 : Math.min(Math.max(limit, 1), 200),
      };
      try {
        // Only the first page is remembered. A cursor points into a listing
        // that no longer exists once the wrapper is gone, so replaying one
        // from cache would hand back a page that never joins up.
        if (req.query.cursor) return await indexBackupFiles(server.config, opts);
        const { value, stale } = await readThrough(
          req.params.id,
          "backupIndex",
          () => indexBackupFiles(server.config, opts),
        );
        return { ...value, stale };
      } catch (err) {
        log.error("web", `Backup index for ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  api.get(
    "/api/servers/:id/backups/files/:fileId/download",
    {
      schema: { params: BackupFileParams },
      config: { capability: "backup:download", scope: "server", param: "id" },
    },
    async (req, reply): Promise<FastifyReply> => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId);

      const session = sessionFromRequest(req)!;
      // Audited: a download is the whole world leaving the host, which is the
      // one backup operation that leaves no trace on the server itself.
      await recordAdminAction({
        action: "backup download (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: fileId,
      });

      let upstream: Response;
      try {
        // Range is forwarded verbatim so a browser resuming an interrupted
        // download reaches the wrapper with its request intact.
        upstream = await openBackupDownload(server.config, fileId, req.headers.range);
      } catch (err) {
        log.error("web", `Backup download for ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }

      if (upstream.status === 404) throw new NotFound("Backup not found.");
      if (!upstream.ok && upstream.status !== 206) {
        // 416 and friends carry meaning the browser acts on; pass the status
        // through rather than flattening every one into a 502.
        void upstream.body?.cancel();
        return reply.status(upstream.status).send({ error: "Download failed." });
      }
      if (!upstream.body) throw new HttpError(502, OPERATION_FAILED);

      for (const header of FORWARDED_HEADERS) {
        const value = upstream.headers.get(header);
        if (value !== null) void reply.header(header, value);
      }

      // The line this whole route exists to get right: pipe the body through,
      // never `await upstream.arrayBuffer()`. A 4 GB world read into memory to
      // be handed on is an OOM, and Content-Length is already set above, so
      // the browser draws its own progress bar from it.
      return reply
        .status(upstream.status)
        .send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
    },
  );

  api.post(
    "/api/servers/:id/backups/files/:fileId/restore",
    {
      schema: { params: BackupFileParams },
      config: { capability: "backup:restore", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId);

      const session = sessionFromRequest(req)!;
      // Recorded before it runs. What was attempted is the interesting fact,
      // and a restore that fails halfway is exactly when someone will ask.
      await recordAdminAction({
        action: "backup restore (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: fileId,
      });

      try {
        const result = await restoreBackupFile(server.config, fileId);
        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          output: result.output.slice(-4000),
          stderr: result.stderr.slice(-4000),
        };
      } catch (err) {
        // A restore is the most destructive thing here, so it is the last
        // thing that should ever replay unattended: a restore queued at 14:00
        // and applied at 17:00 discards three hours of play nobody agreed to
        // lose. Remembered as an intent, never as a queued action.
        recordIntent({
          serverId: req.params.id,
          action: "restore",
          target: fileId,
          attemptedAt: Date.now(),
          byTag: sessionFromRequest(req)!.tag,
          reason: errMsg(err),
        });
        log.error("web", `Restore on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );
}

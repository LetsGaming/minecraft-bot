/**
 * DSH-03/DSH-04: the backup panel's server side: summary, list, download, restore, delete.
 *
 * Every one of these proxies the wrapper. That is not indirection for its own
 * sake: the wrapper's API key authenticates the request and must never reach a
 * browser, so the connection terminates here and the dashboard relays. The
 * cost is that a multi-gigabyte archive passes through this process, and the
 * whole design of the download route below is about paying that cost in
 * constant memory rather than in a heap the size of the world.
 *
 * Four capabilities, not one, because these differ by more than degree:
 * listing is metadata, downloading takes the entire world off the host,
 * restoring destroys the current one, and deleting is permanent.
 */
import { Readable } from "stream";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  readBackups,
  indexBackupFiles,
  openBackupDownload,
  restoreBackupFile,
  deleteBackupFile,
  classifyScriptFailure,
} from "@mcbot/core/utils/server/serverAccess.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readThrough, forget } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { recordIntent } from "@mcbot/core/utils/wrapper/deferredIntents.js";
import { scriptFailureError, scriptResultBody } from "./scriptFailure.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { BadGateway, HttpError, NotFound } from "../errors.js";
import { IdParams, BackupFileParams, BackupIndexQuery } from "./schemas.js";
import { clampIntParam } from "./query.js";
import {
  OPERATION_FAILED,
  auditedAction,
  requireFileId,
  requireServer,
  wrapperCall,
} from "./support.js";
import type { BackupSummaryBody } from "@mcbot/schema/wire/index.js";

const BACKUP_ID_LABEL = "backup";
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Headers worth passing straight through from the wrapper's response. */
const FORWARDED_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "content-range",
  "accept-ranges",
] as const;

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
      const opts = {
        ...(req.query.cursor ? { cursor: req.query.cursor } : {}),
        limit: clampIntParam(req.query.limit, {
          def: DEFAULT_PAGE_SIZE,
          min: 1,
          max: MAX_PAGE_SIZE,
        }),
      };
      return wrapperCall("Backup index", { server: req.params.id }, async () => {
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
      });
    },
  );

  api.get(
    "/api/servers/:id/backups/summary",
    {
      schema: { params: IdParams },
      // Counts, sizes and the newest name per folder: the same metadata level
      // as the index above.
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      return wrapperCall("Backup summary", { server: req.params.id }, async () => {
        const { value, stale } = await readThrough(
          req.params.id,
          "backupSummary",
          async (): Promise<BackupSummaryBody> => {
            const summary = await readBackups(server.config);
            return {
              dirs: summary.dirs.map((d) => ({
                dir: d.dir,
                count: d.count,
                latestFile: d.latestFile,
                latestMtimeMs: d.latestMtime.getTime(),
                latestSizeBytes: d.latestSizeBytes,
              })),
              totalBytes: summary.totalBytes,
            };
          },
        );
        return { ...value, stale };
      });
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
      const fileId = requireFileId(req.params.fileId, BACKUP_ID_LABEL);

      // Audited: a download is the whole world leaving the host, which is the
      // one backup operation that leaves no trace on the server itself.
      await auditedAction(req, {
        action: "backup download",
        server: req.params.id,
        detail: fileId,
      });

      // Range is forwarded verbatim so a browser resuming an interrupted
      // download reaches the wrapper with its request intact.
      const upstream = await wrapperCall("Backup download", { server: req.params.id }, () =>
        openBackupDownload(server.config, fileId, req.headers.range),
      );

      if (upstream.status === 404) throw new NotFound("Backup not found.");
      if (!upstream.ok && upstream.status !== 206) {
        // 416 and friends carry meaning the browser acts on; pass the status
        // through rather than flattening every one into a 502.
        void upstream.body?.cancel();
        return reply.status(upstream.status).send({ error: "Download failed." });
      }
      if (!upstream.body) throw new BadGateway(OPERATION_FAILED);

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
      const fileId = requireFileId(req.params.fileId, BACKUP_ID_LABEL);

      // Recorded before it runs. What was attempted is the interesting fact,
      // and a restore that fails halfway is exactly when someone will ask.
      const session = await auditedAction(req, {
        action: "backup restore",
        server: req.params.id,
        detail: fileId,
      });

      try {
        return scriptResultBody(await restoreBackupFile(server.config, fileId));
      } catch (err) {
        log.error("web", `Restore on ${req.params.id} failed: ${errMsg(err)}`);
        const failure = classifyScriptFailure(err);
        if (failure.kind !== "unreachable") throw scriptFailureError("restore", failure);
        // A restore is the most destructive thing here, so it is the last
        // thing that should ever replay unattended: a restore queued at 14:00
        // and applied at 17:00 discards three hours of play nobody agreed to
        // lose. Remembered as an intent, never as a queued action.
        recordIntent({
          serverId: req.params.id,
          action: "restore",
          target: fileId,
          attemptedAt: Date.now(),
          byTag: session.tag,
          reason: errMsg(err),
        });
        throw new HttpError(
          503,
          "The wrapper did not answer, so the restore did not run. It is offered again once the wrapper is back.",
        );
      }
    },
  );

  api.delete(
    "/api/servers/:id/backups/files/:fileId",
    {
      schema: { params: BackupFileParams },
      config: { capability: "backup:delete", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId, BACKUP_ID_LABEL);

      // Recorded before it runs, same as restore: what was attempted is
      // the fact someone will come looking for.
      await auditedAction(req, {
        action: "backup delete",
        server: req.params.id,
        detail: fileId,
      });

      // Deliberately NOT recordIntent(), unlike restore above. A replayed
      // restore just re-applies an old backup; a replayed delete could
      // destroy an archive after rotation has already removed the ones
      // around it: the deferred version is strictly worse than the
      // failure it would be standing in for.
      return wrapperCall("Backup delete", { server: req.params.id }, async () => {
        const result = await deleteBackupFile(server.config, fileId);
        if (!result.ok) throw new NotFound("Backup not found.");
        forget(req.params.id, "backupIndex");
        forget(req.params.id, "backupSummary");
        return { ok: true, name: result.name ?? null };
      });
    },
  );
}

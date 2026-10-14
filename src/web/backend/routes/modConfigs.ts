/**
 * The mod config editor's server side.
 *
 * This is the feature the whole capability system was built for: someone who
 * may tune a mod's spawn rate and nothing else. `config:read` and
 * `config:write` are per server, so that grant hands out exactly this view and
 * no console, no backups, no config.json.
 *
 * The split with the wrapper: it serves bytes, this parses them. Format quirks
 * live here, in `@mcbot/core/utils/configfmt`, because a wrapper release is a
 * deploy on every Minecraft host and TOML dialects are not worth that.
 *
 * Writes go through the splicing writer rather than a serializer, so a save
 * changes the values that changed and leaves comments, key order and spacing
 * byte-identical. In a Forge config those comments are the only documentation
 * the mod author wrote, losing them makes the file unreadable for exactly the
 * person this editor exists to serve.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  indexConfigFiles,
  readConfigFile,
  writeConfigFile,
  revertConfigFile,
  wrapperFeatureVersion,
} from "@mcbot/core/utils/server/serverAccess.js";
import {
  applyConfigEdits,
  formatFor,
  parseConfig,
  schemaFromConfig,
  ConfigEditError,
  type ConfigEdit,
} from "@mcbot/core/utils/configfmt/index.js";
import {
  ConfigAccessError,
  type ConfigAccessErrorKind,
} from "@mcbot/core/utils/server/configAccessError.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { sessionFromRequest, isSysadmin } from "../auth/auth.js";
import { BadRequest, Forbidden, NotFound, HttpError } from "../errors.js";
import {
  IdParams,
  ConfigFileParams,
  ConfigReadQuery,
  ModConfigWriteBody,
  ModConfigRevertBody,
  QueueResolveBody,
} from "./schemas.js";
import { readThrough, forget, recall } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { cached, invalidate } from "@mcbot/core/utils/cache.js";
import type { QueuedWriteResult } from "@mcbot/schema/contract.js";
import {
  queueEdits,
  pendingForServer,
  dropForFile,
  rebaseEdit,
  dropEditByKey,
} from "@mcbot/core/utils/stores/queuedEdits.js";
import { flushQueuedEdits, previewQueuedEdits } from "@mcbot/core/utils/wrapper/queueFlush.js";

const OPERATION_FAILED =
  "The operation failed unexpectedly, see the bot logs for details.";

const FILE_ID_RE = /^[A-Za-z0-9_-]{22}$/;

const ACCESS_STATUS: Record<ConfigAccessErrorKind, number> = {
  "too-large": 413,
  "not-found": 404,
  stale: 409,
  "precondition-required": 409,
  "rate-limited": 429,
  rejected: 400,
  protected: 403,
};

/** Turn a wrapper refusal into an HTTP error carrying its explanation; other errors pass through. */
function accessFailure(err: unknown): unknown {
  return err instanceof ConfigAccessError
    ? new HttpError(ACCESS_STATUS[err.kind], err.message)
    : err;
}

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

function requireFileId(fileId: string): string {
  if (!FILE_ID_RE.test(fileId)) throw new BadRequest("Invalid config id.");
  return fileId;
}

/**
 * AUD-009: files that hold credentials (`rcon.password`, plugin tokens and
 * database passwords) or decide who may join and command the server.
 */
function holdsSecrets(relPath: string): boolean {
  return relPath === "server.properties" || relPath.startsWith("plugins/");
}

function requestIsSysadmin(req: FastifyRequest): boolean {
  const session = sessionFromRequest(req);
  return session !== null && isSysadmin(session);
}

/**
 * May this request see and edit {@link holdsSecrets} files? A sysadmin
 * always may. Anyone else only behind a wrapper with mod-configs v2, which
 * redacts secret values on read and refuses changes to protected
 * `server.properties` keys unless the bot passes `allowProtected` (which it
 * does for sysadmins only). An older wrapper serves those files verbatim,
 * so `config:read` would hand out the RCON password.
 */
async function mayTouchSecretFiles(
  req: FastifyRequest,
  server: NonNullable<ReturnType<typeof getServerInstance>>,
): Promise<boolean> {
  if (requestIsSysadmin(req)) return true;
  return (await wrapperFeatureVersion(server.config, "mod-configs")) >= 2;
}

const SECRET_FILE_REFUSED =
  "This file can hold passwords and access settings. Only a bot administrator can open it on this server.";

/**
 * Hold a write until the wrapper is back.
 *
 * The base value for each key is taken from the cached copy of the file,
 * which is exactly the document the operator was editing, since the read that
 * populated their form came from the same cache. That makes the recorded base
 * an honest answer to "what did they think it was", which is the whole basis
 * of the per-field conflict check on flush.
 *
 * Returns null when there is no cached copy: without a base there is nothing
 * to detect a conflict against, and queueing an edit that can only ever be
 * applied blindly is worse than refusing it.
 */
function queueFromCache(
  serverId: string,
  fileId: string,
  edits: ConfigEdit[],
  etag: string,
  session: { uid: string; tag: string } | null,
  maySecretFiles: boolean,
): { count: number; response: QueuedWriteResult } | null {
  const cached = recall<{
    file: { relPath: string; editable?: boolean };
    text: string;
    etag: string;
  }>(serverId, `configFile:${fileId}`, "queueing a write");
  if (!cached) return null;

  // AUD-013: the same checks a live save makes. An editor working from an
  // older copy than the cached one would otherwise overwrite a newer change
  // on flush without ever seeing a conflict.
  if (cached.value.etag !== etag) {
    throw new HttpError(
      409,
      "This file changed since you opened it. Reload and re-apply your changes.",
    );
  }
  if (holdsSecrets(cached.value.file.relPath) && !maySecretFiles) {
    throw new Forbidden(SECRET_FILE_REFUSED);
  }
  const parsed = parseConfig(cached.value.file.relPath, cached.value.text);
  if (parsed.warning || cached.value.file.editable === false) {
    throw new BadRequest(parsed.warning ?? "This file is read-only in the editor.");
  }
  try {
    applyConfigEdits(cached.value.file.relPath, cached.value.text, edits);
  } catch (err) {
    if (err instanceof ConfigEditError) throw new BadRequest(err.message);
    throw err;
  }

  const baseByKey = new Map(
    parsed.nodes.map((node) => [JSON.stringify(node.path), node.value] as const),
  );

  const queuedAt = Date.now();
  queueEdits(
    serverId,
    fileId,
    cached.value.file.relPath,
    edits.map((edit) => ({
      keyPath: edit.path,
      newValue: edit.value,
      baseValue: baseByKey.get(JSON.stringify(edit.path)) ?? null,
    })),
    session ? { id: session.uid, tag: session.tag } : null,
    queuedAt,
  );

  return {
    count: edits.length,
    response: { queued: true, queuedAt, keys: edits.map((e) => e.path) },
  };
}

/** A one-line summary of what changed, for the audit log. */
function describeEdits(edits: ConfigEdit[]): string {
  return edits
    .slice(0, 6)
    .map((e) => `${e.path.join(".")}=${JSON.stringify(e.value)}`)
    .join(", ")
    .slice(0, 300);
}

export function registerModConfigRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get(
    "/api/servers/:id/configs",
    {
      schema: { params: IdParams },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      try {
        // The listing survives a wrapper blip: which files exist changes far
        // more slowly than the wrapper's availability, and an editor that
        // disappears mid-outage is useless exactly when it is wanted.
        const TTL_CONFIG_INDEX = 15_000;
        const { value, stale } = await readThrough(
          req.params.id,
          "configIndex",
          () => cached(`configIndex:${req.params.id}`, TTL_CONFIG_INDEX, () => indexConfigFiles(server.config)),
        );
        const files = (await mayTouchSecretFiles(req, server))
          ? value.files
          : value.files.filter((f) => !holdsSecrets(f.relPath));
        return { files, truncated: value.truncated, stale };
      } catch (err) {
        if (err instanceof ConfigAccessError) throw accessFailure(err);
        log.error("web", `Config index for ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  api.get(
    "/api/servers/:id/configs/:fileId",
    {
      schema: { params: ConfigFileParams, querystring: ConfigReadQuery },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId);

      let contents;
      let stale;
      try {
        const TTL_CONFIG_FILE = 10_000;
        const read = await readThrough(
          req.params.id,
          `configFile:${fileId}`,
          () => cached(`configFile:${req.params.id}:${fileId}`, TTL_CONFIG_FILE, () => readConfigFile(server.config, fileId)),
        );
        contents = read.value;
        stale = read.stale;
      } catch (err) {
        if (err instanceof ConfigAccessError) throw accessFailure(err);
        log.error("web", `Config read on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }

      if (holdsSecrets(contents.file.relPath) && !(await mayTouchSecretFiles(req, server))) {
        throw new Forbidden(SECRET_FILE_REFUSED);
      }

      // Parsed here, not in the wrapper. The schema comes out of the file's own
      // comments where the format has them (Forge, NeoForge) and is inferred
      // from key names and value types where it does not (Fabric).
      const parsed = parseConfig(contents.file.relPath, contents.text);
      const fields = schemaFromConfig(parsed);
      const supported = formatFor(contents.file.relPath, contents.text) !== null;
      // The raw text is sent when asked for, and always for a file the form
      // cannot represent, where the source is all there is to show.
      const withText = req.query.text === "1" || !supported || fields.length === 0;
      return {
        file: contents.file,
        etag: contents.etag,
        snapshots: contents.snapshots,
        fields,
        supported,
        readOnly: !supported || Boolean(parsed.warning) || contents.file.editable === false,
        ...(parsed.warning ? { warning: parsed.warning } : {}),
        ...(withText ? { text: contents.text } : {}),
        stale,
      };
    },
  );

  api.get(
    "/api/servers/:id/configs-queue",
    {
      schema: { params: IdParams },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req) => ({ pending: pendingForServer(req.params.id) }),
  );

  api.get(
    "/api/servers/:id/configs-queue/preview",
    {
      schema: { params: IdParams },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req) => previewQueuedEdits(req.params.id),
  );

  api.post(
    "/api/servers/:id/configs-queue/flush",
    {
      schema: { params: IdParams },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      const session = sessionFromRequest(req)!;
      return flushQueuedEdits(req.params.id, { tag: session.tag, uid: session.uid });
    },
  );

  api.post(
    "/api/servers/:id/configs-queue/resolve",
    {
      schema: { params: IdParams, body: QueueResolveBody },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      const { fileId, keyPath, choice, currentValue } = req.body;
      requireFileId(fileId);
      if (choice === "current") {
        // Keep what is on disk: the queued edit is abandoned entirely.
        dropEditByKey(req.params.id, fileId, keyPath);
      } else {
        // Keep mine: the edit stands, but its baseline moves to what is on
        // disk now, so the next flush sees an untouched key and writes it.
        rebaseEdit(req.params.id, fileId, keyPath, currentValue ?? null);
      }
      return { ok: true };
    },
  );

  api.delete(
    "/api/servers/:id/configs-queue/:fileId",
    {
      schema: { params: ConfigFileParams },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      // Abandoning queued edits is a real choice, an operator who has since
      // fixed the value by hand should not be forced to resolve a conflict.
      dropForFile(req.params.id, requireFileId(req.params.fileId));
      return { ok: true };
    },
  );

  api.put(
    "/api/servers/:id/configs/:fileId",
    {
      schema: { params: ConfigFileParams, body: ModConfigWriteBody },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId);
      const edits = req.body.edits as ConfigEdit[];
      if (edits.length === 0) throw new BadRequest("No changes to apply.");

      let current;
      try {
        current = await readConfigFile(server.config, fileId);
      } catch (err) {
        // The wrapper is not answering, so this write cannot land now. Hold
        // it instead of discarding it: the operator could see this file (the
        // read fell back to cache), so refusing their edit outright would
        // mean showing someone data they are then forbidden to act on.
        if (err instanceof ConfigAccessError) throw accessFailure(err);
        const queued = queueFromCache(
          req.params.id,
          fileId,
          edits,
          req.body.etag,
          sessionFromRequest(req),
          await mayTouchSecretFiles(req, server),
        );
        if (queued) {
          log.warn(
            "web",
            `Config write on ${req.params.id} queued (${queued.count} key(s)): ${errMsg(err)}`,
          );
          return queued.response;
        }
        log.error("web", `Config read on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }

      // Re-read and re-splice server-side rather than trusting a whole file
      // from the browser: the client sends the values it changed, never the
      // document. A client that could post arbitrary text would make every
      // guard in the writer decorative.
      if (current.etag !== req.body.etag) {
        throw new HttpError(
          409,
          "This file changed since you opened it. Reload and re-apply your changes.",
        );
      }

      if (holdsSecrets(current.file.relPath) && !(await mayTouchSecretFiles(req, server))) {
        throw new Forbidden(SECRET_FILE_REFUSED);
      }

      const parsedNow = parseConfig(current.file.relPath, current.text);
      if (parsedNow.warning || current.file.editable === false) {
        throw new BadRequest(
          parsedNow.warning ?? "This file is read-only in the editor.",
        );
      }

      let next: string;
      try {
        next = applyConfigEdits(current.file.relPath, current.text, edits);
      } catch (err) {
        if (err instanceof ConfigEditError) throw new BadRequest(err.message);
        throw err;
      }

      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "mod config edit (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: `${current.file.relPath}: ${describeEdits(edits)}`,
      });

      try {
        const result = await writeConfigFile(
          server.config,
          fileId,
          next,
          current.etag,
          { allowProtected: requestIsSysadmin(req) },
        );
        if (!result.ok) {
          throw new HttpError(
            409,
            "This file changed while saving. Reload and re-apply your changes.",
          );
        }
        // The file we cached is now the old one. Dropping both entries means
        // the next read goes live and cannot serve a value this write
        // superseded, a stale answer is acceptable, a wrong one is not.
        forget(req.params.id, `configFile:${fileId}`);
        forget(req.params.id, "configIndex");
        invalidate(`configFile:${req.params.id}:${fileId}`);
        invalidate(`configIndex:${req.params.id}`);
        return { etag: result.etag, snapshot: result.snapshot };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof ConfigAccessError) throw accessFailure(err);
        log.error("web", `Config write on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  api.post(
    "/api/servers/:id/configs/:fileId/revert",
    {
      schema: { params: ConfigFileParams, body: ModConfigRevertBody },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId);

      let current;
      try {
        current = await readConfigFile(server.config, fileId);
      } catch (err) {
        if (err instanceof ConfigAccessError) throw accessFailure(err);
        log.error("web", `Config read on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
      if (holdsSecrets(current.file.relPath) && !(await mayTouchSecretFiles(req, server))) {
        throw new Forbidden(SECRET_FILE_REFUSED);
      }
      if (current.etag !== req.body.etag) {
        throw new HttpError(
          409,
          "This file changed since you opened it. Reload before reverting.",
        );
      }

      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "mod config revert (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: `${fileId} → ${req.body.snapshot}`,
      });

      try {
        forget(req.params.id, `configFile:${fileId}`);
        invalidate(`configFile:${req.params.id}:${fileId}`);
        const result = await revertConfigFile(
          server.config,
          fileId,
          req.body.snapshot,
          current.etag,
          { allowProtected: requestIsSysadmin(req) },
        );
        if (!result.ok) {
          throw new HttpError(
            409,
            "This file changed while reverting. Reload and try again.",
          );
        }
        return { etag: result.etag };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof ConfigAccessError) throw accessFailure(err);
        log.error("web", `Config revert on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );
}

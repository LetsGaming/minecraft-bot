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
import { MS } from "@mcbot/schema";
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
  type ParsedConfig,
} from "@mcbot/core/utils/configfmt/index.js";
import {
  ConfigAccessError,
  type ConfigAccessErrorKind,
} from "@mcbot/core/utils/server/configAccessError.js";
import { log } from "@mcbot/core/utils/logger.js";
import { currentSession, isSysadmin } from "../auth/auth.js";
import { BadGateway, BadRequest, Conflict, Forbidden, HttpError } from "../errors.js";
import {
  IdParams,
  ConfigFileParams,
  ConfigReadQuery,
  ModConfigWriteBody,
  ModConfigRevertBody,
  QueueResolveBody,
} from "./schemas.js";
import { readThrough, recall } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { cached } from "@mcbot/core/utils/cache.js";
import type { QueuedWriteResult } from "@mcbot/schema/contract.js";
import {
  queueEdits,
  pendingForServer,
  dropForFile,
  rebaseEdit,
  dropEditByKey,
} from "@mcbot/core/utils/stores/queuedEdits.js";
import { flushQueuedEdits, previewQueuedEdits } from "@mcbot/core/utils/wrapper/queueFlush.js";
import { bustConfigFile, lastKnownKey, ttlKey } from "./cacheKeys.js";
import { flagParam } from "./query.js";
import {
  auditedAction,
  requireFileId,
  requireServer,
  wrapperCall,
  type ConfiguredServer,
} from "./support.js";

const TTL_CONFIG_INDEX = 15 * MS.second;
const TTL_CONFIG_FILE = 10 * MS.second;
const AUDIT_EDITS_SHOWN = 6;
const AUDIT_DETAIL_MAX = 300;
const CONFIG_ID_LABEL = "config";
/** Mod-configs wrapper feature level that redacts secrets on read and guards protected keys. */
const REDACTING_FEATURE_VERSION = 2;

const STALE_FILE_MESSAGE =
  "This file changed since you opened it. Reload and re-apply your changes.";
const SAVE_RACE_MESSAGE =
  "This file changed while saving. Reload and re-apply your changes.";
const REVERT_RACE_MESSAGE = "This file changed while reverting. Reload and try again.";
const SECRET_FILE_REFUSED =
  "This file can hold passwords and access settings. Only a bot administrator can open it on this server.";

const ACCESS_STATUS: Record<ConfigAccessErrorKind, number> = {
  "too-large": 413,
  "not-found": 404,
  stale: 409,
  "precondition-required": 409,
  "rate-limited": 429,
  rejected: 400,
  protected: 403,
};

/** A wrapper refusal becomes an HTTP error carrying its explanation; anything else is not ours to name. */
function accessFailure(err: unknown): HttpError | null {
  return err instanceof ConfigAccessError
    ? new HttpError(ACCESS_STATUS[err.kind], err.message)
    : null;
}

type ConfigContents = Awaited<ReturnType<typeof readConfigFile>>;

/** What a write needs to know about the file it is based on. */
export interface ConfigSnapshot {
  file: { relPath: string; editable?: boolean | undefined };
  text: string;
  etag: string;
}

/**
 * Files that hold credentials (`rcon.password`, plugin tokens and database
 * passwords) or decide who may join and command the server.
 */
function holdsSecrets(relPath: string): boolean {
  return relPath === "server.properties" || relPath.startsWith("plugins/");
}

function requestIsSysadmin(req: FastifyRequest): boolean {
  return isSysadmin(currentSession(req));
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
  server: ConfiguredServer,
): Promise<boolean> {
  if (requestIsSysadmin(req)) return true;
  return (
    (await wrapperFeatureVersion(server.config, "mod-configs")) >= REDACTING_FEATURE_VERSION
  );
}

function assertSecretAccess(relPath: string, maySecret: boolean): void {
  if (holdsSecrets(relPath) && !maySecret) throw new Forbidden(SECRET_FILE_REFUSED);
}

/**
 * Every refusal a save can meet before anything is sent: the file moved on
 * since the editor opened it, it is one this caller may not touch, it is not
 * editable, or an edit does not apply. Returns the spliced text and the parse
 * it was based on. A client that could post arbitrary text would make every
 * guard in the writer decorative, so the client sends the values it changed
 * and the document is re-spliced here.
 */
export function assertWritable(
  current: ConfigSnapshot,
  edits: ConfigEdit[],
  etag: string,
  maySecret: boolean,
): { next: string; parsed: ParsedConfig } {
  if (current.etag !== etag) throw new Conflict(STALE_FILE_MESSAGE);
  assertSecretAccess(current.file.relPath, maySecret);
  const parsed = parseConfig(current.file.relPath, current.text);
  if (parsed.warning || current.file.editable === false) {
    throw new BadRequest(parsed.warning ?? "This file is read-only in the editor.");
  }
  try {
    return { next: applyConfigEdits(current.file.relPath, current.text, edits), parsed };
  } catch (err) {
    if (err instanceof ConfigEditError) throw new BadRequest(err.message);
    throw err;
  }
}

/**
 * Read one config file for a request and refuse it when the caller may not
 * see it. `cache` serves a stale copy through an outage (the editor's reads);
 * `live` always asks the wrapper (the checks that guard a write).
 */
async function loadConfigFile(
  req: FastifyRequest,
  server: ConfiguredServer,
  serverId: string,
  fileId: string,
  source: "cache" | "live",
): Promise<{ contents: ConfigContents; stale: unknown; maySecret: boolean }> {
  const read = await wrapperCall(
    "Config read",
    { server: serverId },
    () =>
      source === "cache"
        ? readThrough(serverId, lastKnownKey.configFile(fileId), () =>
            cached(ttlKey.configFile(serverId, fileId), TTL_CONFIG_FILE, () =>
              readConfigFile(server.config, fileId),
            ),
          )
        : readConfigFile(server.config, fileId).then((value) => ({ value, stale: null })),
    { translate: accessFailure },
  );
  const maySecret = await mayTouchSecretFiles(req, server);
  assertSecretAccess(read.value.file.relPath, maySecret);
  return { contents: read.value, stale: read.stale, maySecret };
}

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
 * applied blindly is worse than refusing it. The cached copy is held to the
 * same rules as a live save, so an editor working from an older copy cannot
 * overwrite a newer change on flush without ever seeing a conflict.
 */
function queueFromCache(
  serverId: string,
  fileId: string,
  edits: ConfigEdit[],
  etag: string,
  session: { uid: string; tag: string },
  maySecret: boolean,
): QueuedWriteResult | null {
  const copy = recall<ConfigSnapshot>(
    serverId,
    lastKnownKey.configFile(fileId),
    "queueing a write",
  );
  if (!copy) return null;

  const { parsed } = assertWritable(copy.value, edits, etag, maySecret);
  const baseByKey = new Map(
    parsed.nodes.map((node) => [JSON.stringify(node.path), node.value] as const),
  );

  const queuedAt = Date.now();
  queueEdits(
    serverId,
    fileId,
    copy.value.file.relPath,
    edits.map((edit) => ({
      keyPath: edit.path,
      newValue: edit.value,
      baseValue: baseByKey.get(JSON.stringify(edit.path)) ?? null,
    })),
    { id: session.uid, tag: session.tag },
    queuedAt,
  );

  return { queued: true, queuedAt, keys: edits.map((e) => e.path) };
}

/** A one-line summary of what changed, for the audit log. */
function describeEdits(edits: ConfigEdit[]): string {
  return edits
    .slice(0, AUDIT_EDITS_SHOWN)
    .map((e) => `${e.path.join(".")}=${JSON.stringify(e.value)}`)
    .join(", ")
    .slice(0, AUDIT_DETAIL_MAX);
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
      const serverId = req.params.id;
      const server = requireServer(serverId);
      // The listing survives a wrapper blip: which files exist changes far
      // more slowly than the wrapper's availability, and an editor that
      // disappears mid-outage is useless exactly when it is wanted.
      const { value, stale } = await wrapperCall(
        "Config index",
        { server: serverId },
        () =>
          readThrough(serverId, lastKnownKey.configIndex, () =>
            cached(ttlKey.configIndex(serverId), TTL_CONFIG_INDEX, () =>
              indexConfigFiles(server.config),
            ),
          ),
        { translate: accessFailure },
      );
      const files = (await mayTouchSecretFiles(req, server))
        ? value.files
        : value.files.filter((f) => !holdsSecrets(f.relPath));
      return { files, truncated: value.truncated, stale };
    },
  );

  api.get(
    "/api/servers/:id/configs/:fileId",
    {
      schema: { params: ConfigFileParams, querystring: ConfigReadQuery },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req) => {
      const serverId = req.params.id;
      const server = requireServer(serverId);
      const fileId = requireFileId(req.params.fileId, CONFIG_ID_LABEL);
      const { contents, stale } = await loadConfigFile(req, server, serverId, fileId, "cache");

      // Parsed here, not in the wrapper. The schema comes out of the file's own
      // comments where the format has them (Forge, NeoForge) and is inferred
      // from key names and value types where it does not (Fabric).
      const parsed = parseConfig(contents.file.relPath, contents.text);
      const fields = schemaFromConfig(parsed);
      const supported = formatFor(contents.file.relPath, contents.text) !== null;
      // The raw text is sent when asked for, and always for a file the form
      // cannot represent, where the source is all there is to show.
      const withText = flagParam(req.query.text) || !supported || fields.length === 0;
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
      const session = currentSession(req);
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
      requireFileId(fileId, CONFIG_ID_LABEL);
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
      dropForFile(req.params.id, requireFileId(req.params.fileId, CONFIG_ID_LABEL));
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
      const serverId = req.params.id;
      const server = requireServer(serverId);
      const fileId = requireFileId(req.params.fileId, CONFIG_ID_LABEL);
      const { edits, etag } = req.body;
      if (edits.length === 0) throw new BadRequest("No changes to apply.");

      let loaded;
      try {
        loaded = await loadConfigFile(req, server, serverId, fileId, "live");
      } catch (err) {
        // The wrapper is not answering, so this write cannot land now. Hold
        // it instead of discarding it: the operator could see this file (the
        // read fell back to cache), so refusing their edit outright would
        // mean showing someone data they are then forbidden to act on.
        if (!(err instanceof BadGateway)) throw err;
        const queued = queueFromCache(
          serverId,
          fileId,
          edits,
          etag,
          currentSession(req),
          await mayTouchSecretFiles(req, server),
        );
        if (!queued) throw err;
        log.warn("web", `Config write on ${serverId} queued (${edits.length} key(s))`);
        return queued;
      }

      const { contents: current, maySecret } = loaded;
      const { next } = assertWritable(current, edits, etag, maySecret);

      await auditedAction(req, {
        action: "mod config edit",
        server: serverId,
        detail: `${current.file.relPath}: ${describeEdits(edits)}`,
      });

      const result = await wrapperCall(
        "Config write",
        { server: serverId },
        async () => {
          const written = await writeConfigFile(server.config, fileId, next, current.etag, {
            allowProtected: requestIsSysadmin(req),
          });
          if (!written.ok) throw new Conflict(SAVE_RACE_MESSAGE);
          return written;
        },
        { translate: accessFailure },
      );
      // The file we cached is now the old one. Dropping every copy means the
      // next read goes live and cannot serve a value this write superseded:
      // a stale answer is acceptable, a wrong one is not.
      bustConfigFile(serverId, fileId);
      return { etag: result.etag, snapshot: result.snapshot };
    },
  );

  api.post(
    "/api/servers/:id/configs/:fileId/revert",
    {
      schema: { params: ConfigFileParams, body: ModConfigRevertBody },
      config: { capability: "config:write", scope: "server", param: "id" },
    },
    async (req) => {
      const serverId = req.params.id;
      const server = requireServer(serverId);
      const fileId = requireFileId(req.params.fileId, CONFIG_ID_LABEL);

      const { contents: current } = await loadConfigFile(req, server, serverId, fileId, "live");
      if (current.etag !== req.body.etag) throw new Conflict(STALE_FILE_MESSAGE);

      await auditedAction(req, {
        action: "mod config revert",
        server: serverId,
        detail: `${fileId} → ${req.body.snapshot}`,
      });

      const result = await wrapperCall(
        "Config revert",
        { server: serverId },
        async () => {
          const reverted = await revertConfigFile(
            server.config,
            fileId,
            req.body.snapshot,
            current.etag,
            { allowProtected: requestIsSysadmin(req) },
          );
          if (!reverted.ok) throw new Conflict(REVERT_RACE_MESSAGE);
          return reverted;
        },
        { translate: accessFailure },
      );
      bustConfigFile(serverId, fileId);
      return { etag: result.etag };
    },
  );
}


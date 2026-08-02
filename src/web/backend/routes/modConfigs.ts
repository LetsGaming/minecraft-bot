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
 * the mod author wrote — losing them makes the file unreadable for exactly the
 * person this editor exists to serve.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  indexConfigFiles,
  readConfigFile,
  writeConfigFile,
  revertConfigFile,
} from "@mcbot/core/utils/server/serverAccess.js";
import {
  applyConfigEdits,
  parseConfig,
  schemaFromConfig,
  ConfigEditError,
  type ConfigEdit,
} from "@mcbot/core/utils/configfmt/index.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { sessionFromRequest } from "../auth/auth.js";
import { BadRequest, NotFound, HttpError } from "../errors.js";
import { IdParams, ConfigFileParams, ModConfigWriteBody, ModConfigRevertBody } from "./schemas.js";

const OPERATION_FAILED =
  "The operation failed unexpectedly — see the bot logs for details.";

const FILE_ID_RE = /^[A-Za-z0-9_-]{22}$/;

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

function requireFileId(fileId: string): string {
  if (!FILE_ID_RE.test(fileId)) throw new BadRequest("Invalid config id.");
  return fileId;
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
        return { files: await indexConfigFiles(server.config) };
      } catch (err) {
        log.error("web", `Config index for ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  api.get(
    "/api/servers/:id/configs/:fileId",
    {
      schema: { params: ConfigFileParams },
      config: { capability: "config:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const fileId = requireFileId(req.params.fileId);

      let contents;
      try {
        contents = await readConfigFile(server.config, fileId);
      } catch (err) {
        log.error("web", `Config read on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }

      // Parsed here, not in the wrapper. The schema comes out of the file's own
      // comments where the format has them (Forge, NeoForge) and is inferred
      // from key names and value types where it does not (Fabric).
      const parsed = parseConfig(contents.file.relPath, contents.text);
      return {
        file: contents.file,
        etag: contents.etag,
        snapshots: contents.snapshots,
        fields: schemaFromConfig(parsed),
        ...(parsed.warning ? { warning: parsed.warning } : {}),
        // The raw text ships too, so the UI can offer a read-only source view
        // for anything the form cannot represent.
        text: contents.text,
      };
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
        );
        if (!result.ok) {
          throw new HttpError(
            409,
            "This file changed while saving. Reload and re-apply your changes.",
          );
        }
        return { etag: result.etag, snapshot: result.snapshot };
      } catch (err) {
        if (err instanceof HttpError) throw err;
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

      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "mod config revert (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: `${fileId} → ${req.body.snapshot}`,
      });

      try {
        return await revertConfigFile(server.config, fileId, req.body.snapshot);
      } catch (err) {
        log.error("web", `Config revert on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );
}

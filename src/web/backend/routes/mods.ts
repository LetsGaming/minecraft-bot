/**
 * The Mods tab's server side.
 *
 * Two kinds of route live here, split by where the work happens:
 *
 *   - The installed list and the mutations (install, remove, update) go to the
 *     wrapper, because only it can read the instance's mod manifest and run the
 *     suite's scripts as the instance user. This side just proxies, audits the
 *     writes, and invalidates the cached installed list afterwards.
 *   - Search and catalogue lookups go to Modrinth directly from here, because
 *     browsing touches no host and routing it through a Minecraft box would add
 *     a hop and a failure mode for nothing. Search is defaulted to what this
 *     server can run — its loader and game version as facets, client-only mods
 *     hidden — and every hit is annotated with whether it is already installed.
 *
 * Capabilities: everything is server-scoped. Reads (list, updates check,
 * search, catalogue) need `mods:read`; the three mutations need `mods:write`,
 * since installing a mod runs its code on the server.
 *
 * The wrapper's mutations return their script's structured result at 200,
 * including a handled `{ ok: false, error, code }`. That is passed straight
 * through: the failure is data the UI renders as a message, not an HTTP error.
 * Only the wrapper being unreachable, or a genuine Modrinth outage, becomes a
 * 5xx here.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  listInstalledMods,
  addMod,
  removeMod,
  checkModUpdates,
  applyModUpdates,
  type InstalledMods,
} from "@mcbot/core/utils/server/serverAccess.js";
import {
  searchProjects,
  getProjectDetail,
  ModrinthError,
} from "@mcbot/core/utils/modrinth.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { readThrough, forget } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { sessionFromRequest } from "../auth/auth.js";
import { NotFound, HttpError } from "../errors.js";
import { IdParams, ModSlugParams, ModAddBody, ModUpdatesBody, ModSearchQuery } from "./schemas.js";

const OPERATION_FAILED =
  "The operation failed unexpectedly — see the bot logs for details.";

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

/** Parse a clamped integer from a query string. */
function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/** Modrinth failure → the status the client should see. */
function throwModrinth(err: unknown, where: string): never {
  if (err instanceof ModrinthError) {
    if (err.kind === "not-found") throw new NotFound("No such Modrinth project.");
    throw new HttpError(502, "Modrinth is unavailable right now. Try again shortly.");
  }
  log.error("web", `${where} failed: ${errMsg(err)}`);
  throw new HttpError(502, OPERATION_FAILED);
}

export function registerModRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  // ── Installed list (cached; survives a wrapper blip) ──────────────────────
  api.get(
    "/api/servers/:id/mods/installed",
    {
      schema: { params: IdParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      try {
        const { value, stale } = await readThrough(req.params.id, "modsInstalled", () =>
          listInstalledMods(server.config),
        );
        return { ...value, stale };
      } catch (err) {
        log.error("web", `Installed mods for ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Check for updates ─────────────────────────────────────────────────────
  api.get(
    "/api/servers/:id/mods/updates",
    {
      schema: { params: IdParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      try {
        return await checkModUpdates(server.config);
      } catch (err) {
        log.error("web", `Mod update check on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Install ───────────────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods",
    {
      schema: { params: IdParams, body: ModAddBody },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "mod install (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: req.body.slug,
      });
      try {
        const result = await addMod(server.config, req.body);
        // Whatever the outcome, the installed list may have changed.
        forget(req.params.id, "modsInstalled");
        return result;
      } catch (err) {
        log.error("web", `Mod install on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Remove ────────────────────────────────────────────────────────────────
  api.delete(
    "/api/servers/:id/mods/:slug",
    {
      schema: { params: ModSlugParams },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "mod remove (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: req.params.slug,
      });
      try {
        const result = await removeMod(server.config, req.params.slug);
        forget(req.params.id, "modsInstalled");
        return result;
      } catch (err) {
        log.error("web", `Mod remove on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Apply all updates ─────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods/updates",
    {
      schema: { params: IdParams, body: ModUpdatesBody },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "mod update (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: req.body.mcVersion ? `mc ${req.body.mcVersion}` : "all",
      });
      try {
        const result = await applyModUpdates(server.config, req.body.mcVersion);
        forget(req.params.id, "modsInstalled");
        return result;
      } catch (err) {
        log.error("web", `Mod update-all on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Browse Modrinth (dashboard-side; annotated with installed state) ──────
  api.get(
    "/api/servers/:id/mods/search",
    {
      schema: { params: IdParams, querystring: ModSearchQuery },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const q = req.query;

      // The installed manifest gives us the compat facets and the installed
      // annotation. Best-effort: if the wrapper is down, search still works,
      // just without the loader/version narrowing and the "installed" badges.
      let installed: InstalledMods | null = null;
      try {
        installed = (await readThrough(req.params.id, "modsInstalled", () =>
          listInstalledMods(server.config),
        )).value;
      } catch {
        installed = null;
      }
      const installedSet = new Set(installed?.mods.map((m) => m.slug) ?? []);

      const restrict = q.compatible !== "false";
      const categories = (q.categories ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /^[\w-]{1,40}$/.test(c));

      try {
        const result = await searchProjects({
          query: q.query ?? "",
          limit: clampInt(q.limit, 20, 1, 50),
          offset: clampInt(q.offset, 0, 0, 10_000),
          sort: q.sort ?? "relevance",
          categories,
          ...(restrict && installed?.modLoader ? { loader: installed.modLoader } : {}),
          ...(restrict && installed?.gameVersion ? { gameVersion: installed.gameVersion } : {}),
          // Installing on a server, so client-only mods are hidden by default.
          hideClientOnly: q.hideClientOnly !== "false",
        });
        return {
          ...result,
          hits: result.hits.map((h) => ({
            ...h,
            installed: installedSet.has(h.slug) || installedSet.has(h.projectId),
          })),
        };
      } catch (err) {
        return throwModrinth(err, `Mod search on ${req.params.id}`);
      }
    },
  );

  api.get(
    "/api/servers/:id/mods/catalog/:slug",
    {
      schema: { params: ModSlugParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);

      let installed: InstalledMods | null = null;
      try {
        installed = (await readThrough(req.params.id, "modsInstalled", () =>
          listInstalledMods(server.config),
        )).value;
      } catch {
        installed = null;
      }

      try {
        const detail = await getProjectDetail(req.params.slug, {
          ...(installed?.modLoader ? { loaders: [installed.modLoader] } : {}),
        });
        const entry = installed?.mods.find(
          (m) => m.slug === detail.slug || m.slug === detail.projectId,
        );
        return {
          ...detail,
          installed: entry !== undefined,
          installedVersionId: entry?.versionId ?? null,
        };
      } catch (err) {
        return throwModrinth(err, `Mod catalog on ${req.params.id}`);
      }
    },
  );
}

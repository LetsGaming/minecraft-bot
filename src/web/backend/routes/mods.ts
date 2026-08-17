/**
 * The Mods tab's server side.
 *
 * Two kinds of route, split by where the work happens:
 *
 *   - The installed list and the mutations (install, update, remove) go to the
 *     wrapper, because only it can read the instance's mod manifest and run the
 *     suite's scripts as the instance user. This side proxies, audits the
 *     writes, and invalidates the cached reads afterwards.
 *   - Search and catalogue go to Modrinth directly from here; browsing touches
 *     no host. Search is defaulted to what this server can run and each hit is
 *     annotated with whether it is already installed.
 *
 * Every external read is cached with a short TTL (utils/cache.ts) so a burst of
 * dashboard requests collapses to one upstream call: the wrapper is a single
 * process on the Minecraft host, and Modrinth rate-limits. A mutation drops the
 * affected keys, and the update check takes ?refresh=true for the "check now"
 * button.
 *
 * Modrinth serves icons from its own CDN, which the page's CSP does not allow,
 * so they are proxied through /mods/icon and loaded same-origin.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  listInstalledMods,
  addMod,
  removeMod,
  updateMod,
  checkModUpdates,
  applyModUpdates,
  type InstalledMods,
} from "@mcbot/core/utils/server/serverAccess.js";
import {
  searchProjects,
  getProjectDetail,
  ModrinthError,
  type ModSearchResult,
  type ModProjectDetail,
} from "@mcbot/core/utils/modrinth.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { cached, invalidate } from "@mcbot/core/utils/cache.js";
import { sessionFromRequest } from "../auth/auth.js";
import { BadRequest, NotFound, HttpError } from "../errors.js";
import {
  IdParams,
  ModSlugParams,
  ModAddBody,
  ModUpdatesBody,
  ModSearchQuery,
  ModUpdatesQuery,
  ModIconQuery,
} from "./schemas.js";

// The dashboard is what surfaces these; its logs are the web container's, not
// the bot's. (For docker: `docker compose logs web`.)
const OPERATION_FAILED =
  "The operation failed unexpectedly. Check the dashboard (web) logs for details.";

const TTL_INSTALLED = 15_000;
const TTL_UPDATES = 120_000;
const TTL_SEARCH = 60_000;
const TTL_CATALOG = 300_000;
const TTL_ICON = 24 * 60 * 60 * 1000;

const MODRINTH_ICON_HOST = "cdn.modrinth.com";
const ICON_UA = "LetsGaming/minecraft-bot dashboard (icon proxy)";

function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
  const n = parseInt(raw ?? "", 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function throwModrinth(err: unknown, where: string): never {
  if (err instanceof ModrinthError) {
    if (err.kind === "not-found") throw new NotFound("No such Modrinth project.");
    throw new HttpError(502, "Modrinth is unavailable right now. Try again shortly.");
  }
  log.error("web", `${where} failed: ${errMsg(err)}`);
  throw new HttpError(502, OPERATION_FAILED);
}

/** Rewrite a Modrinth icon URL to the same-origin proxy the CSP allows. */
function proxyIcon(serverId: string, url: string | null): string | null {
  if (!url) return null;
  return `/api/servers/${encodeURIComponent(serverId)}/mods/icon?url=${encodeURIComponent(url)}`;
}

export function registerModRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  /** Installed list, TTL-cached and stale-on-failure. Shared by list/search/catalog. */
  function loadInstalled(
    id: string,
    cfg: Parameters<typeof listInstalledMods>[0],
  ): Promise<{ value: InstalledMods; stale: unknown }> {
    return readThrough(id, "modsInstalled", () =>
      cached(`mods:installed:${id}`, TTL_INSTALLED, () => listInstalledMods(cfg)),
    );
  }

  function invalidateServer(id: string): void {
    invalidate(`mods:installed:${id}`);
    invalidate(`mods:updates:${id}`);
  }

  // ── Installed list ────────────────────────────────────────────────────────
  api.get(
    "/api/servers/:id/mods/installed",
    {
      schema: { params: IdParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      try {
        const { value, stale } = await loadInstalled(req.params.id, server.config);
        return { ...value, stale };
      } catch (err) {
        log.error("web", `Installed mods for ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Check for updates (?refresh=true bypasses the cache) ──────────────────
  api.get(
    "/api/servers/:id/mods/updates",
    {
      schema: { params: IdParams, querystring: ModUpdatesQuery },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const key = `mods:updates:${req.params.id}`;
      if (req.query.refresh === "true") invalidate(key);
      try {
        return await cached(key, TTL_UPDATES, () => checkModUpdates(server.config));
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
        invalidateServer(req.params.id);
        return result;
      } catch (err) {
        log.error("web", `Mod install on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Update one mod ────────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods/:slug/update",
    {
      schema: { params: ModSlugParams },
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
        detail: req.params.slug,
      });
      try {
        const result = await updateMod(server.config, req.params.slug);
        invalidateServer(req.params.id);
        return result;
      } catch (err) {
        log.error("web", `Mod update on ${req.params.id} failed: ${errMsg(err)}`);
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
        invalidateServer(req.params.id);
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
        invalidateServer(req.params.id);
        return result;
      } catch (err) {
        log.error("web", `Mod update-all on ${req.params.id} failed: ${errMsg(err)}`);
        throw new HttpError(502, OPERATION_FAILED);
      }
    },
  );

  // ── Icon proxy (Modrinth CDN → same-origin, so the CSP allows it) ─────────
  api.get(
    "/api/servers/:id/mods/icon",
    {
      schema: { params: IdParams, querystring: ModIconQuery },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req, reply) => {
      requireServer(req.params.id);

      let target: URL;
      try {
        target = new URL(req.query.url);
      } catch {
        throw new BadRequest("Invalid icon url.");
      }
      // Only Modrinth's CDN is proxied — this must never become an open relay.
      if (target.protocol !== "https:" || target.hostname !== MODRINTH_ICON_HOST) {
        throw new BadRequest("Only Modrinth CDN icons are proxied.");
      }

      let img: { contentType: string; body: Buffer };
      try {
        img = await cached(`icon:${target.href}`, TTL_ICON, async () => {
          const res = await fetch(target.href, {
            headers: { "User-Agent": ICON_UA },
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) throw new HttpError(502, "Icon fetch failed.");
          return {
            contentType: res.headers.get("content-type") ?? "image/png",
            body: Buffer.from(await res.arrayBuffer()),
          };
        });
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, "Icon fetch failed.");
      }

      reply.header("content-type", img.contentType);
      reply.header("cache-control", "public, max-age=86400, immutable");
      return reply.send(img.body);
    },
  );

  // ── Browse Modrinth (cached; annotated with installed state) ──────────────
  api.get(
    "/api/servers/:id/mods/search",
    {
      schema: { params: IdParams, querystring: ModSearchQuery },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const q = req.query;

      let installed: InstalledMods | null = null;
      try {
        installed = (await loadInstalled(req.params.id, server.config)).value;
      } catch {
        installed = null;
      }
      const installedSet = new Set(installed?.mods.map((m) => m.slug) ?? []);

      const restrict = q.compatible !== "false";
      const categories = (q.categories ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /^[\w-]{1,40}$/.test(c));

      const params = {
        query: q.query ?? "",
        limit: clampInt(q.limit, 20, 1, 50),
        offset: clampInt(q.offset, 0, 0, 10_000),
        sort: q.sort ?? "relevance",
        categories,
        ...(restrict && installed?.modLoader ? { loader: installed.modLoader } : {}),
        ...(restrict && installed?.gameVersion ? { gameVersion: installed.gameVersion } : {}),
        hideClientOnly: q.hideClientOnly !== "false",
      };

      try {
        const raw = await cached<ModSearchResult>(
          `modrinth:search:${JSON.stringify(params)}`,
          TTL_SEARCH,
          () => searchProjects(params),
        );
        return {
          ...raw,
          hits: raw.hits.map((h) => ({
            ...h,
            iconUrl: proxyIcon(req.params.id, h.iconUrl),
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
        installed = (await loadInstalled(req.params.id, server.config)).value;
      } catch {
        installed = null;
      }

      const loader = installed?.modLoader ?? "";
      try {
        const detail = await cached<ModProjectDetail>(
          `modrinth:catalog:${req.params.slug}:${loader}`,
          TTL_CATALOG,
          () => getProjectDetail(req.params.slug, loader ? { loaders: [loader] } : {}),
        );
        const entry = installed?.mods.find(
          (m) => m.slug === detail.slug || m.slug === detail.projectId,
        );
        return {
          ...detail,
          iconUrl: proxyIcon(req.params.id, detail.iconUrl),
          installed: entry !== undefined,
          installedVersionId: entry?.versionId ?? null,
        };
      } catch (err) {
        return throwModrinth(err, `Mod catalog on ${req.params.id}`);
      }
    },
  );
}

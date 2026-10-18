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
 * so they are proxied through /mods/icon and loaded same-origin. The wrapper's
 * installed and compat rows carry no icon, so they get one from a cached bulk
 * project lookup (lookupProjectIcons) and the same proxy.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { MS } from "@mcbot/schema";
import {
  listInstalledMods,
  addMod,
  removeMod,
  updateMod,
  disableMod,
  enableMod,
  checkModUpdates,
  applyModUpdates,
  supportsModCompat,
  startModCompat,
  getModCompat,
  type InstalledMods,
  type ModCompatJob,
} from "@mcbot/core/utils/server/serverAccess.js";
import {
  searchProjects,
  getProjectDetail,
  lookupProjectIcons,
  ModrinthError,
  type ModSearchResult,
  type ModProjectDetail,
} from "@mcbot/core/utils/modrinth.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { fetchReleaseVersions } from "@mcbot/core/utils/minecraft/mojang.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { cached, invalidate } from "@mcbot/core/utils/cache.js";
import { fetchIcon, type IconImage } from "../iconProxy.js";
import { CompatLimitError, createCompatGuard } from "./compatGuard.js";
import { currentSession, isSysadmin, type Session } from "../auth/auth.js";
import { BadGateway, BadRequest, HttpError, NotFound } from "../errors.js";
import {
  IdParams,
  ModSlugParams,
  ModAddBody,
  ModUpdatesBody,
  ModCompatBody,
  ModCompatJobParams,
  ModSearchQuery,
  ModUpdatesQuery,
  ModIconQuery,
} from "./schemas.js";
import { bustMods, ttlKey, lastKnownKey } from "./cacheKeys.js";
import { capabilityProbe } from "./capabilityProbe.js";
import { clampIntParam, flagParam } from "./query.js";
import {
  OPERATION_FAILED,
  auditedAction,
  requireServer,
  wrapperCall,
  type ConfiguredServer,
} from "./support.js";

const TTL_INSTALLED = 15 * MS.second;
const TTL_UPDATES = 2 * MS.minute;
const TTL_RELEASE_VERSIONS = 6 * MS.hour;
const TTL_SEARCH = MS.minute;
const TTL_CATALOG = 5 * MS.minute;
const ICON_BROWSER_CACHE_SECONDS = MS.day / MS.second;

const SEARCH_LIMIT = { def: 20, min: 1, max: 50 };
const SEARCH_OFFSET = { def: 0, min: 0, max: 10_000 };

const MODRINTH_ICON_HOST = "cdn.modrinth.com";
const ICON_UA = "LetsGaming/minecraft-bot dashboard (icon proxy)";

const compatProbe = capabilityProbe(
  "mods:compat",
  (cfg) => supportsModCompat(cfg),
  "This server's API wrapper cannot check another Minecraft version. Update the wrapper.",
);

/**
 * The tenant a start request is counted against: a sysadmin is their own
 * scope; everyone else shares the scope of the guilds they manage, and a user
 * with only per-server grants is their own scope.
 */
function compatTenant(session: Session): string {
  if (isSysadmin(session)) return `sys:${session.uid}`;
  if (session.guilds.length > 0) return `guild:${[...session.guilds].sort().join(",")}`;
  return `user:${session.uid}`;
}

function throwModrinth(err: unknown, where: string): never {
  if (err instanceof ModrinthError) {
    if (err.kind === "not-found") throw new NotFound("No such Modrinth project.");
    throw new BadGateway("Modrinth is unavailable right now. Try again shortly.");
  }
  log.error("web", `${where} failed: ${errMsg(err)}`);
  throw new BadGateway(OPERATION_FAILED);
}

/** Rewrite a Modrinth icon URL to the same-origin proxy the CSP allows. */
function proxyIcon(serverId: string, url: string | null): string | null {
  if (!url) return null;
  return `/api/servers/${encodeURIComponent(serverId)}/mods/icon?url=${encodeURIComponent(url)}`;
}

/**
 * Adds `iconUrl` (through the proxy) to every row whose project has an icon on
 * Modrinth. Rows without one keep their shape; the view shows initials then.
 */
async function withIcons<T extends { slug: string }>(
  serverId: string,
  rows: readonly T[],
): Promise<Array<T & { iconUrl?: string }>> {
  if (rows.length === 0) return [...rows];
  const icons = await lookupProjectIcons(rows.map((r) => r.slug)).catch((err: unknown) => {
    log.debug("web", `Icon lookup for ${serverId} failed, rows go without icons: ${errMsg(err)}`);
    return new Map<string, string>();
  });
  return rows.map((r) => {
    const icon = proxyIcon(serverId, icons.get(r.slug.toLowerCase()) ?? null);
    return icon ? { ...r, iconUrl: icon } : r;
  });
}

async function compatWithIcons(serverId: string, job: ModCompatJob): Promise<ModCompatJob> {
  const [partial, mods] = await Promise.all([
    withIcons(serverId, job.partial),
    job.mods ? withIcons(serverId, job.mods) : Promise.resolve(undefined),
  ]);
  return { ...job, partial, ...(mods ? { mods } : {}) };
}

export function registerModRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  /** Installed list, TTL-cached and stale-on-failure. Shared by list/search/catalog. */
  function loadInstalled(
    id: string,
    cfg: Parameters<typeof listInstalledMods>[0],
  ): Promise<{ value: InstalledMods; stale: unknown }> {
    return readThrough(id, lastKnownKey.modsInstalled, () =>
      cached(ttlKey.modsInstalled(id), TTL_INSTALLED, () => listInstalledMods(cfg)),
    );
  }

  /** The installed list, or null (logged) when it cannot be read: search then loses its installed flags and filters. */
  async function installedOrNull(
    id: string,
    cfg: Parameters<typeof listInstalledMods>[0],
  ): Promise<InstalledMods | null> {
    try {
      return (await loadInstalled(id, cfg)).value;
    } catch (err) {
      log.warn(
        "web",
        `Installed mods lookup for ${id} failed, so mod search is not narrowed to this server: ${errMsg(err)}`,
      );
      return null;
    }
  }

  /**
   * One mutation of the installed mods: audited before it runs, proxied to the
   * wrapper, and followed by dropping every cached copy of what it changed.
   */
  async function mutateMod(
    req: FastifyRequest,
    serverId: string,
    mutation: {
      verb: string;
      detail: string;
      run: (cfg: ConfiguredServer["config"]) => Promise<unknown>;
    },
  ): Promise<unknown> {
    const server = requireServer(serverId);
    await auditedAction(req, { action: `mod ${mutation.verb}`, server: serverId, detail: mutation.detail });
    return wrapperCall(`Mod ${mutation.verb}`, { server: serverId }, async () => {
      const result = await mutation.run(server.config);
      bustMods(serverId);
      return result;
    });
  }

  const compatGuard = createCompatGuard();

  // ── Compatibility with another Minecraft version (background job) ─────────
  api.post(
    "/api/servers/:id/mods/compat",
    {
      schema: { params: IdParams, body: ModCompatBody },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      await compatProbe.requireSupport(req.params.id, server.config);
      const refresh = req.body.refresh === true;
      const session = currentSession(req);
      let reservation;
      try {
        reservation = compatGuard.reserve(
          req.params.id,
          session.uid,
          compatTenant(session),
          req.body.mcVersion,
          refresh,
        );
      } catch (err) {
        if (err instanceof CompatLimitError) throw new HttpError(err.statusCode, err.message);
        throw err;
      }
      const held = reservation;
      return wrapperCall(
        "Mod compat start",
        { server: req.params.id, mcVersion: req.body.mcVersion },
        async () => {
          try {
            if (held.kind === "existing") return await held.settled;
            const started = await startModCompat(server.config, req.body.mcVersion, refresh);
            held.commit(started.jobId);
            return started;
          } catch (err) {
            if (held.kind === "new") held.rollback(err);
            throw err;
          }
        },
      );
    },
  );

  /** Released Minecraft versions for the target picker. `versions` is empty when Mojang cannot be reached. */
  api.get(
    "/api/servers/:id/mods/compat/versions",
    {
      schema: { params: IdParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      requireServer(req.params.id);
      const versions = await cached("mojang:release-versions", TTL_RELEASE_VERSIONS, async () => {
        const list = await fetchReleaseVersions();
        if (!list) throw new Error("Mojang version manifest unavailable");
        return list;
      }).catch((err: unknown) => {
        log.warn("web", `Release versions unavailable, the version picker will be empty: ${errMsg(err)}`);
        return [] as string[];
      });
      return { versions };
    },
  );

  api.get(
    "/api/servers/:id/mods/compat/:jobId",
    {
      schema: { params: ModCompatJobParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const remembered = compatGuard.recall(req.params.id, req.params.jobId);
      if (remembered) return compatWithIcons(req.params.id, remembered);
      const job = await wrapperCall(
        "Mod compat poll",
        { server: req.params.id, job: req.params.jobId },
        () => getModCompat(server.config, req.params.jobId),
      );
      if (!job) {
        compatGuard.forget(req.params.id, req.params.jobId);
        throw new NotFound("This check expired. Start it again.");
      }
      compatGuard.observe(req.params.id, job);
      return compatWithIcons(req.params.id, job);
    },
  );

  // ── Installed list ────────────────────────────────────────────────────────
  api.get(
    "/api/servers/:id/mods/installed",
    {
      schema: { params: IdParams },
      config: { capability: "mods:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      return wrapperCall("Installed mods", { server: req.params.id }, async () => {
        const { value, stale } = await loadInstalled(req.params.id, server.config);
        const [mods, compat] = await Promise.all([
          withIcons(req.params.id, value.mods),
          compatProbe.supported(req.params.id, server.config),
        ]);
        return { ...value, mods, stale, compat };
      });
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
      const key = ttlKey.modsUpdates(req.params.id);
      if (flagParam(req.query.refresh)) invalidate(key);
      return wrapperCall("Mod update check", { server: req.params.id }, () =>
        cached(key, TTL_UPDATES, () => checkModUpdates(server.config)),
      );
    },
  );

  // ── Install ───────────────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods",
    {
      schema: { params: IdParams, body: ModAddBody },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) =>
      mutateMod(req, req.params.id, {
        verb: "install",
        detail: req.body.slug,
        run: (cfg) => addMod(cfg, req.body),
      }),
  );

  // ── Update one mod ────────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods/:slug/update",
    {
      schema: { params: ModSlugParams },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) =>
      mutateMod(req, req.params.id, {
        verb: "update",
        detail: req.params.slug,
        run: (cfg) => updateMod(cfg, req.params.slug),
      }),
  );

  // ── Disable (without uninstalling) ────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods/:slug/disable",
    {
      schema: { params: ModSlugParams },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) =>
      mutateMod(req, req.params.id, {
        verb: "disable",
        detail: req.params.slug,
        run: (cfg) => disableMod(cfg, req.params.slug),
      }),
  );

  // ── Enable ─────────────────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods/:slug/enable",
    {
      schema: { params: ModSlugParams },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) =>
      mutateMod(req, req.params.id, {
        verb: "enable",
        detail: req.params.slug,
        run: (cfg) => enableMod(cfg, req.params.slug),
      }),
  );

  // ── Remove ────────────────────────────────────────────────────────────────
  api.delete(
    "/api/servers/:id/mods/:slug",
    {
      schema: { params: ModSlugParams },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) =>
      mutateMod(req, req.params.id, {
        verb: "remove",
        detail: req.params.slug,
        run: (cfg) => removeMod(cfg, req.params.slug),
      }),
  );

  // ── Apply all updates ─────────────────────────────────────────────────────
  api.post(
    "/api/servers/:id/mods/updates",
    {
      schema: { params: IdParams, body: ModUpdatesBody },
      config: { capability: "mods:write", scope: "server", param: "id" },
    },
    async (req) =>
      mutateMod(req, req.params.id, {
        verb: "update-all",
        detail: req.body.mcVersion ? `mc ${req.body.mcVersion}` : "all",
        run: (cfg) => applyModUpdates(cfg, req.body.mcVersion),
      }),
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

      let img: IconImage;
      try {
        img = await fetchIcon(target.href, ICON_UA);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new BadGateway("Icon fetch failed.");
      }

      reply.header("content-type", img.contentType);
      reply.header("cache-control", `public, max-age=${ICON_BROWSER_CACHE_SECONDS}, immutable`);
      reply.header("content-security-policy", "default-src 'none'; sandbox");
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

      const installed = await installedOrNull(req.params.id, server.config);
      const installedSet = new Set(installed?.mods.map((m) => m.slug) ?? []);

      const restrict = flagParam(q.compatible, true);
      const categories = (q.categories ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter((c) => /^[\w-]{1,40}$/.test(c));

      const params = {
        query: q.query ?? "",
        limit: clampIntParam(q.limit, SEARCH_LIMIT),
        offset: clampIntParam(q.offset, SEARCH_OFFSET),
        sort: q.sort ?? "relevance",
        categories,
        ...(restrict && installed?.modLoader ? { loader: installed.modLoader } : {}),
        ...(restrict && installed?.gameVersion ? { gameVersion: installed.gameVersion } : {}),
        hideClientOnly: flagParam(q.hideClientOnly, true),
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

      const installed = await installedOrNull(req.params.id, server.config);

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

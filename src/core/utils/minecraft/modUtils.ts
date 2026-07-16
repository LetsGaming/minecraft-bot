/**
 * Modrinth mod lookup service.
 *
 * Reads downloaded_versions.json (local) or fetches the slug list from the
 * API wrapper (remote), then hits the Modrinth API once for metadata.
 * Cache is keyed by server ID + mtime so it invalidates automatically.
 */

import type { ServerInstance } from "../server/server.js";
import type { ModSide, ModInfo, ModList } from "../../types/index.js";
import { isRecord } from "../objects.js";
import * as serverAccess from "../server/serverAccess.js";

// ── Types ──────────────────────────────────────────────────────────────────
// ModSide, ModInfo, ModList are defined in types/mods.ts and re-exported
// via types/index.ts. They are re-exported here for backward compatibility
// so existing importers of modUtils.ts continue to work unchanged.
export type { ModSide, ModInfo, ModList };



// ── Modrinth API types ────────────────────────────────────────────────────

interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  client_side: string;
  server_side: string;
}

// ── Cache keyed by "serverId:mtimeMs" ────────────────────────────────────

interface CacheEntry {
  mtimeMs: number;
  modList: ModList;
}

const cache = new Map<string, CacheEntry>();

const MODRINTH_API = "https://api.modrinth.com/v2";

// ── Side classification ───────────────────────────────────────────────────

function classifySide(project: ModrinthProject): ModSide {
  const c = project.client_side;
  const s = project.server_side;
  if (s === "required" && c === "unsupported") return "server_only";
  if (c === "required") return "client_and_server";
  return "client_optional";
}

// ── Core lookup ───────────────────────────────────────────────────────────

/** Get the mod list for the given server instance. */
export async function getModList(server: ServerInstance): Promise<ModList> {
  const cfg = server.config;
  const { slugs, mtimeMs } = await serverAccess.readModSlugs(cfg);
  const cacheKey = `${cfg.id}:${mtimeMs}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached.modList;

  // Evict stale entries for this server before inserting
  for (const k of cache.keys()) {
    if (k.startsWith(`${cfg.id}:`)) cache.delete(k);
  }

  if (slugs.length === 0) {
    const empty: ModList = {
      serverOnly: [],
      clientOptional: [],
      clientAndServer: [],
      fetchedAt: Date.now(),
    };
    cache.set(cacheKey, { mtimeMs, modList: empty });
    return empty;
  }

  const projects = await fetchModrinthProjects(slugs);
  const modList = buildModList(projects);
  cache.set(cacheKey, { mtimeMs, modList });
  return modList;
}

/**
 * Narrow the raw Modrinth `/projects` array to ModrinthProject[]. Modrinth is a
 * third party, so its shape is not ours to trust: any entry missing one of the
 * string fields we use is dropped, and a changed response fails here at the
 * boundary rather than surfacing as `undefined` while building the mod list.
 */
function parseModrinthProjects(raw: unknown): ModrinthProject[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    if (!isRecord(p)) return [];
    const { slug, title, description, client_side, server_side } = p;
    if (
      typeof slug !== "string" ||
      typeof title !== "string" ||
      typeof description !== "string" ||
      typeof client_side !== "string" ||
      typeof server_side !== "string"
    ) {
      return [];
    }
    return [{ slug, title, description, client_side, server_side }];
  });
}

async function fetchModrinthProjects(
  slugs: string[],
): Promise<ModrinthProject[]> {
  const ids = JSON.stringify(slugs);
  const url = `${MODRINTH_API}/projects?ids=${encodeURIComponent(ids)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "minecraft-discord-bot (contact via server admin)",
    },
  });
  if (!res.ok)
    throw new Error(`Modrinth API returned ${res.status}: ${res.statusText}`);
  return parseModrinthProjects(await res.json());
}

function buildModList(projects: ModrinthProject[]): ModList {
  const serverOnly: ModInfo[] = [];
  const clientOptional: ModInfo[] = [];
  const clientAndServer: ModInfo[] = [];

  for (const p of projects) {
    const info: ModInfo = {
      slug: p.slug,
      name: p.title,
      description: p.description,
      url: `https://modrinth.com/mod/${p.slug}`,
      side: classifySide(p),
    };
    switch (info.side) {
      case "server_only":
        serverOnly.push(info);
        break;
      case "client_optional":
        clientOptional.push(info);
        break;
      case "client_and_server":
        clientAndServer.push(info);
        break;
    }
  }

  const byName = (a: ModInfo, b: ModInfo) => a.name.localeCompare(b.name);
  return {
    serverOnly: serverOnly.sort(byName),
    clientOptional: clientOptional.sort(byName),
    clientAndServer: clientAndServer.sort(byName),
    fetchedAt: Date.now(),
  };
}

/** Evict the cached mod list for a server, e.g. after a mod update. */
export function evictModCache(serverId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${serverId}:`)) cache.delete(k);
  }
}

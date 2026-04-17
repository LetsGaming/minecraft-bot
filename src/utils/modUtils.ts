/**
 * Modrinth mod lookup service.
 *
 * Reads downloaded_versions.json from the server's scriptDir, fetches mod
 * metadata from the Modrinth API in a single batched request, classifies each
 * mod by client-side requirement, and caches the result in memory so repeated
 * /mods calls are instant.
 *
 * Layout expected on disk:
 *   {scriptDir}/common/downloaded_versions.json
 *
 * Cache is invalidated whenever the JSON file's mtime changes.
 */

import fs from "fs";
import path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export type ModSide = "server_only" | "client_optional" | "client_and_server";

export interface ModInfo {
  /** Modrinth project slug */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Short description from Modrinth */
  description: string;
  /** Modrinth project URL */
  url: string;
  side: ModSide;
}

export interface ModList {
  serverOnly: ModInfo[];
  clientOptional: ModInfo[];
  clientAndServer: ModInfo[];
  /** ISO timestamp of when the data was last fetched */
  fetchedAt: string;
}

// ── Downloaded-versions JSON shape ────────────────────────────────────────

interface DownloadedVersionsJson {
  mods?: Record<string, { versionId: string; filename: string }>;
}

// ── Modrinth API types (only the fields we use) ───────────────────────────

interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  /**
   * "required" | "optional" | "unsupported" | "unknown"
   * for client_side / server_side.
   */
  client_side: string;
  server_side: string;
}

// ── In-memory cache ───────────────────────────────────────────────────────

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

  // Server-only: client doesn't need it at all
  if (
    s === "required" &&
    (c === "unsupported" || c === "optional" || c === "unknown")
  ) {
    if (c === "unsupported") return "server_only";
  }
  if (s === "required" && c === "unsupported") return "server_only";

  // Client-and-server: both sides require it
  if (c === "required") return "client_and_server";

  // Client-optional: server requires it, but client can optionally have it
  // Also covers pure server mods where client side is "optional"
  return "client_optional";
}

// ── Core lookup ───────────────────────────────────────────────────────────

/**
 * Reads the downloaded_versions.json for the given server's scriptDir,
 * fetches Modrinth metadata for all mods in one batched request, and returns
 * a classified, cached ModList.
 *
 * Throws if scriptDir is not configured or the JSON file is missing.
 */
export async function getModList(scriptDir: string): Promise<ModList> {
  const jsonPath = path.join(scriptDir, "common", "downloaded_versions.json");

  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `downloaded_versions.json not found at ${jsonPath}.\n` +
        "Make sure scriptDir is correctly configured for this server.",
    );
  }

  const stat = fs.statSync(jsonPath);
  const cached = cache.get(jsonPath);

  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.modList;
  }

  const raw: DownloadedVersionsJson = JSON.parse(
    fs.readFileSync(jsonPath, "utf-8"),
  );
  const slugs = Object.keys(raw.mods ?? {});

  if (slugs.length === 0) {
    const empty: ModList = {
      serverOnly: [],
      clientOptional: [],
      clientAndServer: [],
      fetchedAt: new Date().toISOString(),
    };
    cache.set(jsonPath, { mtimeMs: stat.mtimeMs, modList: empty });
    return empty;
  }

  // Modrinth /projects endpoint accepts up to 500 IDs in a single request.
  // We use slugs as IDs since Modrinth accepts either.
  const projects = await fetchModrinthProjects(slugs);
  const modList = buildModList(projects);

  cache.set(jsonPath, { mtimeMs: stat.mtimeMs, modList });
  return modList;
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

  if (!res.ok) {
    throw new Error(`Modrinth API returned ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<ModrinthProject[]>;
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
  serverOnly.sort(byName);
  clientOptional.sort(byName);
  clientAndServer.sort(byName);

  return {
    serverOnly,
    clientOptional,
    clientAndServer,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Manually evict the cache for a given scriptDir, e.g. after a mod update.
 */
export function evictModCache(scriptDir: string): void {
  const jsonPath = path.join(scriptDir, "common", "downloaded_versions.json");
  cache.delete(jsonPath);
}

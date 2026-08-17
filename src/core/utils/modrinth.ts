/**
 * The dashboard's Modrinth client — the browse/search half of mod management.
 *
 * This lives in the dashboard, not the wrapper: searching Modrinth touches no
 * files and needs no privilege, and routing every keystroke through a
 * Minecraft host would only add a hop and a failure mode. The wrapper's job is
 * the host — install, update, remove, the installed manifest; this reaches out
 * to the catalogue.
 *
 * Modrinth is a third party, so every field is narrowed at the boundary: a
 * malformed hit is dropped rather than surfaced as undefined three layers up.
 * The three failure modes are kept distinct — a missing project (404) is not
 * an outage (5xx / refused) — because the route maps them to different statuses
 * and an outage must never read as a bad slug.
 *
 * One derived field the raw API does not give directly: `environment`. Modrinth
 * reports client_side and server_side each as required | optional | unsupported;
 * we collapse that pair into the four labels the UI shows, and the reason the
 * whole thing matters — we install on a *server*, so a client-only mod is
 * filtered out by default.
 */
import { log } from "./logger.js";

const MODRINTH_API = "https://api.modrinth.com/v2";
const USER_AGENT =
  "LetsGaming/minecraft-bot dashboard (mod browser; contact via server admin)";
const TIMEOUT_MS = 10_000;

// ── Environment ─────────────────────────────────────────────────────────────

/** The four labels the UI renders, derived from client_side + server_side. */
export type ModEnvironment = "server" | "client" | "both" | "optional" | "unknown";

/**
 * Collapse Modrinth's (client_side, server_side) pair into one label.
 *
 *   both      required on both sides — the normal server+client mod
 *   server    server-required, client-unsupported — a pure server mod
 *   client    client-required, server-unsupported — filtered out by default,
 *             because it does nothing on a server
 *   optional  needed on one side, optional on the other — safe to install,
 *             clients may or may not want it
 */
export function deriveEnvironment(
  clientSide: string,
  serverSide: string,
): ModEnvironment {
  const c = clientSide || "unknown";
  const sv = serverSide || "unknown";
  if (c === "required" && sv === "required") return "both";
  if (sv === "required" && c === "unsupported") return "server";
  if (c === "required" && sv === "unsupported") return "client";
  if (sv === "unsupported" && c === "unsupported") return "unknown";
  return "optional";
}

// ── Narrowed shapes ─────────────────────────────────────────────────────────

export interface ModSearchHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  follows: number;
  iconUrl: string | null;
  categories: string[];
  gameVersions: string[];
  clientSide: string;
  serverSide: string;
  environment: ModEnvironment;
  /** https://modrinth.com/mod/<slug> — the "look further" link. */
  pageUrl: string;
}

export interface ModSearchResult {
  hits: ModSearchHit[];
  offset: number;
  limit: number;
  totalHits: number;
}

export interface ModDependency {
  projectId: string | null;
  versionId: string | null;
  dependencyType: string;
}

export interface ModVersion {
  id: string;
  name: string;
  versionNumber: string;
  versionType: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  downloads: number;
  dependencies: ModDependency[];
  primaryFilename: string | null;
}

export interface ModProjectDetail {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  categories: string[];
  clientSide: string;
  serverSide: string;
  environment: ModEnvironment;
  iconUrl: string | null;
  downloads: number;
  followers: number;
  gameVersions: string[];
  loaders: string[];
  pageUrl: string;
  versions: ModVersion[];
}

export class ModrinthError extends Error {
  constructor(
    message: string,
    readonly kind: "not-found" | "upstream" | "network",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ModrinthError";
  }
}

// ── Narrowing helpers ───────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("modrinth", `request failed: ${msg}`);
    throw new ModrinthError(`Modrinth unreachable: ${msg}`, "network");
  }
  if (res.status === 404) throw new ModrinthError("Not found on Modrinth", "not-found", 404);
  if (!res.ok) {
    log.warn("modrinth", `HTTP ${res.status} for ${url}`);
    throw new ModrinthError(`Modrinth returned HTTP ${res.status}`, "upstream", res.status);
  }
  try {
    return await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ModrinthError(`Modrinth sent a malformed body: ${msg}`, "upstream");
  }
}

function parseHit(raw: unknown): ModSearchHit | null {
  if (!isRecord(raw)) return null;
  const projectId = str(raw.project_id);
  const slug = str(raw.slug);
  if (!projectId && !slug) return null;
  const clientSide = str(raw.client_side);
  const serverSide = str(raw.server_side);
  return {
    projectId,
    slug,
    title: str(raw.title),
    description: str(raw.description),
    author: str(raw.author),
    downloads: num(raw.downloads),
    follows: num(raw.follows),
    iconUrl: typeof raw.icon_url === "string" && raw.icon_url ? raw.icon_url : null,
    categories: strArray(raw.categories),
    gameVersions: strArray(raw.versions),
    clientSide,
    serverSide,
    environment: deriveEnvironment(clientSide, serverSide),
    pageUrl: `https://modrinth.com/mod/${slug || projectId}`,
  };
}

function parseVersion(raw: unknown): ModVersion | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const files = Array.isArray(raw.files) ? raw.files : [];
  const primary =
    files.find((f) => isRecord(f) && f.primary === true) ??
    (isRecord(files[0]) ? files[0] : null);
  const primaryFilename =
    primary && isRecord(primary) && typeof primary.filename === "string"
      ? primary.filename
      : null;
  const dependencies: ModDependency[] = (
    Array.isArray(raw.dependencies) ? raw.dependencies : []
  ).flatMap((d) =>
    isRecord(d)
      ? [
          {
            projectId: typeof d.project_id === "string" ? d.project_id : null,
            versionId: typeof d.version_id === "string" ? d.version_id : null,
            dependencyType: str(d.dependency_type),
          },
        ]
      : [],
  );
  return {
    id,
    name: str(raw.name),
    versionNumber: str(raw.version_number),
    versionType: str(raw.version_type),
    gameVersions: strArray(raw.game_versions),
    loaders: strArray(raw.loaders),
    datePublished: str(raw.date_published),
    downloads: num(raw.downloads),
    dependencies,
    primaryFilename,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface SearchParams {
  query: string;
  limit: number;
  offset: number;
  /** relevance | downloads | follows | newest | updated */
  sort: string;
  categories: string[];
  /** The instance's loader, added as a facet when restricting to compatible. */
  loader?: string;
  /** The instance's game version, added as a facet when restricting. */
  gameVersion?: string;
  /** Drop client-only hits (default policy: we install on a server). */
  hideClientOnly: boolean;
}

const VALID_SORTS = new Set(["relevance", "downloads", "follows", "newest", "updated"]);

export async function searchProjects(params: SearchParams): Promise<ModSearchResult> {
  const facets: string[][] = [["project_type:mod"]];
  if (params.categories.length > 0) {
    facets.push(params.categories.map((c) => `categories:${c}`));
  }
  if (params.loader) facets.push([`categories:${params.loader}`]);
  if (params.gameVersion) facets.push([`versions:${params.gameVersion}`]);

  const qs = new URLSearchParams({
    query: params.query,
    limit: String(params.limit),
    offset: String(params.offset),
    index: VALID_SORTS.has(params.sort) ? params.sort : "relevance",
    facets: JSON.stringify(facets),
  });

  const body = await getJson(`${MODRINTH_API}/search?${qs.toString()}`);
  if (!isRecord(body)) throw new ModrinthError("Modrinth search sent an unexpected body", "upstream");

  let hits = (Array.isArray(body.hits) ? body.hits : [])
    .map(parseHit)
    .filter((h): h is ModSearchHit => h !== null);
  if (params.hideClientOnly) hits = hits.filter((h) => h.environment !== "client");

  return {
    hits,
    offset: num(body.offset),
    limit: num(body.limit),
    totalHits: num(body.total_hits),
  };
}

export async function getProjectDetail(
  idOrSlug: string,
  filter: { loaders?: string[] } = {},
): Promise<ModProjectDetail> {
  const project = await getJson(`${MODRINTH_API}/project/${encodeURIComponent(idOrSlug)}`);
  if (!isRecord(project)) throw new ModrinthError("Modrinth sent an unexpected project body", "upstream");

  const versionsQs = new URLSearchParams();
  // Deliberately not filtered by game version: the picker needs older-version
  // builds too (a 1.21.3 jar the operator may still install on 1.21.4).
  if (filter.loaders?.length) versionsQs.set("loaders", JSON.stringify(filter.loaders));
  const projectId = str(project.id) || idOrSlug;
  const versionsUrl =
    `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version` +
    (versionsQs.toString() ? `?${versionsQs.toString()}` : "");

  const rawVersions = await getJson(versionsUrl);
  const versions = (Array.isArray(rawVersions) ? rawVersions : [])
    .map(parseVersion)
    .filter((v): v is ModVersion => v !== null)
    .sort((a, b) => b.datePublished.localeCompare(a.datePublished));

  const clientSide = str(project.client_side);
  const serverSide = str(project.server_side);
  const slug = str(project.slug);
  return {
    projectId,
    slug,
    title: str(project.title),
    description: str(project.description),
    categories: strArray(project.categories),
    clientSide,
    serverSide,
    environment: deriveEnvironment(clientSide, serverSide),
    iconUrl: typeof project.icon_url === "string" && project.icon_url ? project.icon_url : null,
    downloads: num(project.downloads),
    followers: num(project.followers),
    gameVersions: strArray(project.game_versions),
    loaders: strArray(project.loaders),
    pageUrl: `https://modrinth.com/mod/${slug || projectId}`,
    versions,
  };
}

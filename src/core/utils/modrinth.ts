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
import { errMsg } from "./error.js";
import { fetchJson, DEFAULT_TIMEOUT_MS, type FetchFailure } from "./http.js";
import { MS } from "@mcbot/schema/time.js";

export const MODRINTH_API = "https://api.modrinth.com/v2";
/** Modrinth can block by User-Agent, so every request this bot sends uses this one. */
export const MODRINTH_USER_AGENT =
  "LetsGaming/minecraft-bot (mod browser; contact via server admin)";
const TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

// ── Environment ─────────────────────────────────────────────────────────────

/** The four labels the UI renders, derived from client_side + server_side. */
export type ModEnvironment = "server" | "client" | "both" | "optional" | "unknown";

/**
 * Collapse Modrinth's (client_side, server_side) pair into one label.
 *
 *   both      required on both sides — the normal server+client mod
 *   server    server-required, client-unsupported — a pure server mod
 *   client    server-unsupported with a client that supports it; filtered
 *             out by default, because it does nothing on a server
 *   optional  needed on one side, optional on the other; safe to install,
 *             clients may or may not want it
 *   unknown   either side missing or unsupported on both
 */
export function deriveEnvironment(
  clientSide: string,
  serverSide: string,
): ModEnvironment {
  const c = clientSide || "unknown";
  const sv = serverSide || "unknown";
  if (c === "unknown" || sv === "unknown") return "unknown";
  if (c === "required" && sv === "required") return "both";
  if (sv === "required" && c === "unsupported") return "server";
  if (sv === "unsupported" && c === "unsupported") return "unknown";
  if (sv === "unsupported") return "client";
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

function toModrinthError(failure: FetchFailure, url: string): ModrinthError {
  switch (failure.kind) {
    case "network":
      log.warn("modrinth", `request failed: ${failure.message}`);
      return new ModrinthError(`Modrinth unreachable: ${failure.message}`, "network");
    case "status":
      if (failure.status === 404) {
        return new ModrinthError("Not found on Modrinth", "not-found", 404);
      }
      log.warn("modrinth", `HTTP ${failure.status} for ${url}`);
      return new ModrinthError(
        `Modrinth returned HTTP ${failure.status}`,
        "upstream",
        failure.status,
      );
    case "body":
      return new ModrinthError(`Modrinth sent a malformed body: ${failure.message}`, "upstream");
  }
}

async function getJson(url: string, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const result = await fetchJson(url, {
    headers: { "User-Agent": MODRINTH_USER_AGENT, Accept: "application/json" },
    timeoutMs,
  });
  if (!result.ok) throw toModrinthError(result.failure, url);
  return result.value;
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
    iconUrl: cdnIcon(raw.icon_url),
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
    iconUrl: cdnIcon(project.icon_url),
    downloads: num(project.downloads),
    followers: num(project.followers),
    gameVersions: strArray(project.game_versions),
    loaders: strArray(project.loaders),
    pageUrl: `https://modrinth.com/mod/${slug || projectId}`,
    versions,
  };
}

// ── Project icons, looked up in bulk ────────────────────────────────────────

/** Ids or slugs per `GET /projects?ids=` request; keeps the URL a few KB long. */
export const ICON_LOOKUP_BATCH = 50;
/** Keys one lookup resolves; the rest of a larger list gets no icon. */
export const ICON_LOOKUP_MAX_KEYS = 300;
/** Entries the icon cache holds before the oldest is evicted. */
export const ICON_CACHE_MAX_ENTRIES = 2000;
const ICON_TTL_MS = 6 * MS.hour;
/** A key Modrinth does not know (a jar from elsewhere) is asked again after this. */
const ICON_MISS_TTL_MS = MS.hour;
/** After a failed request the keys rest this long, so a polling view cannot hammer Modrinth. */
const ICON_FAILURE_TTL_MS = MS.minute;
const ICON_LOOKUP_TIMEOUT_MS = 4 * MS.second;
const ICON_HOST = "cdn.modrinth.com";
const PROJECT_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

const iconCache = new Map<string, { expires: number; iconUrl: string | null }>();
const iconInflight = new Map<string, Promise<void>>();

export function clearProjectIconCache(): void {
  iconCache.clear();
  iconInflight.clear();
}

function rememberIcon(key: string, iconUrl: string | null, ttlMs: number): void {
  iconCache.delete(key);
  iconCache.set(key, { expires: Date.now() + ttlMs, iconUrl });
  while (iconCache.size > ICON_CACHE_MAX_ENTRIES) {
    const oldest = iconCache.keys().next().value;
    if (oldest === undefined) break;
    iconCache.delete(oldest);
  }
}

/** Only Modrinth's own CDN over https; anything else is treated as no icon. */
function cdnIcon(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === ICON_HOST ? url.href : null;
  } catch {
    return null;
  }
}

async function fetchIconBatch(keys: string[]): Promise<void> {
  try {
    const body = await getJson(
      `${MODRINTH_API}/projects?ids=${encodeURIComponent(JSON.stringify(keys))}`,
      ICON_LOOKUP_TIMEOUT_MS,
    );
    const found = new Map<string, string | null>();
    for (const raw of Array.isArray(body) ? body : []) {
      if (!isRecord(raw)) continue;
      const icon = cdnIcon(raw.icon_url);
      for (const name of [str(raw.slug), str(raw.id)]) {
        if (name) found.set(name.toLowerCase(), icon);
      }
    }
    for (const key of keys) {
      if (found.has(key)) rememberIcon(key, found.get(key) ?? null, ICON_TTL_MS);
      else rememberIcon(key, null, ICON_MISS_TTL_MS);
    }
  } catch (err) {
    log.warn("modrinth", `icon lookup failed for ${keys.length} projects: ${errMsg(err)}`);
    for (const key of keys) rememberIcon(key, null, ICON_FAILURE_TTL_MS);
  }
}

/**
 * Icon URLs for installed projects, by slug or project id. Answers come from
 * a bounded cache; what is missing is asked in batches, and a key that is
 * already being asked waits for that request instead of sending another.
 * Never throws: a key without an answer simply has no icon in the result.
 */
export async function lookupProjectIcons(keys: Iterable<string>): Promise<Map<string, string>> {
  const wanted: string[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    if (wanted.length >= ICON_LOOKUP_MAX_KEYS) break;
    if (!PROJECT_KEY.test(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(key);
  }

  const now = Date.now();
  const waiting: Promise<void>[] = [];
  const missing: string[] = [];
  for (const key of wanted) {
    const hit = iconCache.get(key);
    if (hit && hit.expires > now) continue;
    const pending = iconInflight.get(key);
    if (pending) waiting.push(pending);
    else missing.push(key);
  }

  for (let i = 0; i < missing.length; i += ICON_LOOKUP_BATCH) {
    const batch = missing.slice(i, i + ICON_LOOKUP_BATCH);
    const request = fetchIconBatch(batch).finally(() => {
      for (const key of batch) if (iconInflight.get(key) === request) iconInflight.delete(key);
    });
    for (const key of batch) iconInflight.set(key, request);
    waiting.push(request);
  }
  await Promise.all(waiting);

  const out = new Map<string, string>();
  for (const key of wanted) {
    const icon = iconCache.get(key)?.iconUrl;
    if (icon) out.set(key, icon);
  }
  return out;
}

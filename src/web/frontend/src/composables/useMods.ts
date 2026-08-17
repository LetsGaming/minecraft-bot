import { apiGet, apiSend } from "../api";
import type {
  InstalledMods,
  ModSearchResult,
  ModProjectDetail,
  ModUpdateCheck,
  ModAddResult,
  ModRemoveResult,
  ModApplyResult,
  ModEnvironment,
} from "../api";

/**
 * The Mods tab's data access — thin wrappers over the backend routes.
 *
 * Deliberately stateless: the view owns the reactive state (there is one Mods
 * view at a time, so a module-level singleton like useCapabilities would buy
 * nothing). This just builds the URLs, keeps the encoding in one place, and
 * carries the environment-label mapping the installed list and the browse list
 * both render.
 */

const enc = encodeURIComponent;

export interface SearchOptions {
  query: string;
  sort?: string;
  limit?: number;
  offset?: number;
  categories?: string[];
  /** false = browse the whole catalogue, not just this server's loader/version. */
  compatible?: boolean;
  /** false = also show client-only mods (hidden by default on a server). */
  hideClientOnly?: boolean;
}

/** Label + dot colour for a mod's environment, shared by both lists. */
export const ENVIRONMENT_META: Record<
  ModEnvironment,
  { label: string; color: string }
> = {
  both: { label: "Client + Server", color: "#5b8def" },
  server: { label: "Server only", color: "#3ecf6e" },
  optional: { label: "Client optional", color: "#e5a13a" },
  client: { label: "Client only", color: "#e5544b" },
  unknown: { label: "Unknown", color: "#8a8a90" },
};

export function useMods(serverId: () => string) {
  function base(): string {
    return `/api/servers/${enc(serverId())}/mods`;
  }

  function fetchInstalled(): Promise<InstalledMods> {
    return apiGet<InstalledMods>(`${base()}/installed`);
  }

  function checkUpdates(): Promise<ModUpdateCheck> {
    return apiGet<ModUpdateCheck>(`${base()}/updates`);
  }

  function applyUpdates(mcVersion?: string): Promise<ModApplyResult> {
    return apiSend<ModApplyResult>("POST", `${base()}/updates`, mcVersion ? { mcVersion } : {});
  }

  function install(body: {
    slug: string;
    mcVersion?: string;
    modLoader?: string;
  }): Promise<ModAddResult> {
    return apiSend<ModAddResult>("POST", base(), body);
  }

  function remove(slug: string): Promise<ModRemoveResult> {
    return apiSend<ModRemoveResult>("DELETE", `${base()}/${enc(slug)}`);
  }

  function search(opts: SearchOptions): Promise<ModSearchResult> {
    const qs = new URLSearchParams();
    if (opts.query) qs.set("query", opts.query);
    if (opts.sort) qs.set("sort", opts.sort);
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
    if (opts.categories?.length) qs.set("categories", opts.categories.join(","));
    if (opts.compatible === false) qs.set("compatible", "false");
    if (opts.hideClientOnly === false) qs.set("hideClientOnly", "false");
    return apiGet<ModSearchResult>(`${base()}/search?${qs.toString()}`);
  }

  function catalog(slug: string): Promise<ModProjectDetail> {
    return apiGet<ModProjectDetail>(`${base()}/catalog/${enc(slug)}`);
  }

  return {
    fetchInstalled,
    checkUpdates,
    applyUpdates,
    install,
    remove,
    search,
    catalog,
  };
}

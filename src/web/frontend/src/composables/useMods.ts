import { apiGet, apiSend } from "../api";
import type { MessageKey } from "../i18n";
import type {
  InstalledMods,
  ModSearchResult,
  ModProjectDetail,
  ModUpdateCheck,
  ModAddResult,
  ModRemoveResult,
  ModApplyResult,
  ModToggleResult,
  ModEnvironment,
  ModCompatJob,
  ModCompatStarted,
} from "../api";

/**
 * The Mods tab's data access — thin wrappers over the backend routes.
 *
 * Deliberately stateless: the view owns the reactive state (there is one Mods
 * view at a time, so a module-level singleton like useCapabilities would buy
 * nothing). This just builds the URLs, keeps the encoding in one place, and
 * carries the environment-label mapping the catalogue renders.
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

/** The label key for a mod's environment, shared by the catalogue rows. */
export const ENVIRONMENT_LABEL: Record<ModEnvironment, MessageKey> = {
  both: "mods.env.both",
  server: "mods.env.server",
  optional: "mods.env.optional",
  client: "mods.env.client",
  unknown: "mods.env.unknown",
};

export function useMods(serverId: () => string) {
  function base(): string {
    return `/api/servers/${enc(serverId())}/mods`;
  }

  function fetchInstalled(): Promise<InstalledMods> {
    return apiGet<InstalledMods>(`${base()}/installed`);
  }

  function checkUpdates(refresh = false): Promise<ModUpdateCheck> {
    return apiGet<ModUpdateCheck>(`${base()}/updates${refresh ? "?refresh=true" : ""}`);
  }

  function compatStart(mcVersion: string, refresh = false): Promise<ModCompatStarted> {
    return apiSend<ModCompatStarted>("POST", `${base()}/compat`, {
      mcVersion,
      ...(refresh ? { refresh: true } : {}),
    });
  }

  function compatPoll(jobId: string): Promise<ModCompatJob> {
    return apiGet<ModCompatJob>(`${base()}/compat/${enc(jobId)}`);
  }

  function compatVersions(): Promise<{ versions: string[] }> {
    return apiGet<{ versions: string[] }>(`${base()}/compat/versions`);
  }

  function applyUpdates(mcVersion?: string): Promise<ModApplyResult> {
    return apiSend<ModApplyResult>("POST", `${base()}/updates`, mcVersion ? { mcVersion } : {});
  }

  function install(body: {
    slug: string;
    mcVersion?: string;
    modLoader?: string;
    versionId?: string;
  }): Promise<ModAddResult> {
    return apiSend<ModAddResult>("POST", base(), body);
  }

  function remove(slug: string): Promise<ModRemoveResult> {
    return apiSend<ModRemoveResult>("DELETE", `${base()}/${enc(slug)}`);
  }

  /** Update one installed mod to its latest compatible build. */
  function updateOne(slug: string): Promise<ModApplyResult> {
    return apiSend<ModApplyResult>("POST", `${base()}/${enc(slug)}/update`, {});
  }

  /** Disable a mod without uninstalling it. Takes effect on the server's next start. */
  function disable(slug: string): Promise<ModToggleResult> {
    return apiSend<ModToggleResult>("POST", `${base()}/${enc(slug)}/disable`, {});
  }

  /** Re-enable a previously disabled mod. Takes effect on the server's next start. */
  function enable(slug: string): Promise<ModToggleResult> {
    return apiSend<ModToggleResult>("POST", `${base()}/${enc(slug)}/enable`, {});
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
    compatStart,
    compatPoll,
    compatVersions,
    applyUpdates,
    install,
    remove,
    updateOne,
    disable,
    enable,
    search,
    catalog,
  };
}

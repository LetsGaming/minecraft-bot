/** Installed mod listing and management. */

import type { ServerConfig } from "../../../types/index.js";
import type {
  InstalledMods,
  ModAddResult,
  ModApplyResult,
  ModRemoveResult,
  ModToggleResult,
  ModUpdateCheck,
} from "@mcbot/schema/wire/index.js";
import { ApiError, apiGet, apiPost, apiDelete } from "./apiClient.js";
import { WRAPPER_TIMEOUTS_MS } from "./wrapperTimeouts.js";

export interface ModSlugs {
  slugs: string[];
  /** mtime of downloaded_versions.json. */
  mtimeMs: number;
  gameVersion: string | null;
  modLoader: string | null;
}

/**
 * Return the raw mod slugs and the mtime of downloaded_versions.json, plus
 * the game version and loader when the wrapper offers the installed list.
 * The caller (modUtils.ts) handles the Modrinth lookup and caching.
 */
export async function readModSlugs(cfg: ServerConfig): Promise<ModSlugs> {
  const [list, installed] = await Promise.all([
    apiGet<{ slugs: string[]; mtimeMs: number }>(cfg, "/mods"),
    // Version and loader come only with the mod-management feature; without
    // it the plain slug list still answers /mods.
    listInstalledMods(cfg).catch((err: unknown) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return null;
      throw err;
    }),
  ]);
  return {
    slugs: list.slugs,
    mtimeMs: list.mtimeMs,
    gameVersion: installed?.gameVersion ?? null,
    modLoader: installed?.modLoader ?? null,
  };
}

/** The richer installed list (versions, loader, filenames) the Mods tab reads. */
export async function listInstalledMods(cfg: ServerConfig): Promise<InstalledMods> {
  return apiGet<InstalledMods>(cfg, "/mods/installed");
}

/** Install a mod. Long timeout: the wrapper downloads the jar and its deps. */
export async function addMod(
  cfg: ServerConfig,
  body: {
    slug: string;
    mcVersion?: string;
    modLoader?: string;
    /** Pin to this exact Modrinth build instead of the newest compatible one. */
    versionId?: string;
  },
): Promise<ModAddResult> {
  return apiPost<ModAddResult>(cfg, "/mods", body, WRAPPER_TIMEOUTS_MS.modDownload);
}

/** Remove an installed mod by slug. */
export async function removeMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModRemoveResult> {
  return apiDelete<ModRemoveResult>(cfg, `/mods/${encodeURIComponent(slug)}`);
}

/** Check installed mods for updates. Longer timeout: one Modrinth call per mod. */
export async function checkModUpdates(
  cfg: ServerConfig,
  mcVersion?: string,
): Promise<ModUpdateCheck> {
  const q = mcVersion ? `?mcVersion=${encodeURIComponent(mcVersion)}` : "";
  return apiGet<ModUpdateCheck>(cfg, `/mods/updates${q}`, WRAPPER_TIMEOUTS_MS.modDownload);
}

/** Apply all available updates. Long timeout: downloads every updated jar. */
export async function applyModUpdates(
  cfg: ServerConfig,
  mcVersion?: string,
): Promise<ModApplyResult> {
  return apiPost<ModApplyResult>(
    cfg,
    "/mods/updates",
    mcVersion ? { mcVersion } : {},
    WRAPPER_TIMEOUTS_MS.modApplyAll,
  );
}

/** Update one installed mod to its latest compatible build. */
export async function updateMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModApplyResult> {
  return apiPost<ModApplyResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/update`,
    {},
    WRAPPER_TIMEOUTS_MS.modDownload,
  );
}

/**
 * Disable an installed mod without uninstalling it; moves its jar out of
 * mods/ so the loader stops loading it, but keeps it update-checkable.
 * Takes effect on the server's next start.
 */
export async function disableMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModToggleResult> {
  return apiPost<ModToggleResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/disable`,
    {},
  );
}

/** Re-enable a previously disabled mod. Takes effect on the server's next start. */
export async function enableMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModToggleResult> {
  return apiPost<ModToggleResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/enable`,
    {},
  );
}

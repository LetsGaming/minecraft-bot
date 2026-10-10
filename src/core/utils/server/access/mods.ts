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
import { apiGet, apiPost, apiDelete } from "./apiClient.js";

/**
 * Return the raw mod slugs and the mtime of downloaded_versions.json.
 * The caller (modUtils.ts) handles the Modrinth lookup and caching —
 * that logic is the same regardless of local/remote.
 */
export async function readModSlugs(
  cfg: ServerConfig,
): Promise<{ slugs: string[]; mtimeMs: number }> {
  return apiGet<{ slugs: string[]; mtimeMs: number }>(cfg, "/mods");
}

//
// The result types come from the wrapper's generated contract
// (@mcbot/schema/wire). Casting the JSON asserts that contract, gated at
// connect time by the feature handshake, the same basis as every apiGet above.

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
  return apiPost<ModAddResult>(cfg, "/mods", body, 130_000);
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
  return apiGet<ModUpdateCheck>(cfg, `/mods/updates${q}`, 130_000);
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
    610_000,
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
    130_000,
  );
}

/**
 * Disable an installed mod without uninstalling it — moves its jar out of
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

/** Background mod compatibility check against a target Minecraft version. */

import type { ServerConfig } from "../../../types/index.js";
import type { ModCompatJob, ModCompatStarted } from "@mcbot/schema/wire/index.js";
import { apiGetOrNull, apiPost } from "./apiClient.js";
import { featureAtLeast } from "./manifest.js";

/**
 * Whether this wrapper can run the background compatibility check. A
 * wrapper that predates the manifest, or is unreachable, answers false so the
 * dashboard hides the control and keeps the per-installed-version check.
 */
export async function supportsModCompat(cfg: ServerConfig): Promise<boolean> {
  return featureAtLeast(cfg, "mod-compat", 1);
}

/**
 * Start (or join) the wrapper's job that checks every installed mod for a
 * release on `mcVersion`. One job runs per version on the wrapper, so asking
 * twice returns the same job id.
 */
export async function startModCompat(
  cfg: ServerConfig,
  mcVersion: string,
  refresh = false,
): Promise<ModCompatStarted> {
  return apiPost<ModCompatStarted>(cfg, "/mods/compat", {
    mcVersion,
    ...(refresh ? { refresh: true } : {}),
  });
}

/** Progress and result of a compatibility job; null once the wrapper forgot it (404). */
export async function getModCompat(
  cfg: ServerConfig,
  jobId: string,
): Promise<ModCompatJob | null> {
  return apiGetOrNull<ModCompatJob>(cfg, `/mods/compat/${encodeURIComponent(jobId)}`);
}

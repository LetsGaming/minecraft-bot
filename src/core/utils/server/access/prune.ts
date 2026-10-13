/** Chunk pruning: scans, saved settings, plan maps and the prune job. */

import type { ServerConfig } from "../../../types/index.js";
import type {
  PruneMap,
  PruneParams,
  PruneParamsRequest,
  PruneScanJob,
  PruneScanStarted,
  UpgradeStarted,
} from "@mcbot/schema/wire/index.js";
import { apiGet, apiGetRaw, apiPost, apiPut, readApiJson } from "./apiClient.js";
import { detectCapabilities } from "./capabilityProbe.js";
import { getRemoteManifest } from "./manifest.js";

/**
 * Whether this wrapper can prune chunks: it advertises the feature and its
 * setup suite has world/prune-chunks.js. A wrapper that predates the manifest,
 * or is unreachable, answers false so the dashboard hides the control.
 */
export async function supportsPrune(cfg: ServerConfig): Promise<boolean> {
  const manifest = await getRemoteManifest(cfg);
  if ((manifest?.features?.["chunk-prune"]?.version ?? 0) < 1) return false;
  const caps = await detectCapabilities(cfg);
  return caps.prune !== false;
}

/** Start a read-only scan. Without parameters the saved settings are used. */
export async function startPruneScan(
  cfg: ServerConfig,
  params?: PruneParamsRequest,
): Promise<PruneScanStarted> {
  return apiPost<PruneScanStarted>(cfg, "/prune/scans", params ?? {});
}

/** A scan's progress and summary; null once the wrapper forgot it (404). */
export async function getPruneScan(cfg: ServerConfig, jobId: string): Promise<PruneScanJob | null> {
  const route = `/prune/scans/${encodeURIComponent(jobId)}`;
  const res = await apiGetRaw(cfg, route);
  if (res.status === 404) return null;
  return readApiJson<PruneScanJob>(res, route);
}

export async function getPruneSettings(cfg: ServerConfig): Promise<PruneParams> {
  return apiGet<PruneParams>(cfg, "/prune/settings");
}

export async function setPruneSettings(
  cfg: ServerConfig,
  params: PruneParamsRequest,
): Promise<PruneParams> {
  return apiPut<PruneParams>(cfg, "/prune/settings", params);
}

/**
 * One dimension of a stored plan, for drawing. A map can be megabytes, so the
 * timeout is generous; null when the plan expired (404).
 */
export async function getPruneMap(
  cfg: ServerConfig,
  planId: string,
  dimensionIndex: number,
): Promise<PruneMap | null> {
  const route = `/prune/plans/${encodeURIComponent(planId)}/map/${dimensionIndex}`;
  const res = await apiGetRaw(cfg, route, 60_000);
  if (res.status === 404) return null;
  return readApiJson<PruneMap>(res, route);
}

/**
 * Delete what a plan names: a job that stops the server, backs it up, deletes
 * and starts it. Poll it with getUpgrade. A 423 ApiError means another
 * operation holds the instance.
 */
export async function startPrune(
  cfg: ServerConfig,
  planId: string,
  countdownSeconds?: number,
): Promise<UpgradeStarted> {
  return apiPost<UpgradeStarted>(cfg, "/operations/prune", {
    planId,
    ...(countdownSeconds !== undefined ? { countdownSeconds } : {}),
  });
}

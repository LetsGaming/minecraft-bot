/** Chunk pruning: scans, saved settings, plan maps and the prune job. */

import type { ServerConfig } from "../../../types/index.js";
import type {
  PruneChunkInfo,
  PruneDimensions,
  PruneEngineStatus,
  PruneMap,
  PruneParams,
  PruneParamsRequest,
  PruneScanJob,
  PruneScanStarted,
  UpgradeStarted,
} from "@mcbot/schema/wire/index.js";
import { ApiError, apiGet, apiGetRaw, apiPost, apiPut, readApiJson } from "./apiClient.js";
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

/** The world's dimensions and their region counts; no chunk is read. */
export async function getPruneDimensions(cfg: ServerConfig): Promise<PruneDimensions> {
  return apiGet<PruneDimensions>(cfg, "/prune/dimensions");
}

/** The engine version, and a note when an earlier delete never finished. */
export async function getPruneStatus(cfg: ServerConfig): Promise<PruneEngineStatus> {
  return apiGet<PruneEngineStatus>(cfg, "/prune/status");
}

/** Stop a running scan. False when there is no such running scan (404). */
export async function cancelPruneScan(cfg: ServerConfig, jobId: string): Promise<boolean> {
  try {
    await apiPost<{ cancelled: boolean }>(cfg, `/prune/scans/${encodeURIComponent(jobId)}/cancel`, {});
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return false;
    throw err;
  }
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

/** A region drawn from above, as PNG bytes and the ETag that names the picture. Null when the region does not exist. */
export async function getPruneTile(
  cfg: ServerConfig,
  dimension: string,
  rx: number,
  rz: number,
): Promise<{ png: Buffer; etag: string } | null> {
  const route = `/prune/tiles/${encodeURIComponent(dimension)}/${rx}/${rz}`;
  // Drawing a region reads all of it; the wrapper allows itself 90 s.
  const res = await apiGetRaw(cfg, route, 100_000);
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(route, res.status, (await res.text()).slice(0, 200));
  return { png: Buffer.from(await res.arrayBuffer()), etag: res.headers.get("etag") ?? "" };
}

/** One chunk of a plan, read now: what it holds and why it is kept or deleted. Null once the plan expired. */
export async function getPruneChunk(
  cfg: ServerConfig,
  planId: string,
  dimension: string,
  cx: number,
  cz: number,
): Promise<PruneChunkInfo | null> {
  const query = `dimension=${encodeURIComponent(dimension)}&cx=${cx}&cz=${cz}`;
  const route = `/prune/plans/${encodeURIComponent(planId)}/chunk?${query}`;
  const res = await apiGetRaw(cfg, route, 30_000);
  if (res.status === 404) return null;
  return readApiJson<PruneChunkInfo>(res, route);
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

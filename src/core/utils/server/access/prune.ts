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
import {
  apiErrorFrom,
  apiGet,
  apiGetOrNull,
  apiGetRaw,
  apiPost,
  apiPut,
  readApiJson,
  requestLabel,
  wrapperFetch,
} from "./apiClient.js";
import { detectCapabilities } from "./capabilityProbe.js";
import { featureAtLeast } from "./manifest.js";
import { WRAPPER_TIMEOUTS_MS } from "./wrapperTimeouts.js";

/**
 * Whether this wrapper can prune chunks: it advertises the feature and its
 * setup suite has world/prune-chunks.js. A wrapper that predates the manifest,
 * or is unreachable, answers false so the dashboard hides the control.
 */
export async function supportsPrune(cfg: ServerConfig): Promise<boolean> {
  return (await pruneSupportGap(cfg)) === null;
}

/**
 * Which half is missing when pruning is unavailable: the API wrapper (it does
 * not advertise `chunk-prune`, or could not be reached) or the setup suite on
 * the host (no `world/prune-chunks.js`). Null when pruning is available.
 */
export async function pruneSupportGap(cfg: ServerConfig): Promise<"wrapper" | "suite" | null> {
  if (!(await featureAtLeast(cfg, "chunk-prune", 1))) return "wrapper";
  const caps = await detectCapabilities(cfg);
  return caps.prune === false ? "suite" : null;
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
  const route = `/prune/scans/${encodeURIComponent(jobId)}/cancel`;
  const res = await wrapperFetch(cfg, route, {
    method: "POST",
    body: {},
    timeoutMs: WRAPPER_TIMEOUTS_MS.mutate,
  });
  if (res.status === 404) return false;
  await readApiJson<{ cancelled: boolean }>(res, requestLabel("POST", route));
  return true;
}

/** A scan's progress and summary; null once the wrapper forgot it (404). */
export async function getPruneScan(cfg: ServerConfig, jobId: string): Promise<PruneScanJob | null> {
  return apiGetOrNull<PruneScanJob>(cfg, `/prune/scans/${encodeURIComponent(jobId)}`);
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
  return apiGetOrNull<PruneMap>(cfg, route, WRAPPER_TIMEOUTS_MS.pruneMap);
}

/** A region drawn from above, as PNG bytes and the ETag that names the picture. Null when the region does not exist. */
export async function getPruneTile(
  cfg: ServerConfig,
  dimension: string,
  rx: number,
  rz: number,
): Promise<{ png: Buffer; etag: string } | null> {
  const route = `/prune/tiles/${encodeURIComponent(dimension)}/${rx}/${rz}`;
  const res = await apiGetRaw(cfg, route, WRAPPER_TIMEOUTS_MS.pruneTile);
  if (res.status === 404) return null;
  if (!res.ok) throw await apiErrorFrom(res, route);
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
  return apiGetOrNull<PruneChunkInfo>(cfg, route, WRAPPER_TIMEOUTS_MS.pruneChunk);
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

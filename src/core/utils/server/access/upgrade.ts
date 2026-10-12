/** Minecraft version upgrade jobs and the server's lifecycle events. */

import type { ServerConfig } from "../../../types/index.js";
import type {
  LifecycleEventsBody,
  UpgradeJob,
  UpgradeRequest,
  UpgradeStarted,
} from "@mcbot/schema/wire/index.js";
import { apiGet, apiGetRaw, apiPost, readApiJson } from "./apiClient.js";
import { detectCapabilities } from "./capabilityProbe.js";
import { getRemoteManifest } from "./manifest.js";

/**
 * Whether this wrapper can run the upgrade job: it advertises the feature and
 * its setup suite has update/upgrade.sh. A wrapper that predates the manifest,
 * or is unreachable, answers false so the dashboard hides the control.
 */
export async function supportsUpgrade(cfg: ServerConfig): Promise<boolean> {
  const manifest = await getRemoteManifest(cfg);
  if ((manifest?.features?.operations?.version ?? 0) < 1) return false;
  const caps = await detectCapabilities(cfg);
  return caps.upgrade !== false;
}

/** Whether the wrapper serves the lifecycle event feed. */
export async function supportsLifecycleEvents(cfg: ServerConfig): Promise<boolean> {
  const manifest = await getRemoteManifest(cfg);
  return (manifest?.features?.["lifecycle-events"]?.version ?? 0) >= 1;
}

/**
 * Start the upgrade job. A 423 ApiError means another operation holds the
 * instance; its body names the holder.
 */
export async function startUpgrade(
  cfg: ServerConfig,
  request: UpgradeRequest,
): Promise<UpgradeStarted> {
  return apiPost<UpgradeStarted>(cfg, "/operations/upgrade", request);
}

function sinceQuery(since: number): string {
  return since > 0 ? `?since=${since}` : "";
}

/** One job's progress after `since`; null once the wrapper forgot it (404). */
export async function getUpgrade(
  cfg: ServerConfig,
  jobId: string,
  since = 0,
): Promise<UpgradeJob | null> {
  const route = `/operations/upgrade/${encodeURIComponent(jobId)}${sinceQuery(since)}`;
  const res = await apiGetRaw(cfg, route);
  if (res.status === 404) return null;
  return readApiJson<UpgradeJob>(res, route);
}

/** The running or latest upgrade, or null when there has been none. */
export async function getCurrentUpgrade(
  cfg: ServerConfig,
  since = 0,
): Promise<UpgradeJob | null> {
  const route = `/operations/upgrade/current${sinceQuery(since)}`;
  const res = await apiGetRaw(cfg, route);
  if (res.status === 404) return null;
  return readApiJson<UpgradeJob>(res, route);
}

/** Lifecycle events after the byte offset `since`. */
export async function readLifecycleEvents(
  cfg: ServerConfig,
  since = 0,
): Promise<LifecycleEventsBody> {
  return apiGet<LifecycleEventsBody>(cfg, `/events${sinceQuery(since)}`);
}

/** Wrapper feature manifest and the startup contract check. */

import {
  MIN_WRAPPER_VERSION,
  compareContract,
  logContractReport,
  parseManifest,
  type WrapperManifest,
  type WrapperFeatureName,
} from "../wrapperContract.js";
import { log } from "../../logger.js";
import { errMsg } from "../../error.js";
import { cached } from "../../cache.js";
import type { ServerConfig } from "../../../types/index.js";
import { wrapperUrl } from "./apiClient.js";
import { getRemoteInfo, versionAtLeast } from "./host.js";

export const advertisedScriptTimeouts = new Map<string, Record<string, number>>();

export function wrapperKey(cfg: ServerConfig): string {
  return `${cfg.apiUrl}#${cfg.id}`;
}

/**
 * Fetch the wrapper's feature manifest, or null when it predates the
 * endpoint (404), is unreachable, or answers something unparseable.
 *
 * Deliberately not `apiGet<WrapperManifest>`: every other wrapper
 * response is cast to its type because the version gate pins the
 * contract, but this endpoint *is* the gate. Trusting its shape would
 * assume what it exists to establish, so it goes through parseManifest.
 */
export async function getRemoteManifest(
  cfg: ServerConfig,
): Promise<WrapperManifest | null> {
  if (!cfg.apiUrl) return null;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  try {
    const res = await fetch(wrapperUrl(cfg, "/manifest"), {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null; // 404 on wrappers that predate the endpoint
    const manifest = parseManifest(await res.json());
    if (manifest?.scriptTimeoutsMs) {
      advertisedScriptTimeouts.set(
        wrapperKey(cfg),
        manifest.scriptTimeoutsMs,
      );
    }
    return manifest;
  } catch {
    return null;
  }
}

const MANIFEST_TTL_MS = 5 * 60_000;

/**
 * The version of one wrapper feature, or 0 when the wrapper does not
 * advertise it (or can't be asked right now). A manifest is cached for a few
 * minutes; a failed fetch is not, so a wrapper that comes back is seen on
 * the next call.
 */
export async function wrapperFeatureVersion(
  cfg: ServerConfig,
  feature: WrapperFeatureName,
): Promise<number> {
  try {
    const manifest = await cached(`manifest:${wrapperKey(cfg)}`, MANIFEST_TTL_MS, async () => {
      const m = await getRemoteManifest(cfg);
      if (!m) throw new Error("no manifest");
      return m;
    });
    return manifest.features[feature]?.version ?? 0;
  } catch (err) {
    log.debug(cfg.id, `wrapper manifest unavailable, treating "${feature}" as unsupported: ${errMsg(err)}`);
    return 0;
  }
}

/**
 * Report, at startup, where a remote instance's wrapper and this bot
 * disagree about what exists. Never throws; a mismatched wrapper
 * degrades features, it must not stop the bot.
 *
 * Preferred path is the manifest, which names the individual features.
 * Wrappers older than that get the coarse version compare they were
 * built for.
 */
export async function verifyWrapperContract(
  cfg: ServerConfig,
  botVersion: string,
): Promise<void> {
  if (!cfg.apiUrl) return;

  const manifest = await getRemoteManifest(cfg);
  if (manifest) {
    logContractReport(cfg.id, manifest, compareContract(manifest), botVersion);
    return;
  }

  // ── Fallback: no manifest, so all we have is /info's version.
  const info = await getRemoteInfo(cfg);
  if (!info || !info.version) {
    log.warn(
      cfg.id,
      `API wrapper reports neither a manifest nor a version (both /manifest ` +
        `and /info missing; wrapper predates ${MIN_WRAPPER_VERSION}). Remote ` +
        `host metrics, usercache names, and capability gating are ` +
        `unavailable until the wrapper is updated.`,
    );
    return;
  }
  if (!versionAtLeast(info.version, MIN_WRAPPER_VERSION)) {
    log.warn(
      cfg.id,
      `API wrapper ${info.version} is older than the expected ` +
        `${MIN_WRAPPER_VERSION}; some remote features may silently degrade. ` +
        `Update the wrapper on the server host.`,
    );
    return;
  }
  log.warn(
    cfg.id,
    `API wrapper ${info.version} does not publish /manifest, so this bot ` +
      `cannot check which remote features are available; a missing one will ` +
      `only show up as a feature quietly doing nothing. Update the wrapper.`,
  );
}

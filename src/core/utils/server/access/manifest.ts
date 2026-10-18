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
import { wrapperFetch } from "./apiClient.js";
import { MS } from "@mcbot/schema/time.js";
import { getRemoteInfo, versionAtLeast } from "./host.js";

export function wrapperKey(cfg: ServerConfig): string {
  return `${cfg.apiUrl}#${cfg.id}`;
}

const advertisedScriptTimeouts = new Map<string, Record<string, number>>();

/** The script ceilings this wrapper last advertised in its manifest, if any. */
export function getAdvertisedScriptTimeouts(cfg: ServerConfig): Record<string, number> | undefined {
  return advertisedScriptTimeouts.get(wrapperKey(cfg));
}

/** Drop what a wrapper advertised, e.g. when its server is removed or re-pointed. */
export function forgetAdvertisedScriptTimeouts(cfg: ServerConfig): void {
  advertisedScriptTimeouts.delete(wrapperKey(cfg));
}

/**
 * Fetch the wrapper's feature manifest, uncached, or null when it predates the
 * endpoint (404), is unreachable, or answers something unparseable.
 *
 * Deliberately not `apiGet<WrapperManifest>`: this endpoint is what tells the
 * bot which contract the wrapper speaks, so trusting its shape would assume
 * what it exists to establish. It goes through parseManifest.
 */
export async function getRemoteManifest(
  cfg: ServerConfig,
): Promise<WrapperManifest | null> {
  try {
    const res = await wrapperFetch(cfg, "/manifest", { scope: "wrapper" });
    if (!res.ok) return null; // 404 on wrappers that predate the endpoint
    const manifest = parseManifest(await res.json());
    if (manifest?.scriptTimeoutsMs) {
      advertisedScriptTimeouts.set(wrapperKey(cfg), manifest.scriptTimeoutsMs);
    } else {
      forgetAdvertisedScriptTimeouts(cfg);
    }
    return manifest;
  } catch {
    return null;
  }
}

const MANIFEST_TTL_MS = 5 * MS.minute;

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

/** Whether the wrapper advertises `feature` at `minVersion` or newer. False when it does not, or cannot be asked. */
export async function featureAtLeast(
  cfg: ServerConfig,
  feature: WrapperFeatureName,
  minVersion: number,
): Promise<boolean> {
  return (await wrapperFeatureVersion(cfg, feature)) >= minVersion;
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

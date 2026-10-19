/** Wrapper /info: version and remote host metrics. */

import type { ServerConfig } from "../../../types/index.js";
import type { RemoteHostInfo } from "@mcbot/schema/wire/index.js";
import { apiGet } from "./apiClient.js";

export interface RemoteInfo {
  /** Wrapper semver, present from wrapper >= 1.2.0. */
  version?: string;
  /** Process RAM/CPU + disk usage of the wrapper's host, same release. */
  host?: RemoteHostInfo;
}

/**
 * Fetch the wrapper's `/info`. Returns null when the wrapper predates the
 * endpoint (404) or is unreachable; callers treat null as "older wrapper,
 * feature unavailable", never as an error.
 */
export async function getRemoteInfo(
  cfg: ServerConfig,
): Promise<RemoteInfo | null> {
  try {
    const info = await apiGet<RemoteInfo>(cfg, "/info");
    return typeof info === "object" && info !== null ? info : null;
  } catch {
    return null;
  }
}

/** "1.10.2" >= "1.2.0"? Plain numeric segment compare, no prerelease. */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split(".").map((n) => parseInt(n, 10) || 0);
  const b = minimum.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

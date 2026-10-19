/** Setup-suite capability detection. */

import type { ServerConfig, ServerCapabilities } from "../../../types/index.js";
import { allCapabilities } from "../../../types/index.js";
import { MS } from "@mcbot/schema/time.js";
import { cached } from "../../cache.js";
import { apiGet } from "./apiClient.js";

const CAPABILITIES_TTL_MS = 5 * MS.minute;

/**
 * Probe which setup-suite artifacts exist for a server: GET
 * /instances/:id/capabilities on the API wrapper.
 *
 * Older wrappers don't have that route, so any failure falls back to the
 * conservative all-true default; behaviour is then exactly as before
 * capability detection existed (errors surface at invocation time).
 * A successful answer is cached; the fallback is not, so a wrapper that
 * comes back is seen on the next call.
 */
export async function detectCapabilities(
  cfg: ServerConfig,
): Promise<ServerCapabilities> {
  try {
    return await cached(`capabilities:${cfg.id}`, CAPABILITIES_TTL_MS, () =>
      apiGet<ServerCapabilities>(cfg, "/capabilities"),
    );
  } catch {
    return allCapabilities();
  }
}

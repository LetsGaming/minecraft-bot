/**
 * "Can this server's wrapper do X?" checks, cached once per server.
 *
 * Each feature keeps its own `supports*` function in core; this only adds the
 * TTL cache and the uniform 501 for a route that needs the feature.
 */
import { MS } from "@mcbot/schema";
import { cached } from "@mcbot/core/utils/cache.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { HttpError } from "../errors.js";

const PROBE_TTL_MS = MS.minute;
const NOT_IMPLEMENTED = 501;

export type ProbeConfig = ServerInstance["config"];

export interface CapabilityProbe {
  /** False when the wrapper cannot do it or cannot be asked. */
  supported(serverId: string, cfg: ProbeConfig): Promise<boolean>;
  /** Throws a 501 carrying the probe's message when {@link supported} is false. */
  requireSupport(serverId: string, cfg: ProbeConfig): Promise<void>;
}

export function capabilityProbe(
  name: string,
  supports: (cfg: ProbeConfig) => Promise<boolean>,
  unsupportedMessage: string,
): CapabilityProbe {
  const supported = (serverId: string, cfg: ProbeConfig): Promise<boolean> =>
    cached(`${name}:support:${serverId}`, PROBE_TTL_MS, () => supports(cfg));
  return {
    supported,
    async requireSupport(serverId, cfg) {
      if (!(await supported(serverId, cfg))) {
        throw new HttpError(NOT_IMPLEMENTED, unsupportedMessage);
      }
    },
  };
}

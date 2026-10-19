/**
 * "Can this server's wrapper do X?" checks.
 *
 * Each feature keeps its own `supports*` function in core, which already
 * caches what it asks the wrapper; this only adds the uniform 501 for a route
 * that needs the feature.
 */
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { HttpError } from "../errors.js";

const NOT_IMPLEMENTED = 501;

export type ProbeConfig = ServerInstance["config"];

export interface CapabilityProbe {
  /** False when the wrapper cannot do it or cannot be asked. */
  supported(cfg: ProbeConfig): Promise<boolean>;
  /** Throws a 501 carrying the probe's message when {@link supported} is false. */
  requireSupport(cfg: ProbeConfig): Promise<void>;
}

export function capabilityProbe(
  supported: (cfg: ProbeConfig) => Promise<boolean>,
  unsupportedMessage: string,
): CapabilityProbe {
  return {
    supported,
    async requireSupport(cfg) {
      if (!(await supported(cfg))) {
        throw new HttpError(NOT_IMPLEMENTED, unsupportedMessage);
      }
    },
  };
}

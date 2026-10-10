import net from "node:net";
import { log } from "@mcbot/core/utils/logger.js";

/** Value Fastify's trustProxy option accepts from this config. */
export type TrustProxySetting = boolean | string[];

const ALIASES = new Set(["loopback", "linklocal", "uniquelocal"]);

function isTrustedPeerEntry(entry: string): boolean {
  if (ALIASES.has(entry)) return true;
  const [address, prefix, ...rest] = entry.split("/");
  const family = net.isIP(address ?? "");
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Read webui.trustProxy into a Fastify setting. A hop count is not offered:
 * Fastify cannot verify the immediate peer from a count alone and ignores it.
 * Anything malformed falls back to false (trust nothing) so a typo can never
 * widen trust.
 */
export function resolveTrustProxy(raw: unknown): TrustProxySetting {
  if (raw === undefined || raw === null || raw === false) return false;
  if (raw === true) {
    log.warn(
      "web",
      "webui.trustProxy is true: any client can spoof its address via X-Forwarded-For. Prefer listing the proxy's address.",
    );
    return true;
  }
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every(
      (entry) => typeof entry === "string" && isTrustedPeerEntry(entry.trim()),
    )
  ) {
    return (raw as string[]).map((entry) => entry.trim());
  }
  log.warn(
    "web",
    "Ignoring invalid webui.trustProxy (expected true, false, or a list of IPs, CIDR ranges, or loopback/linklocal/uniquelocal); trusting no proxy.",
  );
  return false;
}

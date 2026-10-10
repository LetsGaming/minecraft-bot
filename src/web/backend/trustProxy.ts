import net from "node:net";
import { log } from "@mcbot/core/utils/logger.js";
import { logSafe } from "@mcbot/core/utils/logSafe.js";

/** Fastify's function form of trustProxy: is the proxy at `address`, `hop` hops out, trusted? */
export type TrustProxyFn = (address: string, hop: number) => boolean;

type Matcher = (address: string, hop: number) => boolean;

const NEVER: Matcher = () => false;
const ALWAYS: Matcher = () => true;
const MAX_HOPS = 32;

const ALIASES: Record<string, Array<[string, number, "ipv4" | "ipv6"]>> = {
  loopback: [
    ["127.0.0.0", 8, "ipv4"],
    ["::1", 128, "ipv6"],
  ],
  linklocal: [
    ["169.254.0.0", 16, "ipv4"],
    ["fe80::", 10, "ipv6"],
  ],
  uniquelocal: [
    ["10.0.0.0", 8, "ipv4"],
    ["172.16.0.0", 12, "ipv4"],
    ["192.168.0.0", 16, "ipv4"],
    ["fc00::", 7, "ipv6"],
  ],
};

/** Peer addresses arrive as IPv4-mapped IPv6 on dual-stack sockets. */
export function normalizeAddress(address: string): string {
  return address.toLowerCase().startsWith("::ffff:") && net.isIPv4(address.slice(7))
    ? address.slice(7)
    : address;
}

/** Compile a list of IPs, CIDR ranges and aliases; null when any entry is malformed. */
function compileList(entries: unknown[]): Matcher | null {
  const list = new net.BlockList();
  for (const raw of entries) {
    if (typeof raw !== "string") return null;
    const entry = raw.trim();
    const alias = ALIASES[entry];
    if (alias) {
      for (const [net_, prefix, family] of alias) list.addSubnet(net_, prefix, family);
      continue;
    }
    const [address, prefix, ...rest] = entry.split("/");
    const family = net.isIP(address ?? "");
    if (family === 0 || rest.length > 0) return null;
    const type = family === 4 ? "ipv4" : "ipv6";
    if (prefix === undefined) {
      list.addAddress(address!, type);
    } else {
      if (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)) return null;
      list.addSubnet(address!, Number(prefix), type);
    }
  }
  return (address) => {
    const normalized = normalizeAddress(address);
    const family = net.isIP(normalized);
    return family !== 0 && list.check(normalized, family === 4 ? "ipv4" : "ipv6");
  };
}

/**
 * Read a `webui.trustProxy` value. `true` trusts every hop, a number n trusts
 * the first n hops from the socket (only safe when the dashboard is reachable
 * solely through that many proxies), a list trusts exactly those peers.
 * Anything else, or anything that throws, trusts nothing.
 */
export function parseTrustProxy(raw: unknown): Matcher {
  if (raw === undefined || raw === null || raw === false) return NEVER;
  if (raw === true) return ALWAYS;
  if (typeof raw === "number") {
    if (Number.isInteger(raw) && raw >= 1 && raw <= MAX_HOPS) return (_a, hop) => hop < raw;
  } else if (Array.isArray(raw) && raw.length > 0) {
    try {
      const matcher = compileList(raw);
      if (matcher) return matcher;
    } catch {
      /* fall through to the safe default */
    }
  }
  return NEVER;
}

/**
 * A trustProxy function that follows the live config. The setting is parsed
 * again only when the value changes (config reloads produce a new object), and
 * any failure resolves to "trust nothing".
 */
export function createTrustProxyFn(read: () => unknown): TrustProxyFn {
  let lastKey: unknown = Symbol("unset");
  let matcher: Matcher = NEVER;

  return (address, hop) => {
    try {
      const raw = read();
      const key = typeof raw === "object" && raw !== null ? JSON.stringify(raw) : raw;
      if (key !== lastKey) {
        lastKey = key;
        matcher = parseTrustProxy(raw);
        if (raw === true) {
          log.warn(
            "web",
            "webui.trustProxy is true: any client can spoof its address via X-Forwarded-For. Prefer listing the proxy's address.",
          );
        } else if (matcher === NEVER && raw !== undefined && raw !== null && raw !== false) {
          log.warn(
            "web",
            "Ignoring invalid webui.trustProxy (expected true, false, a hop count 1-32, or a list of IPs, CIDR ranges, or loopback/linklocal/uniquelocal); trusting no proxy.",
          );
        }
      }
      return matcher(address, hop);
    } catch {
      return false;
    }
  };
}

function isPrivateOrLoopback(address: string): boolean {
  const normalized = normalizeAddress(address);
  const family = net.isIP(normalized);
  if (family === 0) return false;
  const list = new net.BlockList();
  for (const [net_, prefix, fam] of [
    ...ALIASES.loopback!,
    ...ALIASES.uniquelocal!,
  ]) {
    list.addSubnet(net_, prefix, fam);
  }
  return list.check(normalized, family === 4 ? "ipv4" : "ipv6");
}

/**
 * True when a request that reached us from a loopback or private peer carries
 * proxy headers while that peer is not trusted: the signature of a reverse
 * proxy in front of a dashboard whose trustProxy was left off.
 */
export function looksLikeUntrustedProxy(
  remoteAddress: string | undefined,
  headers: Record<string, unknown>,
  trusted: boolean,
): boolean {
  if (trusted || !remoteAddress) return false;
  if (headers["x-forwarded-for"] === undefined && headers["x-real-ip"] === undefined) {
    return false;
  }
  return isPrivateOrLoopback(remoteAddress);
}

/**
 * Warn once per process when requests look like they come through an
 * untrusted reverse proxy. The headers are never trusted here; the warning
 * only tells the operator how to set webui.trustProxy.
 */
export function createProxyMisconfigurationWarning(trust: TrustProxyFn): (
  remoteAddress: string | undefined,
  headers: Record<string, unknown>,
) => void {
  let warned = false;
  return (remoteAddress, headers) => {
    if (warned) return;
    const trusted = remoteAddress ? trust(remoteAddress, 0) : false;
    if (!looksLikeUntrustedProxy(remoteAddress, headers, trusted)) return;
    warned = true;
    log.warn(
      "web",
      `Requests from ${logSafe(remoteAddress)} carry X-Forwarded-For/X-Real-IP but webui.trustProxy does not trust that address, so every client is treated as ${logSafe(remoteAddress)} (they share rate limits). Behind a reverse proxy set "webui": { "trustProxy": ["${logSafe(remoteAddress)}"] } (or ["loopback"] / ["uniquelocal"]). The headers are being ignored.`,
    );
  };
}

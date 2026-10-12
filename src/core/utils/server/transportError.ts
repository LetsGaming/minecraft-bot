/**
 * Which way a call to the API wrapper failed in transport, so a reply can
 * say "could not reach smp" instead of passing on "fetch failed".
 * "wrapper-error" is the wrapper answering with a 5xx: reachable, but failing.
 */
import { ApiError, BreakerOpenError, RateLimitedError } from "./access/apiClient.js";

export type TransportFailure =
  | "unreachable"
  | "timeout"
  | "breaker-open"
  | "rate-limited"
  | "wrapper-error";

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

const UNREACHABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
]);

/** The error and its `cause` chain; fetch puts the socket error in `cause`. */
function causeChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = err;
  while (current !== null && current !== undefined && chain.length < 5) {
    chain.push(current);
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return chain;
}

function field(err: unknown, key: "name" | "code" | "message"): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const value = (err as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/** The transport failure behind `err`, or null when it is some other error. */
export function classifyTransportError(err: unknown): TransportFailure | null {
  const chain = causeChain(err);
  if (
    chain.some(
      (e) => e instanceof RateLimitedError || (e instanceof ApiError && e.status === 429),
    )
  ) {
    return "rate-limited";
  }
  if (chain.some((e) => e instanceof BreakerOpenError)) return "breaker-open";
  if (chain.some((e) => e instanceof ApiError && e.status >= 500)) return "wrapper-error";
  if (
    chain.some(
      (e) => field(e, "name") === "TimeoutError" || TIMEOUT_CODES.has(field(e, "code") ?? ""),
    )
  ) {
    return "timeout";
  }
  if (
    chain.some(
      (e) =>
        UNREACHABLE_CODES.has(field(e, "code") ?? "") ||
        (e instanceof TypeError && e.message === "fetch failed"),
    )
  ) {
    return "unreachable";
  }
  return null;
}

/**
 * How the wrapper turned a request down with a 4xx (429 counts as a rate
 * limit above, not here), or null when `err` is no such answer.
 */
export type WrapperRejection = "denied" | "not-found" | "refused";

export function classifyWrapperRejection(err: unknown): WrapperRejection | null {
  const rejection = causeChain(err).find(
    (e): e is ApiError =>
      e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429,
  );
  if (!rejection) return null;
  if (rejection.status === 401 || rejection.status === 403) return "denied";
  if (rejection.status === 404) return "not-found";
  return "refused";
}

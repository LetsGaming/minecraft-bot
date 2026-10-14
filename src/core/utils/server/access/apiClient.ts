/** HTTP client for the wrapper's per-instance routes: URL building, timeouts, circuit breaker wiring and error types. */

import * as breaker from "../circuitBreaker.js";
import type { ServerConfig } from "../../../types/index.js";

// apiGet/apiPost/apiDelete talk to *our own* server wrapper, whose response
// shapes are a versioned contract enforced at connect time by
// verifyWrapperContract() (see MIN_WRAPPER_VERSION). Casting the JSON to the
// caller-specified T is therefore asserting a pinned first-party contract, not
// blindly trusting arbitrary third-party JSON; a wrapper that changed a field
// would fail the version gate, not silently mis-shape a response here.

/** A wrapper-level route: /health, /manifest, /instances. */
export function wrapperUrl(cfg: ServerConfig, route: string): string {
  return `${cfg.apiUrl!.replace(/\/$/, "")}${route}`;
}

/** A route scoped to this instance; everything under /instances/:id. */
export function instanceUrl(cfg: ServerConfig, route: string): string {
  return wrapperUrl(cfg, `/instances/${cfg.id}${route}`);
}

/**
 * Thrown by apiGetRaw when the circuit breaker for this server is open;
 * kept distinguishable from a real fetch failure only in that it never
 * touched the network, which is the whole point.
 */
export class BreakerOpenError extends Error {
  constructor(serverId: string) {
    super(`circuit breaker open for ${serverId}; wrapper reads paused`);
    this.name = "BreakerOpenError";
  }
}

/**
 * A 429 means the wrapper answered and declined the request; it is
 * reachable and healthy, just rate-limiting. Treated as its own outcome
 * throughout so it never gets logged or counted as "unreachable", and never
 * trips the circuit breaker (below): the breaker exists for a wrapper that
 * cannot be reached at all, not for one enforcing its own budget correctly.
 */
export class RateLimitedError extends Error {
  readonly retryAfterMs: number | null;
  constructor(route: string, retryAfterMs: number | null) {
    super(`API ${route} → 429: rate limited${retryAfterMs !== null ? ` (retry after ${retryAfterMs}ms)` : ""}`);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The wrapper answered with a non-OK status. The message keeps the
 * "API <route> → <status>: <body>" form for the log; the body is raw wrapper
 * output and must not reach a non-admin.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly route: string;
  /** The wrapper's own explanation: its `{ error }` field, else the raw body (capped). */
  readonly wrapperMessage: string;
  constructor(route: string, status: number, body: string) {
    super(`API ${route} → ${status}: ${body}`);
    this.name = "ApiError";
    this.route = route;
    this.status = status;
    this.wrapperMessage = wrapperErrorOf(body);
  }
}

function wrapperErrorOf(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error.slice(0, 300);
  } catch {
    /* not JSON */
  }
  return body.slice(0, 300);
}

function parseRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * GET an instance route without asserting the status, for the few callers
 * that treat a specific one as data rather than as a failure.
 */
export async function apiGetRaw(
  cfg: ServerConfig,
  route: string,
  timeoutMs = DEFAULT_GET_TIMEOUT_MS,
): Promise<Response> {
  if (!breaker.shouldAttempt(cfg.id)) {
    throw new BreakerOpenError(cfg.id);
  }
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  let res: Response;
  try {
    // Bounded so a hung API server cannot stall a poll loop indefinitely.
    res = await fetch(instanceUrl(cfg, route), {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    breaker.recordFailure(cfg.id);
    throw err;
  }
  if (res.status === 429) {
    // Reachable and healthy; do not feed this into the breaker.
    throw new RateLimitedError(route, parseRetryAfterMs(res));
  }
  // 5xx is the wrapper itself failing, not this route's data being absent
  // (a 404 is a perfectly healthy answer and must not open the breaker).
  if (res.status >= 500) breaker.recordFailure(cfg.id);
  else breaker.recordSuccess(cfg.id);
  return res;
}

const DEFAULT_GET_TIMEOUT_MS = 8_000;

/** Assert a wrapper response is OK and decode it. */
export async function readApiJson<T>(res: Response, route: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(route, res.status, body);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see note above)
}

export async function apiGet<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs = DEFAULT_GET_TIMEOUT_MS,
): Promise<T> {
  return readApiJson<T>(await apiGetRaw(cfg, route, timeoutMs), route);
}

export async function apiPost<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  // Explicit timeout. Most POSTs finish well inside 30 s; the mod install and
  // update-all endpoints download files and pass a much larger ceiling.
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`POST ${route}`, res.status, text);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

export async function apiPut<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(instanceUrl(cfg, route), {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`PUT ${route}`, res.status, text);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

export async function apiDelete<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs = 8_000,
): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(url, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(`DELETE ${route}`, res.status, text);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

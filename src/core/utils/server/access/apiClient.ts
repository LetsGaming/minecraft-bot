/** HTTP client for the wrapper's per-instance routes: URL building, timeouts, circuit breaker wiring and error types. */

import * as breaker from "../circuitBreaker.js";
import type { ServerConfig } from "../../../types/index.js";
import { MS } from "@mcbot/schema/time.js";
import { WRAPPER_TIMEOUTS_MS } from "./wrapperTimeouts.js";

// The JSON these helpers return is cast to the caller's T. Nothing here checks
// the shape: `verifyWrapperContract` compares the wrapper's manifest against
// what the bot expects once at startup, but that only logs. A wrapper that
// changed a field is neither rejected nor gated by the version check, so a
// cast is an assumption, not a proof. Shapes that feed branching (alerts,
// state transitions) go through `apiGetChecked` with a guard, or are parsed by
// hand like the manifest and `/health`.

/** A wrapper-level route: /health, /manifest, /instances. */
export function wrapperUrl(cfg: ServerConfig, route: string): string {
  return `${cfg.apiUrl.replace(/\/$/, "")}${route}`;
}

/** A route scoped to this instance; everything under /instances/:id. */
export function instanceUrl(cfg: ServerConfig, route: string): string {
  // encodeURIComponent leaves `.` and `..` alone and URL parsing then
  // resolves them, so a mod slug of `..` turned `/mods/../update` into
  // `/update`: a different wrapper route, reached with the mod route's
  // method. No route of ours has such a segment on purpose.
  const pathPart = route.split("?", 1)[0]!;
  if (pathPart.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Refusing a wrapper route with a dot segment: ${route}`);
  }
  return wrapperUrl(cfg, `/instances/${cfg.id}${route}`);
}

/** The headers that authenticate a request to the wrapper. */
export function wrapperAuthHeaders(cfg: ServerConfig): Record<string, string> {
  return cfg.apiKey ? { "x-api-key": cfg.apiKey } : {};
}

/**
 * Thrown by wrapperFetch when the circuit breaker for this server is open;
 * kept distinguishable from a real fetch failure only in that it never
 * touched the network, which is the whole point.
 */
export class BreakerOpenError extends Error {
  constructor(serverId: string) {
    super(`circuit breaker open for ${serverId}; wrapper requests paused`);
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

/** The wrapper's own explanation: the `error` field of a JSON body, else the raw text, capped. */
export function wrapperErrorMessage(body: string, cap = 300): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error.slice(0, cap);
  } catch {
    /* not JSON */
  }
  return body.slice(0, cap);
}

/**
 * The wrapper answered with a non-OK status. The message keeps the
 * "API <route> → <status>: <body>" form for the log; the body is raw wrapper
 * output and must not reach a non-admin.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly route: string;
  /** {@link wrapperErrorMessage} of the body. */
  readonly wrapperMessage: string;
  constructor(route: string, status: number, body: string) {
    super(`API ${route} → ${status}: ${body}`);
    this.name = "ApiError";
    this.route = route;
    this.status = status;
    this.wrapperMessage = wrapperErrorMessage(body);
  }
}

function parseRetryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * MS.second : null;
}

export interface WrapperFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  timeoutMs?: number;
  /** Merged over the API key and content type. */
  headers?: Record<string, string>;
  /** Address `/instances/:id<route>` (default) or a wrapper-level route such as `/manifest`. */
  scope?: "instance" | "wrapper";
  /** Bound only the wait for the response headers; the body then streams for as long as it needs. */
  headersTimeoutOnly?: boolean;
}

/** How a request is named in an {@link ApiError}: the route for a GET, `METHOD route` otherwise. */
export function requestLabel(method: string, route: string): string {
  return method === "GET" ? route : `${method} ${route}`;
}

/**
 * The one place a request leaves for the wrapper: it adds the API key, bounds
 * the wait, and keeps the circuit breaker's books.
 *
 * Returns the response for any status except 429, so a route can treat a 404
 * or 412 as data. A 429 throws {@link RateLimitedError}. Only a request that
 * fails in transport, times out, or draws a 5xx other than 502 counts against
 * the breaker: a 502 is a script or screen failing behind a healthy wrapper,
 * and a 4xx or 429 proves the wrapper is there.
 */
export async function wrapperFetch(
  cfg: ServerConfig,
  route: string,
  options: WrapperFetchOptions = {},
): Promise<Response> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? WRAPPER_TIMEOUTS_MS.read;
  if (!breaker.shouldAttempt(cfg.id)) {
    throw new BreakerOpenError(cfg.id);
  }

  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...wrapperAuthHeaders(cfg),
    ...options.headers,
  };
  const url = options.scope === "wrapper" ? wrapperUrl(cfg, route) : instanceUrl(cfg, route);
  const init: RequestInit = {
    method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  };

  let res: Response;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (options.headersTimeoutOnly) {
      const controller = new AbortController();
      timer = setTimeout(
        () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
        timeoutMs,
      );
      init.signal = controller.signal;
    } else {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    res = await fetch(url, init);
  } catch (err) {
    breaker.recordFailure(cfg.id);
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 500 && res.status !== 502) breaker.recordFailure(cfg.id);
  else breaker.recordSuccess(cfg.id);
  if (res.status === 429) {
    throw new RateLimitedError(requestLabel(method, route), parseRetryAfterMs(res));
  }
  return res;
}

/** The {@link ApiError} for a non-OK response, with its body read. */
export async function apiErrorFrom(res: Response, label: string): Promise<ApiError> {
  return new ApiError(label, res.status, await res.text());
}

/** Assert a wrapper response is OK and decode it. */
export async function readApiJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) throw await apiErrorFrom(res, label);
  return res.json() as Promise<T>;
}

/**
 * GET an instance route without asserting the status, for the few callers
 * that treat a specific one as data rather than as a failure.
 */
export function apiGetRaw(
  cfg: ServerConfig,
  route: string,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.read,
): Promise<Response> {
  return wrapperFetch(cfg, route, { timeoutMs });
}

export async function apiGet<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.read,
): Promise<T> {
  return readApiJson<T>(await apiGetRaw(cfg, route, timeoutMs), route);
}

/** GET a route where a 404 is a normal answer ("never existed", "forgotten", "wrapper too old"). */
export async function apiGetOrNull<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.read,
): Promise<T | null> {
  const res = await apiGetRaw(cfg, route, timeoutMs);
  if (res.status === 404) return null;
  return readApiJson<T>(res, route);
}

/** GET a route and verify the shape with `guard` instead of trusting the cast; for responses that feed branching. */
export async function apiGetChecked<T>(
  cfg: ServerConfig,
  route: string,
  guard: (body: unknown) => body is T,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.read,
): Promise<T> {
  const body = await apiGet<unknown>(cfg, route, timeoutMs);
  if (!guard(body)) throw new Error(`API ${route} answered a shape this bot does not understand`);
  return body;
}

async function apiSend<T>(
  cfg: ServerConfig,
  method: "POST" | "PUT" | "DELETE",
  route: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const res = await wrapperFetch(cfg, route, {
    method,
    timeoutMs,
    ...(body !== undefined ? { body } : {}),
  });
  return readApiJson<T>(res, requestLabel(method, route));
}

/** POST JSON. Most POSTs finish well inside the default; the mod install and update-all endpoints pass a much larger ceiling. */
export function apiPost<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.mutate,
): Promise<T> {
  return apiSend<T>(cfg, "POST", route, body, timeoutMs);
}

export function apiPut<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.mutate,
): Promise<T> {
  return apiSend<T>(cfg, "PUT", route, body, timeoutMs);
}

export function apiDelete<T>(
  cfg: ServerConfig,
  route: string,
  timeoutMs: number = WRAPPER_TIMEOUTS_MS.read,
): Promise<T> {
  return apiSend<T>(cfg, "DELETE", route, undefined, timeoutMs);
}

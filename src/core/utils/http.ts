/**
 * One resilient JSON fetch for every upstream (Mojang, Modrinth, GitHub,
 * Discord, the API wrapper).
 *
 * Each caller used to write the same four steps by hand — fetch,
 * AbortSignal.timeout, res.ok, res.json() — and they disagreed on the
 * details. The Modrinth call had no timeout at all, so an upstream that
 * accepted the connection and then stalled would hang `/mods` forever;
 * the others each picked their own number. Two of the three swallowed the
 * reason for the failure, so "Mojang is down" and "that name is free"
 * arrived at the caller as the same `null`.
 *
 * The failure is returned, not thrown: an upstream being unreachable is
 * an expected outcome here, not an exception, and making callers name it
 * is what stops them collapsing it into null again.
 */
import { errMsg } from "./error.js";

/** Nothing upstream should take longer than this. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchFailure =
  /** No response at all: DNS, refused connection, TLS, timeout. */
  | { kind: "network"; message: string }
  /** A response arrived, with a non-2xx status. */
  | { kind: "status"; status: number; statusText: string }
  /** 2xx, but the body was not JSON or not the expected shape. */
  | { kind: "body"; message: string };

export type FetchResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: FetchFailure };

/** One-line rendering of a failure, for logs. */
export function describeFailure(failure: FetchFailure): string {
  switch (failure.kind) {
    case "network":
      return `unreachable (${failure.message})`;
    case "status":
      return `HTTP ${failure.status} ${failure.statusText}`;
    case "body":
      return `bad response body (${failure.message})`;
  }
}

export interface FetchJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: string;
  body?: string;
}

/**
 * GET (or `method`) a URL and parse the body as JSON.
 *
 * The value is typed `unknown` on purpose: this layer guarantees "the
 * request succeeded and the body was JSON", nothing about its shape.
 * Narrowing stays with the caller's own parse function, which is where
 * the upstream's quirks belong.
 */
export async function fetchJson(
  url: string,
  options: FetchJsonOptions = {},
): Promise<FetchResult<unknown>> {
  const { headers, timeoutMs = DEFAULT_TIMEOUT_MS, method, body } = options;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, failure: { kind: "network", message: errMsg(err) } };
  }

  if (!res.ok) {
    return {
      ok: false,
      failure: {
        kind: "status",
        status: res.status,
        statusText: res.statusText,
      },
    };
  }

  try {
    return { ok: true, value: await res.json() };
  } catch (err) {
    return { ok: false, failure: { kind: "body", message: errMsg(err) } };
  }
}

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  ApiError,
  BreakerOpenError,
  RateLimitedError,
  apiDelete,
  apiGet,
  apiGetChecked,
  apiGetOrNull,
  apiPost,
  apiPut,
  wrapperErrorMessage,
  wrapperFetch,
} from "../../src/core/utils/server/access/apiClient.js";
import { WRAPPER_TIMEOUTS_MS } from "../../src/core/utils/server/access/wrapperTimeouts.js";
import {
  getBreakerState,
  recordFailure,
  resetBreakersForTesting,
} from "../../src/core/utils/server/circuitBreaker.js";
import {
  classifyTransportError,
  isTimeoutError,
} from "../../src/core/utils/server/transportError.js";

const cfg = { id: "smp", apiUrl: "https://wrapper.example.com", apiKey: "secret" } as never;

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function openBreaker(): void {
  for (let i = 0; i < 5; i++) recordFailure("smp");
  expect(getBreakerState("smp")).toBe("open");
}

beforeEach(() => {
  mockFetch.mockReset();
  resetBreakersForTesting();
});

describe("wrapperFetch", () => {
  it("adds the API key, the JSON content type and a timeout signal", async () => {
    mockFetch.mockResolvedValueOnce(res(200));
    await wrapperFetch(cfg, "/x", { method: "POST", body: { a: 1 }, headers: { "if-match": "e" } });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toBe("https://wrapper.example.com/instances/smp/x");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "x-api-key": "secret",
      "Content-Type": "application/json",
      "if-match": "e",
    });
    expect(init.body).toBe('{"a":1}');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("addresses wrapper-level routes without the instance prefix", async () => {
    mockFetch.mockResolvedValueOnce(res(200));
    await wrapperFetch(cfg, "/manifest", { scope: "wrapper" });
    expect(String(mockFetch.mock.calls[0]![0])).toBe("https://wrapper.example.com/manifest");
  });

  it("uses the shared read timeout by default", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    mockFetch.mockResolvedValueOnce(res(200));
    await wrapperFetch(cfg, "/x");
    expect(spy).toHaveBeenCalledWith(WRAPPER_TIMEOUTS_MS.read);
    spy.mockRestore();
  });
});

describe("breaker open", () => {
  it.each([
    ["GET", () => apiGet(cfg, "/x")],
    ["POST", () => apiPost(cfg, "/x", {})],
    ["PUT", () => apiPut(cfg, "/x", {})],
    ["DELETE", () => apiDelete(cfg, "/x")],
  ])("fails %s fast without touching the network", async (_method, call) => {
    openBreaker();
    await expect(call()).rejects.toBeInstanceOf(BreakerOpenError);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("what counts against the breaker", () => {
  it.each([
    ["POST", () => apiPost(cfg, "/x", {})],
    ["PUT", () => apiPut(cfg, "/x", {})],
    ["DELETE", () => apiDelete(cfg, "/x")],
  ])("%s transport failures open it", async (_method, call) => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await call().catch(() => undefined);
    }
    expect(getBreakerState("smp")).toBe("open");
  });

  it("a 503 on a POST counts as a failure", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce(res(503, { error: "down" }));
      await apiPost(cfg, "/x", {}).catch(() => undefined);
    }
    expect(getBreakerState("smp")).toBe("open");
  });

  it("a 502 never trips it, on any method", async () => {
    for (let i = 0; i < 10; i++) {
      mockFetch.mockResolvedValueOnce(res(502, { error: "screen failed" }));
      await apiPost(cfg, "/x", {}).catch(() => undefined);
      mockFetch.mockResolvedValueOnce(res(502, { error: "screen failed" }));
      await apiGet(cfg, "/x").catch(() => undefined);
    }
    expect(getBreakerState("smp")).toBe("closed");
  });

  it("a 4xx proves the wrapper is there", async () => {
    for (let i = 0; i < 10; i++) {
      mockFetch.mockResolvedValueOnce(res(409, { error: "busy" }));
      await apiPut(cfg, "/x", {}).catch(() => undefined);
    }
    expect(getBreakerState("smp")).toBe("closed");
  });

  it("a timeout counts as a failure", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetch.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
      await apiPost(cfg, "/x", {}).catch(() => undefined);
    }
    expect(getBreakerState("smp")).toBe("open");
  });
});

describe("429", () => {
  it("is a RateLimitedError on a POST, with the parsed Retry-After", async () => {
    mockFetch.mockResolvedValueOnce(res(429, {}, { "retry-after": "2" }));
    const err = await apiPost(cfg, "/x", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterMs).toBe(2_000);
    expect(classifyTransportError(err)).toBe("rate-limited");
  });

  it.each([
    ["PUT", () => apiPut(cfg, "/x", {})],
    ["DELETE", () => apiDelete(cfg, "/x")],
  ])("is a RateLimitedError on a %s and never opens the breaker", async (_m, call) => {
    for (let i = 0; i < 10; i++) {
      mockFetch.mockResolvedValueOnce(res(429));
      await expect(call()).rejects.toBeInstanceOf(RateLimitedError);
    }
    expect(getBreakerState("smp")).toBe("closed");
  });

  it("a plain ApiError with status 429 is no longer special-cased", () => {
    expect(classifyTransportError(new ApiError("/x", 429, "slow"))).toBeNull();
  });
});

describe("ApiError creation", () => {
  it("labels non-GET requests with their method and keeps the wrapper's message", async () => {
    mockFetch.mockResolvedValueOnce(res(423, { error: "busy with upgrade" }));
    const err = await apiPost(cfg, "/operations/upgrade", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).route).toBe("POST /operations/upgrade");
    expect((err as ApiError).status).toBe(423);
    expect((err as ApiError).wrapperMessage).toBe("busy with upgrade");
  });

  it("labels a GET with the bare route", async () => {
    mockFetch.mockResolvedValueOnce(res(500, { error: "boom" }));
    const err = await apiGet(cfg, "/x").catch((e: unknown) => e);
    expect((err as ApiError).route).toBe("/x");
  });
});

describe("wrapperErrorMessage", () => {
  it("prefers the error field and caps it", () => {
    expect(wrapperErrorMessage(JSON.stringify({ error: "a".repeat(400) }))).toHaveLength(300);
    expect(wrapperErrorMessage(JSON.stringify({ error: "nope" }), 10)).toBe("nope");
  });

  it("falls back to the raw text, capped", () => {
    expect(wrapperErrorMessage("<html>" + "x".repeat(500))).toHaveLength(300);
    expect(wrapperErrorMessage("plain text", 5)).toBe("plain");
  });
});

describe("apiGetOrNull", () => {
  it("turns a 404 into null", async () => {
    mockFetch.mockResolvedValueOnce(res(404, { error: "gone" }));
    expect(await apiGetOrNull(cfg, "/x")).toBeNull();
  });

  it("decodes any other OK answer and throws on other failures", async () => {
    mockFetch.mockResolvedValueOnce(res(200, { a: 1 }));
    expect(await apiGetOrNull(cfg, "/x")).toEqual({ a: 1 });
    mockFetch.mockResolvedValueOnce(res(500, { error: "boom" }));
    await expect(apiGetOrNull(cfg, "/x")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("apiGetChecked", () => {
  const isCount = (b: unknown): b is { count: number } =>
    typeof b === "object" && b !== null && typeof (b as { count?: unknown }).count === "number";

  it("returns a body the guard accepts and rejects one it does not", async () => {
    mockFetch.mockResolvedValueOnce(res(200, { count: 3 }));
    expect(await apiGetChecked(cfg, "/x", isCount)).toEqual({ count: 3 });
    mockFetch.mockResolvedValueOnce(res(200, { count: "3" }));
    await expect(apiGetChecked(cfg, "/x", isCount)).rejects.toThrow(/shape/);
  });
});

describe("isTimeoutError", () => {
  it("recognises abort-signal timeouts and undici timeout codes in the cause chain", () => {
    expect(isTimeoutError(new DOMException("t", "TimeoutError"))).toBe(true);
    const undici = new TypeError("fetch failed", {
      cause: Object.assign(new Error("headers"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
    });
    expect(isTimeoutError(undici)).toBe(true);
    expect(isTimeoutError(new Error("ECONNREFUSED"))).toBe(false);
    expect(isTimeoutError("nope")).toBe(false);
  });
});

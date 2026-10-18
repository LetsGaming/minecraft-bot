import { describe, it, expect } from "vitest";
import {
  classifyTransportError,
  classifyWrapperRejection,
} from "../../src/core/utils/server/transportError.js";
import {
  ApiError,
  BreakerOpenError,
  RateLimitedError,
} from "../../src/core/utils/server/access/apiClient.js";

function fetchFailed(code: string): TypeError {
  const cause = Object.assign(new Error(`connect ${code}`), { code });
  return new TypeError("fetch failed", { cause });
}

describe("classifyTransportError", () => {
  it("reads a refused or unknown host as unreachable", () => {
    expect(classifyTransportError(new TypeError("fetch failed"))).toBe("unreachable");
    expect(classifyTransportError(fetchFailed("ECONNREFUSED"))).toBe("unreachable");
    expect(classifyTransportError(fetchFailed("ENOTFOUND"))).toBe("unreachable");
  });

  it("reads timeouts, including one inside fetch failed", () => {
    expect(
      classifyTransportError(new DOMException("The operation timed out.", "TimeoutError")),
    ).toBe("timeout");
    expect(classifyTransportError(fetchFailed("UND_ERR_CONNECT_TIMEOUT"))).toBe("timeout");
  });

  it("names an open breaker and a rate limit", () => {
    expect(classifyTransportError(new BreakerOpenError("smp"))).toBe("breaker-open");
    expect(classifyTransportError(new RateLimitedError("/stats", 1000))).toBe("rate-limited");
  });

  it("reads a 5xx answer from the wrapper as a wrapper error, also as a cause", () => {
    expect(classifyTransportError(new ApiError("/stats", 500, "boom"))).toBe("wrapper-error");
    expect(classifyTransportError(new ApiError("POST /mods", 503, ""))).toBe("wrapper-error");
    expect(
      classifyTransportError(new Error("wrapped", { cause: new ApiError("/stats", 502, "") })),
    ).toBe("wrapper-error");
  });

  it("keeps the logged message format and leaves a 4xx answer alone", () => {
    const err = new ApiError("POST /backups/restore", 500, "/home/mc/restore.sh failed");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("API POST /backups/restore → 500: /home/mc/restore.sh failed");
    expect(err.status).toBe(500);
    expect(err.route).toBe("POST /backups/restore");
    expect(classifyTransportError(new ApiError("/stats", 404, "not found"))).toBeNull();
  });

  it("reads a 429 answer from a write as a rate limit", () => {
    expect(classifyTransportError(new RateLimitedError("POST /mods", null))).toBe("rate-limited");
    expect(classifyWrapperRejection(new ApiError("POST /mods", 429, "slow down"))).toBeNull();
  });

  it("leaves other errors alone", () => {
    expect(classifyTransportError(new Error("API /stats → 500: boom"))).toBeNull();
    expect(classifyTransportError(new TypeError("x is not a function"))).toBeNull();
    expect(classifyTransportError({})).toBeNull();
    expect(classifyTransportError(undefined)).toBeNull();
  });
});

describe("classifyWrapperRejection", () => {
  it("names a 4xx answer from the wrapper, also as a cause", () => {
    expect(classifyWrapperRejection(new ApiError("/stats", 401, ""))).toBe("denied");
    expect(classifyWrapperRejection(new ApiError("POST /whitelist", 403, ""))).toBe("denied");
    expect(classifyWrapperRejection(new ApiError("/level-name", 404, ""))).toBe("not-found");
    expect(classifyWrapperRejection(new ApiError("POST /mods", 400, ""))).toBe("refused");
    expect(classifyWrapperRejection(new ApiError("PUT /configs", 413, ""))).toBe("refused");
    expect(
      classifyWrapperRejection(new Error("wrapped", { cause: new ApiError("/stats", 403, "") })),
    ).toBe("denied");
  });

  it("leaves 5xx answers and other errors alone", () => {
    expect(classifyWrapperRejection(new ApiError("/stats", 500, ""))).toBeNull();
    expect(classifyWrapperRejection(new Error("API /stats → 404: nope"))).toBeNull();
    expect(classifyWrapperRejection(undefined)).toBeNull();
  });
});

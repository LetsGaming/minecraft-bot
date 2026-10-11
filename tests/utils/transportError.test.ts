import { describe, it, expect } from "vitest";
import { classifyTransportError } from "../../src/core/utils/server/transportError.js";
import {
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

  it("leaves other errors alone", () => {
    expect(classifyTransportError(new Error("API /stats → 500: boom"))).toBeNull();
    expect(classifyTransportError(new TypeError("x is not a function"))).toBeNull();
    expect(classifyTransportError({})).toBeNull();
    expect(classifyTransportError(undefined)).toBeNull();
  });
});

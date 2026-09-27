import { describe, it, expect, beforeEach } from "vitest";
import {
  shouldAttempt,
  recordSuccess,
  recordFailure,
  getBreakerState,
  resetBreakersForTesting,
} from "../../src/core/utils/server/circuitBreaker.js";

beforeEach(() => {
  resetBreakersForTesting();
});

describe("circuit breaker", () => {
  it("starts closed and allows attempts", () => {
    expect(getBreakerState("s1")).toBe("closed");
    expect(shouldAttempt("s1")).toBe(true);
  });

  it("stays closed on isolated failures below the threshold", () => {
    recordFailure("s1");
    recordFailure("s1");
    expect(getBreakerState("s1")).toBe("closed");
    expect(shouldAttempt("s1")).toBe(true);
  });

  it("a success resets the consecutive-failure count", () => {
    recordFailure("s1");
    recordFailure("s1");
    recordFailure("s1");
    recordFailure("s1");
    recordSuccess("s1");
    recordFailure("s1");
    expect(getBreakerState("s1")).toBe("closed"); // needs 5 in a row, not 5 total
  });

  it("opens after the failure threshold and fails fast", () => {
    for (let i = 0; i < 5; i++) recordFailure("s1");
    expect(getBreakerState("s1")).toBe("open");
    expect(shouldAttempt("s1")).toBe(false);
  });

  it("half-opens after the cooldown, then closes on a successful probe", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) recordFailure("s1", now);
    expect(shouldAttempt("s1", now + 1_000)).toBe(false); // still cooling down
    expect(shouldAttempt("s1", now + 15_001)).toBe(true); // half-open probe
    expect(getBreakerState("s1")).toBe("half-open");
    recordSuccess("s1");
    expect(getBreakerState("s1")).toBe("closed");
  });

  it("a failed half-open probe reopens immediately", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) recordFailure("s1", now);
    shouldAttempt("s1", now + 15_001); // half-open
    recordFailure("s1", now + 15_001);
    expect(getBreakerState("s1")).toBe("open");
  });

  it("tracks each server independently", () => {
    for (let i = 0; i < 5; i++) recordFailure("s1");
    expect(getBreakerState("s1")).toBe("open");
    expect(getBreakerState("s2")).toBe("closed");
    expect(shouldAttempt("s2")).toBe(true);
  });
});

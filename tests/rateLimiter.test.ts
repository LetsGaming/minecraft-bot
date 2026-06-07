import { describe, it, expect } from "vitest";

// We import the module fresh in each test via dynamic import so the
// internal bucket Map starts clean. However, since module state is shared
// within a process, we reset via the exported helpers instead.
import { consumeToken, cooldownSeconds } from "../src/utils/rateLimiter.js";

// Use a unique prefix per test file to avoid cross-test bucket collisions
const uid = (n: number) => `__test_rate__${n}_${Date.now()}`;

describe("rateLimiter", () => {
  it("allows the first CAPACITY requests", () => {
    const id = uid(1);
    // First 5 calls (CAPACITY = 5) should all succeed
    for (let i = 0; i < 5; i++) {
      expect(consumeToken(id)).toBe(true);
    }
  });

  it("rejects the (CAPACITY+1)th request in the same window", () => {
    const id = uid(2);
    for (let i = 0; i < 5; i++) consumeToken(id);
    expect(consumeToken(id)).toBe(false);
  });

  it("returns cooldownSeconds > 0 when rate-limited", () => {
    const id = uid(3);
    for (let i = 0; i < 5; i++) consumeToken(id);
    expect(cooldownSeconds(id)).toBeGreaterThan(0);
  });

  it("returns 0 cooldown for a user who has never sent a command", () => {
    expect(cooldownSeconds(uid(99))).toBe(0);
  });

  it("different users do not share buckets", () => {
    const a = uid(4);
    const b = uid(5);
    for (let i = 0; i < 5; i++) consumeToken(a);
    // User B's bucket is unaffected
    expect(consumeToken(b)).toBe(true);
  });
});

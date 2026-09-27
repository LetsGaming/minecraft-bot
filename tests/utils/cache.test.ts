import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cached, invalidate, invalidatePrefix } from "../../src/core/utils/cache.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  invalidatePrefix(""); // every key shares the empty prefix
});

describe("cached()", () => {
  it("misses once, then hits without calling read again", async () => {
    const read = vi.fn().mockResolvedValue("v1");
    expect(await cached("k1", 1_000, read)).toBe("v1");
    expect(await cached("k1", 1_000, read)).toBe("v1");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reloads once ttlMs has elapsed", async () => {
    const read = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    expect(await cached("k2", 1_000, read)).toBe("v1");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await cached("k2", 1_000, read)).toBe("v2");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent misses on the same key into one read()", async () => {
    let resolveRead!: (v: string) => void;
    const read = vi.fn(() => new Promise<string>((resolve) => { resolveRead = resolve; }));
    const a = cached("k3", 1_000, read);
    const b = cached("k3", 1_000, read);
    expect(read).toHaveBeenCalledTimes(1);
    resolveRead("v1");
    expect(await a).toBe("v1");
    expect(await b).toBe("v1");
  });

  it("serves stale data to a caller arriving while a background refresh runs", async () => {
    let resolveSecond!: (v: string) => void;
    const read = vi
      .fn()
      .mockResolvedValueOnce("v1")
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveSecond = resolve; }));

    await cached("k4", 1_000, read, 5_000);
    await vi.advanceTimersByTimeAsync(1_001); // past fresh, inside stale

    // Triggers a background refresh and returns the stale value immediately.
    const duringRefresh = await cached("k4", 1_000, read, 5_000);
    expect(duringRefresh).toBe("v1");
    expect(read).toHaveBeenCalledTimes(2);

    resolveSecond("v2");
    await vi.advanceTimersByTimeAsync(0);
    expect(await cached("k4", 1_000, read, 5_000)).toBe("v2");
  });

  it("waits for a fresh load once the stale window has also elapsed", async () => {
    const read = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    await cached("k5", 1_000, read, 2_000);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(await cached("k5", 1_000, read, 2_000)).toBe("v2");
  });

  it("invalidate() forces the next read", async () => {
    const read = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    await cached("k6", 60_000, read);
    invalidate("k6");
    expect(await cached("k6", 60_000, read)).toBe("v2");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("invalidatePrefix() drops every key sharing the prefix", async () => {
    const read = vi.fn().mockResolvedValue("v1");
    await cached("srv:1:a", 60_000, read);
    await cached("srv:1:b", 60_000, read);
    await cached("srv:2:a", 60_000, read);
    invalidatePrefix("srv:1:");

    await cached("srv:1:a", 60_000, read);
    await cached("srv:2:a", 60_000, read);
    // srv:1:a re-read after invalidation; srv:2:a still cached.
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("does not cache a rejection, and does not swallow it", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("v1");
    await expect(cached("k7", 1_000, read)).rejects.toThrow("boom");
    expect(await cached("k7", 1_000, read)).toBe("v1");
  });
});

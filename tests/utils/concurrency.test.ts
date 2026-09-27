import { describe, it, expect } from "vitest";
import { mapLimit } from "../../src/core/utils/concurrency.js";

describe("mapLimit()", () => {
  it("preserves order regardless of completion order", async () => {
    const delays = [30, 10, 20, 0, 15];
    const out = await mapLimit(delays, 3, (ms, i) => new Promise<number>((resolve) =>
      setTimeout(() => resolve(i), ms),
    ));
    expect(out).toEqual([0, 1, 2, 3, 4]);
  });

  it("never runs more than `limit` at once", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles an empty array", async () => {
    expect(await mapLimit([], 8, async (x: number) => x)).toEqual([]);
  });
});

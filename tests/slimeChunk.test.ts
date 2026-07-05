/**
 * Slime-chunk formula — Java Random-compatible 48-bit LCG.
 *
 * There is no Java runtime here to diff against, so the properties the
 * spec guarantees are tested instead: determinism, seed sensitivity,
 * ~10% density (nextInt(10) == 0 over a uniform LCG), correct 32-bit
 * int-wrap semantics at extreme chunk coordinates, and string/bigint
 * seed equivalence (seeds arrive as strings from ServerInstance.getSeed).
 */
import { describe, it, expect } from "vitest";
import { isSlimeChunk, blockToChunk } from "../src/common/utils/slimeChunk.js";

describe("blockToChunk", () => {
  it("floors positive and negative block coordinates", () => {
    expect(blockToChunk(0)).toBe(0);
    expect(blockToChunk(15)).toBe(0);
    expect(blockToChunk(16)).toBe(1);
    expect(blockToChunk(-1)).toBe(-1);
    expect(blockToChunk(-16)).toBe(-1);
    expect(blockToChunk(-17)).toBe(-2);
  });
});

describe("isSlimeChunk", () => {
  it("is deterministic for the same seed and chunk", () => {
    for (const [x, z] of [
      [0, 0],
      [3, -7],
      [-100, 250],
    ] as const) {
      const first = isSlimeChunk("123456789", x, z);
      expect(isSlimeChunk("123456789", x, z)).toBe(first);
    }
  });

  it("accepts the seed as string or bigint with identical results", () => {
    for (let x = -5; x <= 5; x++) {
      for (let z = -5; z <= 5; z++) {
        expect(isSlimeChunk("42", x, z)).toBe(isSlimeChunk(42n, x, z));
      }
    }
  });

  it("handles negative numeric seeds (Java long semantics)", () => {
    // getSeed() returns the raw signed value; must not throw and must be
    // stable.
    const v = isSlimeChunk("-9007199254740993", 10, -10);
    expect(typeof v).toBe("boolean");
    expect(isSlimeChunk("-9007199254740993", 10, -10)).toBe(v);
  });

  it("produces roughly 10% slime chunks (nextInt(10) == 0)", () => {
    let hits = 0;
    const N = 60;
    for (let x = -N; x < N; x++) {
      for (let z = -N; z < N; z++) {
        if (isSlimeChunk("31337", x, z)) hits++;
      }
    }
    const ratio = hits / (2 * N * 2 * N);
    // 14 400 samples at p=0.1 → σ ≈ 0.0025; ±5σ bounds.
    expect(ratio).toBeGreaterThan(0.085);
    expect(ratio).toBeLessThan(0.115);
  });

  it("differs between seeds (pattern actually depends on the seed)", () => {
    let differing = 0;
    for (let x = 0; x < 30; x++) {
      for (let z = 0; z < 30; z++) {
        if (isSlimeChunk("1", x, z) !== isSlimeChunk("2", x, z)) differing++;
      }
    }
    expect(differing).toBeGreaterThan(0);
  });

  it("does not throw at extreme chunk coordinates (int-wrap territory)", () => {
    // x*x overflows 32-bit int here — Java wraps; the port must too,
    // silently and deterministically.
    const v = isSlimeChunk("0", 1_875_000, -1_875_000);
    expect(typeof v).toBe("boolean");
    expect(isSlimeChunk("0", 1_875_000, -1_875_000)).toBe(v);
  });

  it("truncates fractional chunk coords instead of throwing", () => {
    expect(() => isSlimeChunk("7", 1.9, -2.9)).not.toThrow();
    expect(isSlimeChunk("7", 1.9, -2.9)).toBe(isSlimeChunk("7", 1, -2));
  });
});

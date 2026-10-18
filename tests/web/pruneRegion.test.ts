import { describe, it, expect } from "vitest";
import {
  REGION_CELLS,
  parseRegionKey,
  regionKey,
  regionOf,
  slotOf,
} from "../../src/web/frontend/src/composables/pruneRegion.js";

describe("region keys", () => {
  it("round-trips, including negative coordinates", () => {
    expect(regionKey(-4, 7)).toBe("-4,7");
    expect(parseRegionKey("-4,7")).toEqual({ rx: -4, rz: 7 });
    expect(parseRegionKey(regionKey(0, -1))).toEqual({ rx: 0, rz: -1 });
  });

  it("rejects anything that is not a pair of integers", () => {
    expect(parseRegionKey("r.1.2")).toBeNull();
    expect(parseRegionKey("1")).toBeNull();
    expect(parseRegionKey("1,2,3")).toBeNull();
    expect(parseRegionKey("a,b")).toBeNull();
  });
});

describe("chunk to region", () => {
  it("floors towards negative infinity", () => {
    expect(regionOf(0)).toBe(0);
    expect(regionOf(31)).toBe(0);
    expect(regionOf(32)).toBe(1);
    expect(regionOf(-1)).toBe(-1);
    expect(regionOf(-32)).toBe(-1);
    expect(regionOf(-33)).toBe(-2);
    expect(regionOf(31.9)).toBe(0);
  });

  it("indexes a chunk's cell row by row inside its region", () => {
    expect(slotOf(0, 0)).toBe(0);
    expect(slotOf(5, 0)).toBe(5);
    expect(slotOf(0, 1)).toBe(32);
    expect(slotOf(-1, -1)).toBe(REGION_CELLS - 1);
    expect(slotOf(33, 64)).toBe(1);
  });
});

import { describe, it, expect } from "vitest";

import {
  buildRegionPixels,
  buildSelectionPixels,
  heatMinutes,
  isManualCell,
  CELL_ROLE,
  type Palette,
} from "../../src/web/frontend/src/composables/pruneMapRender.js";
import { CELL } from "../../src/web/frontend/src/composables/usePrune.js";

const PALETTE: Palette = {
  cell: {
    [CELL.DELETE]: [255, 0, 0, 255],
    [CELL.ACTIVE]: [0, 255, 0, 255],
    [CELL.MANUAL_SOFT]: [255, 0, 0, 255],
  },
  heat: [200, 100, 0, 255],
  unknown: [128, 128, 128, 255],
};

const px = (data: Uint8ClampedArray, slot: number): number[] => [...data.subarray(slot * 4, slot * 4 + 4)];

describe("buildRegionPixels", () => {
  const cell = new Uint8Array(1024);
  const heat = new Uint8Array(1024);
  cell[0] = CELL.DELETE;
  cell[1] = CELL.ACTIVE;
  cell[33] = CELL.PROTECTED; // no colour in this palette
  cell[1023] = CELL.MANUAL_SOFT;
  heat[1] = 255;
  heat[0] = 0;

  it("paints each class and leaves empty cells transparent", () => {
    const out = buildRegionPixels(cell, heat, "class", PALETTE);
    expect(px(out, 0)).toEqual([255, 0, 0, 255]);
    expect(px(out, 1)).toEqual([0, 255, 0, 255]);
    expect(px(out, 2)).toEqual([0, 0, 0, 0]);
    expect(px(out, 1023)).toEqual([255, 0, 0, 255]);
  });

  it("falls back for a class without a colour", () => {
    expect(px(buildRegionPixels(cell, heat, "class", PALETTE), 33)).toEqual([128, 128, 128, 255]);
  });

  it("indexes by row then column", () => {
    const c = new Uint8Array(1024);
    c[3 * 32 + 5] = CELL.DELETE; // x 5, z 3
    const out = buildRegionPixels(c, new Uint8Array(1024), "class", PALETTE);
    expect(px(out, 3 * 32 + 5)[3]).toBe(255);
    expect(px(out, 5 * 32 + 3)[3]).toBe(0);
  });

  it("scales opacity with the heat in the time-used view and ignores the class colour", () => {
    const out = buildRegionPixels(cell, heat, "heat", PALETTE);
    expect(px(out, 0)).toEqual([200, 100, 0, Math.round(0.15 * 255)]);
    expect(px(out, 1)).toEqual([200, 100, 0, 255]);
    expect(px(out, 2)).toEqual([0, 0, 0, 0]);
  });
});

describe("buildSelectionPixels", () => {
  it("marks exactly the chosen chunks", () => {
    const bits = new Uint32Array(32);
    bits[0] = 0b101; // x 0 and 2 in row 0
    bits[31] = 0x80000000; // x 31 in row 31
    const out = buildSelectionPixels(bits, [1, 2, 3, 4]);
    expect(px(out, 0)).toEqual([1, 2, 3, 4]);
    expect(px(out, 1)).toEqual([0, 0, 0, 0]);
    expect(px(out, 2)).toEqual([1, 2, 3, 4]);
    expect(px(out, 31 * 32 + 31)).toEqual([1, 2, 3, 4]);
    expect([...out].filter((v, i) => i % 4 === 3 && v === 4)).toHaveLength(3);
  });
});

describe("heat and classes", () => {
  it("reads the heat level back as minutes", () => {
    expect(heatMinutes(0)).toBe(0);
    expect(heatMinutes(255)).toBe(9999);
    expect(heatMinutes(64)).toBeGreaterThan(0);
    // The suite's own encoding: round(log10(1 + minutes) / 4 * 255), within one level of the input.
    for (const minutes of [1, 5, 60, 1000]) {
      const level = Math.round((Math.log10(1 + minutes) / 4) * 255);
      expect(Math.abs(Math.log10(1 + heatMinutes(level)) - Math.log10(1 + minutes))).toBeLessThan(0.03);
    }
  });

  it("paints manual deletions like deletions and tells them apart", () => {
    expect(CELL_ROLE[CELL.MANUAL_SOFT]).toBe(CELL_ROLE[CELL.DELETE]);
    expect(CELL_ROLE[CELL.MANUAL_HARD]).toBe(CELL_ROLE[CELL.DELETE]);
    expect(isManualCell(CELL.MANUAL_SOFT)).toBe(true);
    expect(isManualCell(CELL.MANUAL_HARD)).toBe(true);
    expect(isManualCell(CELL.DELETE)).toBe(false);
  });
});

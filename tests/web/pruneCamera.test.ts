import { describe, it, expect } from "vitest";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  chunkAt,
  fitBounds,
  panBy,
  regionBoundsToChunks,
  screenToWorld,
  visibleRegions,
  worldToScreen,
  zoomAt,
  type Camera,
} from "../../src/web/frontend/src/composables/pruneCamera.js";

const VIEW = { width: 800, height: 600 };
const cam = (cx: number, cz: number, zoom: number): Camera => ({ cx, cz, zoom });

describe("coordinate maths", () => {
  it.each([0.05, 0.5, 1, 4, 32])("worldToScreen and screenToWorld are inverses at zoom %s", (zoom) => {
    const c = cam(-123.5, 77.25, zoom);
    for (const [x, z] of [[0, 0], [-1000, 900], [31.5, -0.5]]) {
      const s = worldToScreen(c, VIEW, x!, z!);
      const w = screenToWorld(c, VIEW, s.sx, s.sz);
      expect(w.x).toBeCloseTo(x!, 6);
      expect(w.z).toBeCloseTo(z!, 6);
    }
  });

  it("the view centre is the camera centre", () => {
    expect(worldToScreen(cam(10, -20, 8), VIEW, 10, -20)).toEqual({ sx: 400, sz: 300 });
  });

  it("chunkAt floors, so negative coordinates land in the right chunk", () => {
    const c = cam(0, 0, 10);
    // 5 px left of the centre is 0.5 chunks left: chunk -1, not 0.
    expect(chunkAt(c, VIEW, 395, 300)).toEqual({ cx: -1, cz: 0 });
    expect(chunkAt(c, VIEW, 405, 305)).toEqual({ cx: 0, cz: 0 });
    expect(chunkAt(c, VIEW, 400 - 10, 300 - 10)).toEqual({ cx: -1, cz: -1 });
    expect(chunkAt(c, VIEW, 400 - 10.01, 300)).toEqual({ cx: -2, cz: 0 });
  });
});

describe("zoom and pan", () => {
  it("zooming keeps the point under the cursor fixed", () => {
    const c = cam(50, -40, 3);
    const before = screenToWorld(c, VIEW, 123, 456);
    for (const factor of [2, 0.5, 1.37]) {
      const next = zoomAt(c, VIEW, factor, 123, 456);
      const after = screenToWorld(next, VIEW, 123, 456);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.z).toBeCloseTo(before.z, 6);
    }
  });

  it("clamps the zoom at both ends", () => {
    expect(zoomAt(cam(0, 0, 30), VIEW, 10, 0, 0).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(cam(0, 0, 0.1), VIEW, 0.001, 0, 0).zoom).toBe(MIN_ZOOM);
  });

  it("dragging right shows what is to the left", () => {
    const next = panBy(cam(0, 0, 4), 40, -20);
    expect(next.cx).toBe(-10);
    expect(next.cz).toBe(5);
  });
});

describe("fit and visibility", () => {
  it("fits the whole bounds with room to spare", () => {
    const bounds = { minX: -1000, minZ: -500, maxX: 999, maxZ: 499 };
    const c = fitBounds(bounds, VIEW);
    expect(c.cx).toBe(0);
    expect(c.cz).toBe(0);
    const topLeft = worldToScreen(c, VIEW, bounds.minX, bounds.minZ);
    const bottomRight = worldToScreen(c, VIEW, bounds.maxX + 1, bounds.maxZ + 1);
    expect(topLeft.sx).toBeGreaterThanOrEqual(0);
    expect(topLeft.sz).toBeGreaterThanOrEqual(0);
    expect(bottomRight.sx).toBeLessThanOrEqual(VIEW.width);
    expect(bottomRight.sz).toBeLessThanOrEqual(VIEW.height);
  });

  it("never fits tighter than the zoom limits allow", () => {
    expect(fitBounds({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 }, VIEW).zoom).toBe(MAX_ZOOM);
    expect(fitBounds({ minX: 0, minZ: 0, maxX: 10_000_000, maxZ: 10_000_000 }, VIEW).zoom).toBe(MIN_ZOOM);
  });

  it("lists the regions the view touches, including negative ones", () => {
    // 800 x 600 px at 10 px per chunk is 80 x 60 chunks around the origin.
    expect(visibleRegions(cam(0, 0, 10), VIEW)).toEqual({ rx0: -2, rx1: 1, rz0: -1, rz1: 0 });
    expect(visibleRegions(cam(-32, -32, 25), VIEW)).toEqual({ rx0: -2, rx1: -1, rz0: -2, rz1: -1 });
  });

  it("converts region bounds to chunk bounds", () => {
    expect(regionBoundsToChunks({ minX: -2, minZ: 0, maxX: 1, maxZ: 3 })).toEqual({ minX: -64, minZ: 0, maxX: 63, maxZ: 127 });
    expect(regionBoundsToChunks(null)).toBeNull();
  });
});

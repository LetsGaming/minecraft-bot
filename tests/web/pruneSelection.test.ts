import { describe, it, expect } from "vitest";

import {
  SelectionModel,
  MAX_SELECTION_OPS,
  type SelectionOp,
} from "../../src/web/frontend/src/composables/pruneSelection.js";

const DIM = "overworld";
const op = (x1: number, z1: number, x2: number, z2: number, mode: "add" | "remove" = "add", dimension = DIM): SelectionOp => ({
  dimension,
  mode,
  x1,
  z1,
  x2,
  z2,
});

/** Regions -3..2 on both axes exist. */
const GRID = Array.from({ length: 36 }, (_, i) => ({ rx: (i % 6) - 3, rz: Math.floor(i / 6) - 3 }));
const exists = (_d: string, rx: number, rz: number): boolean => rx >= -3 && rx <= 2 && rz >= -3 && rz <= 2;
const model = (max?: number) => new SelectionModel(() => GRID, max);

/** What a list of operations chooses, worked out one chunk at a time. */
function brute(ops: SelectionOp[], dimension = DIM): Set<string> {
  const set = new Set<string>();
  for (const o of ops) {
    if (o.dimension !== dimension) continue;
    for (let z = Math.min(o.z1, o.z2); z <= Math.max(o.z1, o.z2); z++) {
      for (let x = Math.min(o.x1, o.x2); x <= Math.max(o.x1, o.x2); x++) {
        if (!exists(dimension, Math.floor(x / 32), Math.floor(z / 32))) continue;
        if (o.mode === "add") set.add(`${x},${z}`);
        else set.delete(`${x},${z}`);
      }
    }
  }
  return set;
}

function chosen(m: SelectionModel, dimension = DIM): Set<string> {
  const set = new Set<string>();
  m.forEachRegion(dimension, (rx, rz, bits) => {
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if ((bits[z]! >>> x) & 1) set.add(`${rx * 32 + x},${rz * 32 + z}`);
  });
  return set;
}

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

function randomOps(rand: () => number, n: number): SelectionOp[] {
  const out: SelectionOp[] = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rand() * 180) - 90;
    const z = Math.floor(rand() * 180) - 90;
    out.push(op(x, z, x + Math.floor(rand() * 40), z + Math.floor(rand() * 40), rand() < 0.3 ? "remove" : "add"));
  }
  return out;
}

describe("applying operations", () => {
  it("matches a chunk-by-chunk reading of a seeded random sequence, across region borders and negative coordinates", () => {
    for (const seed of [1, 7, 42]) {
      const ops = randomOps(seeded(seed), 60);
      const m = model();
      for (const o of ops) expect(m.apply([o])).toBe(true);
      expect(chosen(m)).toEqual(brute(ops));
      expect(m.count(DIM)).toBe(brute(ops).size);
    }
  });

  it("later operations win: remove takes chunks out again and add puts them back", () => {
    const m = model();
    m.apply([op(0, 0, 9, 0)]);
    m.apply([op(3, 0, 5, 0, "remove")]);
    expect([3, 4, 5].map((x) => m.has(DIM, x, 0))).toEqual([false, false, false]);
    m.apply([op(4, 0, 4, 0)]);
    expect(m.has(DIM, 4, 0)).toBe(true);
    expect(m.count(DIM)).toBe(8);
  });

  it("handles a rectangle given corner to corner in either order", () => {
    const m = model();
    m.apply([op(5, 5, -5, -5)]);
    expect(m.count(DIM)).toBe(121);
    expect(m.has(DIM, -5, -5)).toBe(true);
    expect(m.has(DIM, 5, 5)).toBe(true);
    expect(m.has(DIM, 6, 5)).toBe(false);
  });

  it("selects a whole region and a 1M chunk rectangle quickly, ignoring regions that do not exist", () => {
    const m = model();
    const t0 = performance.now();
    m.apply([op(-100000, -100000, 100000, 100000)]);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(m.count(DIM)).toBe(36 * 1024);
  });

  it("keeps dimensions apart", () => {
    const m = model();
    m.apply([op(0, 0, 3, 3, "add", "the_nether")]);
    expect(m.count(DIM)).toBe(0);
    expect(m.count("the_nether")).toBe(16);
  });

  it("removing the last chunk of a region drops its bitset", () => {
    const m = model();
    m.apply([op(0, 0, 0, 0)]);
    m.apply([op(0, 0, 0, 0, "remove")]);
    expect(m.regionBits(DIM, 0, 0)).toBeUndefined();
  });
});

describe("undo and redo", () => {
  it("undo then redo restores the same selection, over a seeded random history", () => {
    const rand = seeded(11);
    const m = model();
    const snapshots: Array<Set<string>> = [new Set()];
    for (let i = 0; i < 25; i++) {
      m.apply(randomOps(rand, 1 + Math.floor(rand() * 3)));
      snapshots.push(chosen(m));
    }
    for (let i = 24; i >= 0; i--) {
      expect(m.undo()).toBe(true);
      expect(chosen(m)).toEqual(snapshots[i]);
    }
    expect(m.undo()).toBe(false);
    for (let i = 1; i <= 25; i++) {
      expect(m.redo()).toBe(true);
      expect(chosen(m)).toEqual(snapshots[i]);
    }
    expect(m.redo()).toBe(false);
  });

  it("one gesture is one step, however many rectangles it made", () => {
    const m = model();
    m.apply([op(0, 0, 1, 1), op(5, 5, 6, 6), op(9, 9, 10, 10)]);
    expect(m.count(DIM)).toBe(12);
    m.undo();
    expect(m.count(DIM)).toBe(0);
    expect(m.canUndo).toBe(false);
    expect(m.canRedo).toBe(true);
  });

  it("a new operation after an undo drops what could have been redone", () => {
    const m = model();
    m.apply([op(0, 0, 0, 0)]);
    m.undo();
    m.apply([op(1, 1, 1, 1)]);
    expect(m.canRedo).toBe(false);
  });

  it("undoing ten steps of a 1M chunk selection is fast", () => {
    const m = model();
    for (let i = 0; i < 10; i++) m.apply([op(-100000 + i, -100000, 100000, 100000, i % 2 ? "remove" : "add")]);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) m.undo();
    expect(performance.now() - t0).toBeLessThan(500);
    expect(m.count(DIM)).toBe(0);
  });
});

describe("the operation list and its cap", () => {
  it("exposes the operations in order, normalised, for the setup suite", () => {
    const m = model();
    m.apply([op(4, 4, 1, 1)]);
    m.apply([op(2, 2, 2, 2, "remove")]);
    expect(m.ops).toEqual([op(1, 1, 4, 4), op(2, 2, 2, 2, "remove")]);
  });

  it("compacting keeps the selection and shrinks the list", () => {
    const m = model();
    // A 10 x 5 block built one chunk at a time, with a hole punched and filled again.
    for (let x = 0; x < 10; x++) for (let z = 0; z < 5; z++) m.apply([op(x, z, x, z)]);
    m.apply([op(4, 2, 4, 2, "remove")]);
    m.apply([op(4, 2, 4, 2)]);
    const before = chosen(m);
    expect(m.ops.length).toBe(52);
    m.compact();
    expect(chosen(m)).toEqual(before);
    expect(m.ops).toEqual([op(0, 0, 9, 4)]);
    expect(brute(m.ops)).toEqual(before);
  });

  it("compacting a random selection never changes it", () => {
    for (const seed of [2, 9]) {
      const m = model();
      for (const o of randomOps(seeded(seed), 50)) m.apply([o]);
      const before = chosen(m);
      m.compact();
      expect(chosen(m)).toEqual(before);
      expect(brute(m.ops)).toEqual(before);
    }
  });

  it("merges neighbouring full regions into one rectangle", () => {
    const m = model();
    m.apply([op(0, 0, 31, 31), op(32, 0, 63, 31), op(0, 32, 31, 63), op(32, 32, 63, 63)]);
    m.compact();
    expect(m.ops).toEqual([op(0, 0, 63, 63)]);
  });

  it("compacts on its own when the cap is reached, and refuses when it still does not fit", () => {
    const m = model(6);
    for (let i = 0; i < 6; i++) expect(m.apply([op(i, 0, i, 0)])).toBe(true);
    // Six neighbouring chunks merge into one rectangle, which makes room for the seventh.
    expect(m.apply([op(100, 0, 100, 0)])).toBe(true);
    expect(m.ops.length).toBeLessThan(6);
    const spread = model(3);
    expect(spread.apply([op(0, 0, 0, 0), op(2, 2, 2, 2), op(4, 4, 4, 4)])).toBe(true);
    expect(spread.apply([op(6, 6, 6, 6)])).toBe(false);
    expect(spread.count(DIM)).toBe(3);
  });

  it("the cap matches what the setup suite accepts", () => {
    expect(MAX_SELECTION_OPS).toBe(2500);
  });
});

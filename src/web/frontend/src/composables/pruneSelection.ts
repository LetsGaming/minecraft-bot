/**
 * A manual chunk selection, kept the way the setup suite reads it: an ordered
 * list of add/remove rectangles in chunk coordinates. The list is the source of
 * truth and what is sent with a scan; the per-region bitsets are only a fast
 * copy of its effect, for drawing and hit tests.
 *
 * Undo and redo work on commands (one gesture is one command, however many
 * rectangles it made). Nothing here knows about the map: a region the caller
 * says does not exist is never materialised, so a rectangle over open ocean
 * costs nothing.
 */

import { REGION_CHUNKS, REGION_MASK } from "@mcbot/schema";
import { parseRegionKey, regionKey, regionOf, slotOf, type Rect, type RegionRef } from "./pruneRegion";

export type { RegionRef, Rect } from "./pruneRegion";

export interface SelectionOp extends Rect {
  dimension: string;
  mode: "add" | "remove";
}

/** What the setup suite accepts in one request. */
export const MAX_SELECTION_OPS = 2500;

type Bits = Uint32Array; // one 32 bit mask per row of a region (bit x = chunk x)

/** Mask with bits xa..xb (inclusive, 0..31) set. */
function rowMask(xa: number, xb: number): number {
  const width = xb - xa + 1;
  return width >= REGION_CHUNKS ? 0xffffffff : ((0xffffffff >>> (REGION_CHUNKS - width)) << xa) >>> 0;
}

function popcount(v: number): number {
  let n = v - ((v >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export class SelectionModel {
  private commands: SelectionOp[][] = [];
  private undone: SelectionOp[][] = [];
  private bitsets = new Map<string, Map<string, Bits>>(); // dimension -> region -> bits

  /**
   * @param regionsOf the regions a dimension's map has; selection outside them is ignored
   * @param maxOps cap on the flattened list
   */
  constructor(
    private regionsOf: (dimension: string) => readonly RegionRef[],
    private maxOps = MAX_SELECTION_OPS,
  ) {}

  /** Every operation in order, as sent to the setup suite. */
  get ops(): SelectionOp[] {
    return this.commands.flat();
  }

  get canUndo(): boolean {
    return this.commands.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /**
   * Apply one gesture. When the list would outgrow the cap it is compacted
   * first, which drops the undo history; if even the compacted list does not
   * fit, nothing at all changes and this returns false.
   */
  apply(ops: SelectionOp[]): boolean {
    if (ops.length === 0) return true;
    const normal = ops.map(normalise);
    if (this.opCount() + normal.length > this.maxOps) {
      const compacted = this.compactedOps();
      if (compacted.length + normal.length > this.maxOps) return false;
      this.commands = compacted.length > 0 ? [compacted] : [];
      this.rebuild();
    }
    this.commands.push(normal);
    this.undone = [];
    this.paintAll(normal);
    return true;
  }

  undo(): boolean {
    const last = this.commands.pop();
    if (!last) return false;
    this.undone.push(last);
    this.rebuild();
    return true;
  }

  redo(): boolean {
    const next = this.undone.pop();
    if (!next) return false;
    this.commands.push(next);
    this.paintAll(next);
    return true;
  }

  /** Paint every operation again, for when the maps they depend on have been (re)loaded. */
  refresh(): void {
    this.rebuild();
  }

  clear(): void {
    this.commands = [];
    this.undone = [];
    this.bitsets.clear();
  }

  /** Is the chunk chosen? */
  has(dimension: string, cx: number, cz: number): boolean {
    const bits = this.bitsets.get(dimension)?.get(regionKey(regionOf(cx), regionOf(cz)));
    if (!bits) return false;
    return ((bits[cz & REGION_MASK]! >>> (cx & REGION_MASK)) & 1) === 1;
  }

  /** Visit every region that has at least one chosen chunk. */
  forEachRegion(dimension: string, visit: (rx: number, rz: number, bits: Bits) => void): void {
    for (const [key, bits] of this.bitsets.get(dimension) ?? []) {
      const at = parseRegionKey(key);
      if (at) visit(at.rx, at.rz, bits);
    }
  }

  /**
   * Chosen chunks in a dimension, on regions the map has. `include` narrows the
   * count to chunks it accepts (the page uses it to skip cells with no data).
   */
  count(dimension: string, include?: (rx: number, rz: number, slot: number) => boolean): number {
    let n = 0;
    this.forEachRegion(dimension, (rx, rz, bits) => {
      if (!include) {
        for (const row of bits) n += popcount(row);
        return;
      }
      for (let z = 0; z < REGION_CHUNKS; z++) {
        const row = bits[z]!;
        if (row === 0) continue;
        for (let x = 0; x < REGION_CHUNKS; x++) {
          if (((row >>> x) & 1) === 1 && include(rx, rz, slotOf(x, z))) n++;
        }
      }
    });
    return n;
  }

  /**
   * Rewrite the list as the fewest rectangles that make the same selection, so a
   * long editing session does not run into the cap. History before it is dropped.
   */
  compact(): void {
    const merged = this.compactedOps();
    this.commands = merged.length > 0 ? [merged] : [];
    this.undone = [];
    this.rebuild();
  }

  /**
   * The compacted list, without applying it. A dimension whose map is loaded is
   * rewritten from its bitsets; a dimension with no regions loaded cannot be
   * merged (nothing was painted for it), so its operations are kept as they are.
   */
  private compactedOps(): SelectionOp[] {
    const kept: SelectionOp[] = [];
    const loaded = new Map<string, boolean>();
    const unloaded = new Set<string>();
    for (const op of this.commands.flat()) {
      let isLoaded = loaded.get(op.dimension);
      if (isLoaded === undefined) {
        isLoaded = this.regionsOf(op.dimension).length > 0;
        loaded.set(op.dimension, isLoaded);
      }
      if (isLoaded) continue;
      unloaded.add(op.dimension);
      kept.push(op);
    }
    const merged: SelectionOp[] = [];
    for (const [dimension, regions] of this.bitsets) {
      if (unloaded.has(dimension)) continue;
      const rects: Rect[] = [];
      for (const [key, bits] of regions) {
        const at = parseRegionKey(key);
        if (at) rects.push(...rectsOfRegion(at.rx, at.rz, bits));
      }
      for (const r of mergeRects(rects)) merged.push({ dimension, mode: "add", ...r });
    }
    return [...kept, ...merged];
  }

  private opCount(): number {
    let n = 0;
    for (const c of this.commands) n += c.length;
    return n;
  }

  private rebuild(): void {
    this.bitsets.clear();
    this.paintAll(this.commands.flat());
  }

  /** Paint operations in order, reading each dimension's regions from the map once. */
  private paintAll(ops: readonly SelectionOp[]): void {
    const index = new Map<string, Map<string, RegionRef>>();
    for (const op of ops) {
      let regions = index.get(op.dimension);
      if (!regions) {
        regions = new Map(this.regionsOf(op.dimension).map((r) => [regionKey(r.rx, r.rz), r]));
        index.set(op.dimension, regions);
      }
      this.paint(op, regions);
    }
  }

  private paint(op: SelectionOp, mapRegions: ReadonlyMap<string, RegionRef>): void {
    const set = op.mode === "add";
    let regions = this.bitsets.get(op.dimension);
    // Only regions the map has can matter, so the cost follows the map, not the rectangle:
    // walk whichever is smaller, the rectangle's regions or the map's.
    const rx0 = regionOf(op.x1);
    const rx1 = regionOf(op.x2);
    const rz0 = regionOf(op.z1);
    const rz1 = regionOf(op.z2);
    const covered = (rx1 - rx0 + 1) * (rz1 - rz0 + 1);
    const touched: Iterable<RegionRef> =
      covered <= mapRegions.size ? regionsInRect(rx0, rx1, rz0, rz1, mapRegions) : intersecting(mapRegions, rx0, rx1, rz0, rz1);
    for (const { rx, rz } of touched) {
      const key = regionKey(rx, rz);
      let bits = regions?.get(key);
      if (!bits) {
        if (!set) continue;
        bits = new Uint32Array(REGION_CHUNKS);
        if (!regions) {
          regions = new Map();
          this.bitsets.set(op.dimension, regions);
        }
        regions.set(key, bits);
      }
      const baseX = rx * REGION_CHUNKS;
      const baseZ = rz * REGION_CHUNKS;
      const mask = rowMask(Math.max(op.x1, baseX) - baseX, Math.min(op.x2, baseX + REGION_MASK) - baseX);
      const za = Math.max(op.z1, baseZ) - baseZ;
      const zb = Math.min(op.z2, baseZ + REGION_MASK) - baseZ;
      for (let z = za; z <= zb; z++) bits[z] = set ? (bits[z]! | mask) >>> 0 : (bits[z]! & ~mask) >>> 0;
      if (!set && bits.every((row) => row === 0)) regions?.delete(key);
    }
  }
}

function* regionsInRect(
  rx0: number,
  rx1: number,
  rz0: number,
  rz1: number,
  mapRegions: ReadonlyMap<string, RegionRef>,
): Generator<RegionRef> {
  for (let rz = rz0; rz <= rz1; rz++) {
    for (let rx = rx0; rx <= rx1; rx++) {
      const hit = mapRegions.get(regionKey(rx, rz));
      if (hit) yield hit;
    }
  }
}

function* intersecting(
  mapRegions: ReadonlyMap<string, RegionRef>,
  rx0: number,
  rx1: number,
  rz0: number,
  rz1: number,
): Generator<RegionRef> {
  for (const r of mapRegions.values()) {
    if (r.rx >= rx0 && r.rx <= rx1 && r.rz >= rz0 && r.rz <= rz1) yield r;
  }
}

function normalise(op: SelectionOp): SelectionOp {
  return {
    dimension: op.dimension,
    mode: op.mode,
    x1: Math.min(op.x1, op.x2),
    z1: Math.min(op.z1, op.z2),
    x2: Math.max(op.x1, op.x2),
    z2: Math.max(op.z1, op.z2),
  };
}

/** Rectangles covering one region's bits: equal adjacent rows stack, each row's runs split. */
function rectsOfRegion(rx: number, rz: number, bits: Bits): Rect[] {
  const out: Rect[] = [];
  const baseX = rx * REGION_CHUNKS;
  const baseZ = rz * REGION_CHUNKS;
  let z = 0;
  while (z < REGION_CHUNKS) {
    const row = bits[z]!;
    if (row === 0) {
      z++;
      continue;
    }
    let end = z;
    while (end + 1 < REGION_CHUNKS && bits[end + 1] === row) end++;
    let x = 0;
    while (x < REGION_CHUNKS) {
      if (((row >>> x) & 1) === 0) {
        x++;
        continue;
      }
      let xe = x;
      while (xe + 1 < REGION_CHUNKS && ((row >>> (xe + 1)) & 1) === 1) xe++;
      out.push({ x1: baseX + x, z1: baseZ + z, x2: baseX + xe, z2: baseZ + end });
      x = xe + 1;
    }
    z = end + 1;
  }
  return out;
}

/** Join rectangles that touch along a whole edge, until nothing more joins. */
function mergeRects(rects: Rect[]): Rect[] {
  let current = rects;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const horizontal of [true, false]) {
      const sorted = [...current].sort((a, b) =>
        horizontal ? a.z1 - b.z1 || a.z2 - b.z2 || a.x1 - b.x1 : a.x1 - b.x1 || a.x2 - b.x2 || a.z1 - b.z1,
      );
      const next: Rect[] = [];
      for (const r of sorted) {
        const prev = next[next.length - 1];
        if (prev && horizontal && prev.z1 === r.z1 && prev.z2 === r.z2 && prev.x2 + 1 === r.x1) {
          prev.x2 = r.x2;
          changed = true;
        } else if (prev && !horizontal && prev.x1 === r.x1 && prev.x2 === r.x2 && prev.z2 + 1 === r.z1) {
          prev.z2 = r.z2;
          changed = true;
        } else {
          next.push({ ...r });
        }
      }
      current = next;
    }
    if (!changed) break;
  }
  return current;
}

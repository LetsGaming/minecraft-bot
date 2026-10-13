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

export interface RegionRef {
  rx: number;
  rz: number;
}

export interface SelectionOp {
  dimension: string;
  mode: "add" | "remove";
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/** What the setup suite accepts in one request. */
export const MAX_SELECTION_OPS = 2500;

type Bits = Uint32Array; // 32 rows, one 32 bit mask per row (bit x = chunk x)

const regionKey = (rx: number, rz: number): string => `${rx},${rz}`;

/** Mask with bits xa..xb (inclusive, 0..31) set. */
function rowMask(xa: number, xb: number): number {
  const width = xb - xa + 1;
  return width >= 32 ? 0xffffffff : ((0xffffffff >>> (32 - width)) << xa) >>> 0;
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

  /** Apply one gesture. Returns false, changing nothing, when the list would outgrow the cap. */
  apply(ops: SelectionOp[]): boolean {
    if (ops.length === 0) return true;
    if (this.opCount() + ops.length > this.maxOps) {
      this.compact();
      if (this.opCount() + ops.length > this.maxOps) return false;
    }
    const normal = ops.map(normalise);
    this.commands.push(normal);
    this.undone = [];
    for (const op of normal) this.paint(op);
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
    for (const op of next) this.paint(op);
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
    const bits = this.bitsets.get(dimension)?.get(regionKey(Math.floor(cx / 32), Math.floor(cz / 32)));
    if (!bits) return false;
    return ((bits[cz & 31]! >>> (cx & 31)) & 1) === 1;
  }

  /** The bitset of one region, or undefined when nothing in it is chosen. */
  regionBits(dimension: string, rx: number, rz: number): Bits | undefined {
    return this.bitsets.get(dimension)?.get(regionKey(rx, rz));
  }

  /** Visit every region that has at least one chosen chunk. */
  forEachRegion(dimension: string, visit: (rx: number, rz: number, bits: Bits) => void): void {
    for (const [key, bits] of this.bitsets.get(dimension) ?? []) {
      const [rx, rz] = key.split(",").map(Number) as [number, number];
      visit(rx, rz, bits);
    }
  }

  /** Chosen chunks in a dimension (on regions that exist; chunks without data in them count too). */
  count(dimension: string): number {
    let n = 0;
    for (const bits of this.bitsets.get(dimension)?.values() ?? []) for (const row of bits) n += popcount(row);
    return n;
  }

  /**
   * Rewrite the list as the fewest rectangles that make the same selection, so a
   * long editing session does not run into the cap. History before it is dropped.
   */
  compact(): void {
    const merged: SelectionOp[] = [];
    for (const [dimension, regions] of this.bitsets) {
      const rects: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
      for (const [key, bits] of regions) {
        const [rx, rz] = key.split(",").map(Number) as [number, number];
        rects.push(...rectsOfRegion(rx, rz, bits));
      }
      for (const r of mergeRects(rects)) merged.push({ dimension, mode: "add", ...r });
    }
    this.commands = merged.length > 0 ? [merged] : [];
    this.undone = [];
    this.rebuild();
  }

  private opCount(): number {
    let n = 0;
    for (const c of this.commands) n += c.length;
    return n;
  }

  private rebuild(): void {
    this.bitsets.clear();
    for (const command of this.commands) for (const op of command) this.paint(op);
  }

  private paint(op: SelectionOp): void {
    const set = op.mode === "add";
    let regions = this.bitsets.get(op.dimension);
    // Only regions the map has can matter, so the cost follows the map, not the rectangle.
    for (const { rx, rz } of this.regionsOf(op.dimension)) {
      if (rx * 32 + 31 < op.x1 || rx * 32 > op.x2 || rz * 32 + 31 < op.z1 || rz * 32 > op.z2) continue;
      const key = regionKey(rx, rz);
      let bits = regions?.get(key);
      if (!bits) {
        if (!set) continue;
        bits = new Uint32Array(32);
        if (!regions) {
          regions = new Map();
          this.bitsets.set(op.dimension, regions);
        }
        regions.set(key, bits);
      }
      const mask = rowMask(Math.max(op.x1, rx * 32) - rx * 32, Math.min(op.x2, rx * 32 + 31) - rx * 32);
      const za = Math.max(op.z1, rz * 32) - rz * 32;
      const zb = Math.min(op.z2, rz * 32 + 31) - rz * 32;
      for (let z = za; z <= zb; z++) bits[z] = set ? (bits[z]! | mask) >>> 0 : (bits[z]! & ~mask) >>> 0;
      if (!set && bits.every((row) => row === 0)) regions?.delete(key);
    }
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
function rectsOfRegion(rx: number, rz: number, bits: Bits): Array<{ x1: number; z1: number; x2: number; z2: number }> {
  const out: Array<{ x1: number; z1: number; x2: number; z2: number }> = [];
  let z = 0;
  while (z < 32) {
    const row = bits[z]!;
    if (row === 0) {
      z++;
      continue;
    }
    let end = z;
    while (end + 1 < 32 && bits[end + 1] === row) end++;
    let x = 0;
    while (x < 32) {
      if (((row >>> x) & 1) === 0) {
        x++;
        continue;
      }
      let xe = x;
      while (xe + 1 < 32 && ((row >>> (xe + 1)) & 1) === 1) xe++;
      out.push({ x1: rx * 32 + x, z1: rz * 32 + z, x2: rx * 32 + xe, z2: rz * 32 + end });
      x = xe + 1;
    }
    z = end + 1;
  }
  return out;
}

/** Join rectangles that touch along a whole edge, until nothing more joins. */
function mergeRects(rects: Array<{ x1: number; z1: number; x2: number; z2: number }>) {
  let current = rects;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const horizontal of [true, false]) {
      const sorted = [...current].sort((a, b) =>
        horizontal ? a.z1 - b.z1 || a.z2 - b.z2 || a.x1 - b.x1 : a.x1 - b.x1 || a.x2 - b.x2 || a.z1 - b.z1,
      );
      const next: typeof current = [];
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

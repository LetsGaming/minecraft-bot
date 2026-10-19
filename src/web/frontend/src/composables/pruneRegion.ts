import { REGION_CHUNKS, REGION_MASK, REGION_SHIFT } from "@mcbot/schema";

/** Chunk cells in one region (a 32 by 32 grid, row by row). */
export const REGION_CELLS = REGION_CHUNKS * REGION_CHUNKS;

export interface RegionRef {
  rx: number;
  rz: number;
}

/** A rectangle of chunks, both corners inclusive. */
export interface Rect {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export const regionKey = (rx: number, rz: number): string => `${rx},${rz}`;

/** The inverse of `regionKey`, or null for anything else. */
export function parseRegionKey(key: string): RegionRef | null {
  const m = /^(-?\d+),(-?\d+)$/.exec(key);
  return m ? { rx: Number(m[1]), rz: Number(m[2]) } : null;
}

/** The region coordinate a chunk coordinate falls in; right for negatives. */
export const regionOf = (chunk: number): number => Math.floor(chunk) >> REGION_SHIFT;

/** Index of a chunk's cell inside its region's arrays. */
export const slotOf = (cx: number, cz: number): number => (cx & REGION_MASK) + (cz & REGION_MASK) * REGION_CHUNKS;

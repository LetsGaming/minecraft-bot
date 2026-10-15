/**
 * Turning a region's cells into pixels for the prune map. Pure functions over
 * typed arrays, so the colour logic is testable without a canvas: the component
 * only parses the theme's colours, calls these, and draws the result.
 */

import { CELL } from "./usePrune";

export type Rgba = readonly [number, number, number, number];

export interface Palette {
  /** Per cell class. */
  cell: Readonly<Record<number, Rgba>>;
  /** The colour of the time-used view; its alpha scales with the heat. */
  heat: Rgba;
  /** What is drawn for a chunk the cell class has no colour for. */
  unknown: Rgba;
}

/** The status role each cell class is painted with (see schema/status.ts). */
export const CELL_ROLE: Readonly<Record<number, string>> = {
  [CELL.DELETE]: "offline",
  [CELL.ACTIVE]: "online",
  [CELL.PROTECTED]: "info",
  [CELL.BUFFER]: "pending",
  [CELL.UNREADABLE]: "degraded",
  [CELL.UNCERTAIN]: "unknown",
  // Chosen by hand: the same colour as a deletion; the map marks them apart.
  [CELL.MANUAL_SOFT]: "offline",
  [CELL.MANUAL_HARD]: "offline",
};

/**
 * Default opacity of the classes over a terrain picture: low enough that the terrain stays
 * recognisable. The Prune page's slider moves in steps of 5 %, so this sits on one.
 */
export const OVER_TERRAIN_OPACITY = 0.3;

/** A chunk chosen by hand, over a soft rule or over a hard protection. */
export const isManualCell = (cell: number): boolean => cell === CELL.MANUAL_SOFT || cell === CELL.MANUAL_HARD;

/** Inverse of the setup suite's heat level: roughly how many minutes a chunk was inhabited. */
export function heatMinutes(heat: number): number {
  if (heat <= 0) return 0;
  return Math.max(0, Math.round(10 ** ((heat / 255) * 4) - 1));
}

/**
 * RGBA pixels of one region, one pixel per chunk, row by row (index = z * 32 + x).
 * Empty cells stay transparent so the surface shows through.
 */
export function buildRegionPixels(
  cell: Uint8Array,
  heat: Uint8Array,
  view: "class" | "heat",
  palette: Palette,
  /** Scales every pixel's opacity, so the classes can sit over a terrain picture. */
  opacity = 1,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(32 * 32 * 4);
  for (let slot = 0; slot < 1024; slot++) {
    const c = cell[slot]!;
    if (c === CELL.EMPTY) continue;
    let rgba: Rgba;
    if (view === "heat") {
      rgba = [palette.heat[0], palette.heat[1], palette.heat[2], Math.round((0.15 + (heat[slot]! / 255) * 0.85) * 255)];
    } else {
      rgba = palette.cell[c] ?? palette.unknown;
    }
    const i = slot * 4;
    out[i] = rgba[0];
    out[i + 1] = rgba[1];
    out[i + 2] = rgba[2];
    out[i + 3] = Math.round(rgba[3] * opacity);
  }
  return out;
}

/** Pixels of a selection bitset (32 row masks), in one colour; unselected chunks are transparent. */
export function buildSelectionPixels(bits: Uint32Array, colour: Rgba): Uint8ClampedArray {
  const out = new Uint8ClampedArray(32 * 32 * 4);
  for (let z = 0; z < 32; z++) {
    const row = bits[z]!;
    if (row === 0) continue;
    for (let x = 0; x < 32; x++) {
      if (((row >>> x) & 1) === 0) continue;
      const i = (z * 32 + x) * 4;
      out[i] = colour[0];
      out[i + 1] = colour[1];
      out[i + 2] = colour[2];
      out[i + 3] = colour[3];
    }
  }
  return out;
}

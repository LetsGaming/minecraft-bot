/**
 * The prune map's camera: which part of the world is on screen. Pure maths, no
 * DOM, so it can be tested at every zoom level. Chunk coordinates are floats
 * here (a camera may sit mid-chunk); `chunkAt` floors them, which is what keeps
 * negative coordinates right (-0.5 is chunk -1, not 0).
 */

import { REGION_CHUNKS, REGION_MASK } from "@mcbot/schema";
import { regionOf } from "./pruneRegion";

export interface Camera {
  /** Centre of the view, in chunk coordinates. */
  cx: number;
  cz: number;
  /** Screen pixels per chunk. */
  zoom: number;
}

export interface ViewSize {
  width: number;
  height: number;
}

export interface ChunkBounds {
  minX: number;
  minZ: number;
  /** Inclusive. */
  maxX: number;
  maxZ: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 32;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function worldToScreen(cam: Camera, view: ViewSize, x: number, z: number): { sx: number; sz: number } {
  return { sx: (x - cam.cx) * cam.zoom + view.width / 2, sz: (z - cam.cz) * cam.zoom + view.height / 2 };
}

export function screenToWorld(cam: Camera, view: ViewSize, sx: number, sz: number): { x: number; z: number } {
  return { x: (sx - view.width / 2) / cam.zoom + cam.cx, z: (sz - view.height / 2) / cam.zoom + cam.cz };
}

/** The chunk under a screen position. */
export function chunkAt(cam: Camera, view: ViewSize, sx: number, sz: number): { cx: number; cz: number } {
  const w = screenToWorld(cam, view, sx, sz);
  return { cx: Math.floor(w.x), cz: Math.floor(w.z) };
}

/** Zoom by `factor`, keeping the world point under the screen position where it is. */
export function zoomAt(cam: Camera, view: ViewSize, factor: number, sx: number, sz: number): Camera {
  const zoom = clampZoom(cam.zoom * factor);
  const w = screenToWorld(cam, view, sx, sz);
  return { zoom, cx: w.x - (sx - view.width / 2) / zoom, cz: w.z - (sz - view.height / 2) / zoom };
}

/** Move the view by a screen distance: dragging right shows what is to the left. */
export function panBy(cam: Camera, dxPx: number, dzPx: number): Camera {
  return { ...cam, cx: cam.cx - dxPx / cam.zoom, cz: cam.cz - dzPx / cam.zoom };
}

/** A camera that shows `bounds` whole, with a little room around it. */
export function fitBounds(bounds: ChunkBounds, view: ViewSize, margin = 0.95): Camera {
  const w = bounds.maxX - bounds.minX + 1;
  const h = bounds.maxZ - bounds.minZ + 1;
  const zoom = clampZoom(Math.min(view.width / w, view.height / h) * margin);
  return { zoom, cx: bounds.minX + w / 2, cz: bounds.minZ + h / 2 };
}

/** The region coordinates (inclusive) that intersect the view. */
export function visibleRegions(cam: Camera, view: ViewSize): { rx0: number; rx1: number; rz0: number; rz1: number } {
  const a = screenToWorld(cam, view, 0, 0);
  const b = screenToWorld(cam, view, view.width, view.height);
  return { rx0: regionOf(a.x), rx1: regionOf(b.x), rz0: regionOf(a.z), rz1: regionOf(b.z) };
}

/** Chunk bounds of a set of regions (inclusive), or null when there are none. */
export function regionBoundsToChunks(b: { minX: number; minZ: number; maxX: number; maxZ: number } | null): ChunkBounds | null {
  return b
    ? {
        minX: b.minX * REGION_CHUNKS,
        minZ: b.minZ * REGION_CHUNKS,
        maxX: b.maxX * REGION_CHUNKS + REGION_MASK,
        maxZ: b.maxZ * REGION_CHUNKS + REGION_MASK,
      }
    : null;
}

/**
 * What the prune map draws on top of the region pictures: the hand selection,
 * the region and chunk grid, protected zones, the rectangle being dragged and
 * the rings round the open and hovered chunks. Functions of a canvas context
 * and a plain description of the scene, so the component keeps only its state.
 */

import { REGION_CHUNKS } from "@mcbot/schema";
import type { PruneZone } from "@mcbot/schema/wire/index.js";
import { chunkAt, visibleRegions, worldToScreen, type Camera, type ViewSize } from "./pruneCamera";
import { isManualCell, type Palette, type Rgba } from "./pruneMapRender";
import { REGION_CELLS, type RegionRef } from "./pruneRegion";
import type { SelectionModel } from "./pruneSelection";
import { CELL } from "./usePrune";

export const css = (rgba: Rgba, alpha = rgba[3] / 255): string => `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${alpha})`;

/** Colours the map reads from the dashboard theme, resolved once per theme change. */
export interface MapTheme {
  palette: Palette;
  surface: string;
  grid: string;
  /** Chunk lines, drawn only when zoomed far in. */
  chunkGrid: string;
  zone: string;
  selection: Rgba;
  text: string;
  remove: string;
  removeFill: string;
}

export interface RectDrag {
  from: { cx: number; cz: number };
  to: { cx: number; cz: number };
  mode: "add" | "remove" | "zone";
}

export interface OverlayScene {
  camera: Camera;
  size: ViewSize;
  theme: MapTheme;
  dimension: string;
  selection: SelectionModel;
  /** The cached picture of a region's chosen chunks. */
  selectionBitmap(rx: number, rz: number, bits: Uint32Array): CanvasImageSource;
  regions: Iterable<RegionRef & { cell: Uint8Array }>;
  zones: readonly PruneZone[];
  showGrid: boolean;
  dragRect: RectDrag | null;
  inspected: { cx: number; cz: number } | null | undefined;
  hover: { cx: number; cz: number } | null;
}

/** Pixel-aligned rectangle of a region, so neighbours never leave a seam. */
export function regionRect(camera: Camera, size: ViewSize, rx: number, rz: number): { x: number; y: number; w: number; h: number } {
  const a = worldToScreen(camera, size, rx * REGION_CHUNKS, rz * REGION_CHUNKS);
  const b = worldToScreen(camera, size, rx * REGION_CHUNKS + REGION_CHUNKS, rz * REGION_CHUNKS + REGION_CHUNKS);
  const x = Math.floor(a.sx);
  const y = Math.floor(a.sz);
  return { x, y, w: Math.max(1, Math.floor(b.sx) - x), h: Math.max(1, Math.floor(b.sz) - y) };
}

type View = ReturnType<typeof visibleRegions>;

export function drawOverlay(ctx: CanvasRenderingContext2D, scene: OverlayScene): void {
  const { camera: cam, size, theme: th } = scene;
  const v = visibleRegions(cam, size);
  const inView = (rx: number, rz: number): boolean => rx >= v.rx0 && rx <= v.rx1 && rz >= v.rz0 && rz <= v.rz1;

  // What is chosen by hand, before it has been previewed.
  ctx.imageSmoothingEnabled = cam.zoom < 1;
  scene.selection.forEachRegion(scene.dimension, (rx, rz, bits) => {
    if (!inView(rx, rz)) return;
    const { x, y, w, h } = regionRect(cam, size, rx, rz);
    ctx.drawImage(scene.selectionBitmap(rx, rz, bits), x, y, w, h);
  });

  // Shapes, so the states are not told apart by colour alone.
  if (cam.zoom >= 8) drawChunkMarks(ctx, scene, v, inView);

  if (scene.showGrid) drawGrid(ctx, scene, v);

  // Protected zones: dashed, so they differ from the protected fill in more than hue.
  ctx.lineWidth = 2;
  ctx.strokeStyle = th.zone;
  ctx.setLineDash([6, 4]);
  for (const z of scene.zones) {
    if (z.dimension !== scene.dimension) continue;
    const a = worldToScreen(cam, size, z.x1, z.z1);
    const b = worldToScreen(cam, size, z.x2 + 1, z.z2 + 1);
    ctx.strokeRect(a.sx, a.sz, b.sx - a.sx, b.sz - a.sz);
  }
  ctx.setLineDash([]);

  if (scene.dragRect) drawDragRect(ctx, scene, scene.dragRect);

  const open = scene.inspected;
  if (open) {
    const a = worldToScreen(cam, size, open.cx, open.cz);
    const px = Math.max(cam.zoom, 4);
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.surface;
    ctx.strokeRect(a.sx - 2, a.sz - 2, px + 4, px + 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = th.text;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(a.sx - 2, a.sz - 2, px + 4, px + 4);
    ctx.setLineDash([]);
  }

  const h = scene.hover;
  if (h) {
    const a = worldToScreen(cam, size, h.cx, h.cz);
    const px = Math.max(cam.zoom, 3);
    ctx.lineWidth = 3;
    ctx.strokeStyle = th.surface;
    ctx.strokeRect(a.sx - 1, a.sz - 1, px + 2, px + 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = th.text;
    ctx.strokeRect(a.sx - 0.5, a.sz - 0.5, px + 1, px + 1);
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, scene: OverlayScene, v: View): void {
  const { camera: cam, size, theme: th } = scene;
  ctx.strokeStyle = th.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  if (cam.zoom >= 0.4) {
    for (let rz = v.rz0; rz <= v.rz1 + 1; rz++) {
      const y = Math.floor(worldToScreen(cam, size, 0, rz * REGION_CHUNKS).sz) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();
    }
    for (let rx = v.rx0; rx <= v.rx1 + 1; rx++) {
      const x = Math.floor(worldToScreen(cam, size, rx * REGION_CHUNKS, 0).sx) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
    }
  }
  if (cam.zoom >= 12) {
    ctx.strokeStyle = th.chunkGrid;
    const a = chunkAt(cam, size, 0, 0);
    const b = chunkAt(cam, size, size.width, size.height);
    ctx.beginPath();
    for (let cx = a.cx; cx <= b.cx + 1; cx++) {
      const x = Math.floor(worldToScreen(cam, size, cx, 0).sx) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
    }
    for (let cz = a.cz; cz <= b.cz + 1; cz++) {
      const y = Math.floor(worldToScreen(cam, size, 0, cz).sz) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
    }
    ctx.stroke();
  }
}

function drawDragRect(ctx: CanvasRenderingContext2D, scene: OverlayScene, drag: RectDrag): void {
  const { camera: cam, size, theme: th } = scene;
  const x1 = Math.min(drag.from.cx, drag.to.cx);
  const z1 = Math.min(drag.from.cz, drag.to.cz);
  const x2 = Math.max(drag.from.cx, drag.to.cx);
  const z2 = Math.max(drag.from.cz, drag.to.cz);
  const a = worldToScreen(cam, size, x1, z1);
  const b = worldToScreen(cam, size, x2 + 1, z2 + 1);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = drag.mode === "remove" ? th.remove : drag.mode === "zone" ? th.zone : css(th.selection);
  ctx.fillStyle = drag.mode === "remove" ? th.removeFill : css(th.selection, 0.15);
  ctx.fillRect(a.sx, a.sz, b.sx - a.sx, b.sz - a.sz);
  ctx.strokeRect(a.sx, a.sz, b.sx - a.sx, b.sz - a.sz);
  ctx.setLineDash([]);
}

/** Per-chunk marks at high zoom: a diagonal for chosen chunks, an inset frame for manual deletions. */
function drawChunkMarks(
  ctx: CanvasRenderingContext2D,
  scene: OverlayScene,
  v: View,
  inView: (rx: number, rz: number) => boolean,
): void {
  const { camera: cam, size, theme: th } = scene;
  const z = cam.zoom;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  ctx.strokeStyle = css(th.selection, 0.9);
  ctx.beginPath();
  scene.selection.forEachRegion(scene.dimension, (rx, rz, bits) => {
    if (!inView(rx, rz)) return;
    for (let cz = 0; cz < REGION_CHUNKS; cz++) {
      const row = bits[cz]!;
      if (row === 0) continue;
      for (let cx = 0; cx < REGION_CHUNKS; cx++) {
        if (((row >>> cx) & 1) === 0) continue;
        const a = worldToScreen(cam, size, rx * REGION_CHUNKS + cx, rz * REGION_CHUNKS + cz);
        if (a.sx + z < 0 || a.sz + z < 0 || a.sx > size.width || a.sz > size.height) continue;
        ctx.moveTo(a.sx + 2, a.sz + z - 2);
        ctx.lineTo(a.sx + z - 2, a.sz + 2);
      }
    }
  });
  ctx.stroke();

  ctx.strokeStyle = css(th.palette.cell[CELL.MANUAL_SOFT] ?? [255, 255, 255, 255], 1);
  ctx.setLineDash([3, 2]);
  ctx.beginPath();
  for (const r of scene.regions) {
    if (r.rx < v.rx0 || r.rx > v.rx1 || r.rz < v.rz0 || r.rz > v.rz1) continue;
    for (let slot = 0; slot < REGION_CELLS; slot++) {
      if (!isManualCell(r.cell[slot]!)) continue;
      const a = worldToScreen(cam, size, r.rx * REGION_CHUNKS + (slot % REGION_CHUNKS), r.rz * REGION_CHUNKS + Math.floor(slot / REGION_CHUNKS));
      if (a.sx + z < 0 || a.sz + z < 0 || a.sx > size.width || a.sz > size.height) continue;
      ctx.rect(a.sx + 1.5, a.sz + 1.5, z - 3, z - 3);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

<template>
  <div class="prune-map">
    <div
      ref="host"
      class="pm-host"
      :style="{ height }"
      tabindex="0"
      role="group"
      :aria-label="label"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter PageUp PageDown + - 0 Escape"
      @keydown="onKey"
      @keyup="onKeyUp"
    >
      <canvas ref="baseCanvas" class="pm-layer" aria-hidden="true" />
      <canvas
        ref="overCanvas"
        class="pm-layer pm-over"
        :class="cursorClass"
        aria-hidden="true"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onCancel"
        @pointerleave="onLeave"
        @contextmenu.prevent
      />
    </div>
    <p class="pm-hover" role="status" :aria-live="cursor ? 'polite' : 'off'">{{ hoverText }}</p>
  </div>
</template>

<script setup lang="ts">
import { formatNumber } from "../utils/numberFormat";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { REGION_CHUNKS } from "@mcbot/schema";
import type { PruneZone } from "@mcbot/schema/wire/index.js";
import { createTileStore } from "../composables/pruneTiles";
import { CELL, type DecodedMap, type DecodedRegion } from "../composables/usePrune";
import {
  fitBounds,
  regionBoundsToChunks,
  visibleRegions,
  zoomAt,
  type Camera,
  type ViewSize,
} from "../composables/pruneCamera";
import {
  CELL_ROLE,
  OVER_TERRAIN_OPACITY,
  buildRegionPixels,
  buildSelectionPixels,
  heatMinutes,
  type Rgba,
} from "../composables/pruneMapRender";
import { css, drawOverlay, regionRect, type MapTheme } from "../composables/pruneMapOverlay";
import { regionKey, regionOf, slotOf, type Rect } from "../composables/pruneRegion";
import type { SelectionModel } from "../composables/pruneSelection";
import { usePruneMapInput, type MapTool } from "../composables/usePruneMapInput";
import { t } from "../i18n";

const props = withDefaults(
  defineProps<{
    map: DecodedMap;
    zones: PruneZone[];
    view: "class" | "heat" | "terrain";
    /** Fetches the terrain picture of a region (null when it has none); needed for the terrain view. */
    tileLoader?: (rx: number, rz: number) => Promise<ImageBitmap | null>;
    /** How opaque the class colours are over a terrain picture, 0 to 1; 0 shows the bare terrain. */
    overlayOpacity?: number;
    showGrid: boolean;
    tool: MapTool;
    selection: SelectionModel;
    /** Bumped whenever the selection changes, so the map redraws it. */
    selectionVersion: number;
    label: string;
    height?: string;
    /** The chunk open in the inspector, ringed on the map. */
    inspected?: { cx: number; cz: number } | null;
  }>(),
  { height: "min(70vh, 34rem)", overlayOpacity: OVER_TERRAIN_OPACITY },
);

const emit = defineEmits<{
  zone: [rect: Rect];
  select: [rect: Rect & { mode: "add" | "remove" }];
  camera: [info: { zoom: number; cx: number; cz: number }];
  undo: [];
  redo: [];
  inspect: [at: { cx: number; cz: number }];
}>();

const host = ref<HTMLDivElement | null>(null);
const baseCanvas = ref<HTMLCanvasElement | null>(null);
const overCanvas = ref<HTMLCanvasElement | null>(null);

const camera = shallowRef<Camera>({ cx: 0, cz: 0, zoom: 1 });
const size: ViewSize = { width: 0, height: 0 };
let dpr = 1;
let fitted = false;
let lastDimension = "";

// ── Theme colours ─────────────────────────────────────────────────────────

let colourProbe: CanvasRenderingContext2D | null = null;

/** Any CSS colour to RGBA, by letting a 1x1 canvas parse it. */
function toRgba(colour: string, fallback: Rgba): Rgba {
  if (typeof document === "undefined") return fallback;
  colourProbe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colourProbe || !colour) return fallback;
  colourProbe.clearRect(0, 0, 1, 1);
  colourProbe.fillStyle = "rgb(0, 0, 0)";
  colourProbe.fillStyle = colour;
  colourProbe.fillRect(0, 0, 1, 1);
  const d = colourProbe.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

function token(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let themeCache: MapTheme | null = null;

function theme(): MapTheme {
  if (themeCache) return themeCache;
  const role = (r: string): Rgba => toRgba(token(`--st-${r}`), [128, 128, 128, 255]);
  const cell: Record<number, Rgba> = {};
  for (const [c, r] of Object.entries(CELL_ROLE)) cell[Number(c)] = role(r);
  themeCache = {
    palette: { cell, heat: role("degraded"), unknown: [128, 128, 128, 255] },
    surface: token("--surface") || "canvas",
    grid: css(toRgba(token("--border-strong"), [128, 128, 128, 255]), 0.6),
    chunkGrid: css(toRgba(token("--border"), [128, 128, 128, 255]), 0.4),
    zone: css(role("info")),
    selection: toRgba(token("--text"), [255, 255, 255, 255]),
    text: token("--text") || "canvastext",
    remove: css(role("offline")),
    removeFill: css(toRgba(token("--st-offline"), [200, 60, 60, 255]), 0.12),
  };
  return themeCache;
}

// ── Region bitmaps ────────────────────────────────────────────────────────

const regionIndex = computed(() => {
  const m = new Map<string, { rx: number; rz: number } & DecodedRegion>();
  for (const r of props.map.regions) m.set(regionKey(r.rx, r.rz), r);
  return m;
});

const bitmaps = new Map<string, HTMLCanvasElement>();
const selectionBitmaps = new Map<string, HTMLCanvasElement>();

function canvasOf(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = REGION_CHUNKS;
  c.height = REGION_CHUNKS;
  c.getContext("2d")!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, REGION_CHUNKS, REGION_CHUNKS), 0, 0);
  return c;
}

/** Under this the terrain pictures would be a few pixels each; the classes alone are clearer. */
const TERRAIN_MIN_ZOOM = 2.5;

const terrainActive = (): boolean => props.view === "terrain" && !!props.tileLoader && camera.value.zoom >= TERRAIN_MIN_ZOOM;

function bitmapFor(r: { rx: number; rz: number } & DecodedRegion, overTerrain = false): HTMLCanvasElement {
  const opacity = overTerrain ? props.overlayOpacity : 1;
  const key = `${regionKey(r.rx, r.rz)}@${opacity}`;
  let bmp = bitmaps.get(key);
  if (!bmp) {
    const view = props.view === "heat" ? "heat" : "class";
    bmp = canvasOf(buildRegionPixels(r.cell, r.heat, view, theme().palette, opacity));
    bitmaps.set(key, bmp);
  }
  return bmp;
}

function selectionBitmap(rx: number, rz: number, bits: Uint32Array): HTMLCanvasElement {
  const key = regionKey(rx, rz);
  let bmp = selectionBitmaps.get(key);
  if (!bmp) {
    const [r, g, b] = theme().selection;
    bmp = canvasOf(buildSelectionPixels(bits, [r, g, b, 140]));
    selectionBitmaps.set(key, bmp);
  }
  return bmp;
}

const tiles = createTileStore<ImageBitmap>({
  load: (rx, rz) => (props.tileLoader ? props.tileLoader(rx, rz) : Promise.resolve(null)),
  onChange: () => requestDraw(),
  // Left plain after the retries; say why somewhere an admin can find it.
  onError: (rx, rz, err) => console.warn(`Terrain picture of region ${rx}, ${rz} could not be loaded:`, err),
});

/** Ask for the pictures of the regions in view, middle first; none when the terrain is not on show. */
function wantTiles(v: { rx0: number; rx1: number; rz0: number; rz1: number }): void {
  if (!terrainActive()) {
    tiles.want([]);
    return;
  }
  const midX = camera.value.cx / REGION_CHUNKS;
  const midZ = camera.value.cz / REGION_CHUNKS;
  const wanted = [];
  for (const r of regionIndex.value.values()) {
    if (r.rx < v.rx0 || r.rx > v.rx1 || r.rz < v.rz0 || r.rz > v.rz1) continue;
    wanted.push({ rx: r.rx, rz: r.rz, priority: Math.hypot(r.rx + 0.5 - midX, r.rz + 0.5 - midZ) });
  }
  tiles.want(wanted);
}

function invalidateBase(): void {
  bitmaps.clear();
  themeCache = null;
  requestDraw();
}

function invalidateSelection(): void {
  selectionBitmaps.clear();
  requestDraw();
}

// ── Drawing ───────────────────────────────────────────────────────────────

let frame = 0;

function requestDraw(): void {
  if (frame || typeof requestAnimationFrame === "undefined") return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  return ctx;
}

function drawBase(): void {
  const el = baseCanvas.value;
  const ctx = el && prepare(el);
  if (!ctx) return;
  const th = theme();
  ctx.fillStyle = th.surface;
  ctx.fillRect(0, 0, size.width, size.height);
  const v = visibleRegions(camera.value, size);
  const terrain = terrainActive();
  wantTiles(v);
  for (const r of regionIndex.value.values()) {
    if (r.rx < v.rx0 || r.rx > v.rx1 || r.rz < v.rz0 || r.rz > v.rz1) continue;
    const { x, y, w, h } = regionRect(camera.value, size, r.rx, r.rz);
    const picture = terrain ? tiles.get(r.rx, r.rz) : null;
    const hasPicture = !!picture && picture !== "none";
    if (hasPicture) {
      // One pixel per block: crisp from one screen pixel per block up, smoothed when shrunk.
      ctx.imageSmoothingEnabled = camera.value.zoom < 16;
      ctx.drawImage(picture, x, y, w, h);
      // Fading the colours out only bares a region that has a picture; elsewhere the map would go blank.
      if (props.overlayOpacity <= 0) continue;
    }
    ctx.imageSmoothingEnabled = camera.value.zoom < 1;
    ctx.drawImage(bitmapFor(r, hasPicture), x, y, w, h);
  }
}

function drawOver(): void {
  const el = overCanvas.value;
  const ctx = el && prepare(el);
  if (!ctx) return;
  drawOverlay(ctx, {
    camera: camera.value,
    size,
    theme: theme(),
    dimension: props.map.dimension,
    selection: props.selection,
    selectionBitmap,
    regions: regionIndex.value.values(),
    zones: props.zones,
    showGrid: props.showGrid,
    dragRect: dragRect(),
    inspected: props.inspected,
    hover: isDragging() ? null : hover.value,
  });
}

function draw(): void {
  if (size.width === 0 || size.height === 0) return;
  drawBase();
  drawOver();
  emit("camera", { zoom: camera.value.zoom, cx: camera.value.cx, cz: camera.value.cz });
}

// ── Sizing and fitting ────────────────────────────────────────────────────

function resize(): void {
  const el = host.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  size.width = Math.max(0, Math.floor(rect.width));
  size.height = Math.max(0, Math.floor(rect.height));
  dpr = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  for (const c of [baseCanvas.value, overCanvas.value]) {
    if (!c) continue;
    c.width = Math.floor(size.width * dpr);
    c.height = Math.floor(size.height * dpr);
    c.style.width = `${size.width}px`;
    c.style.height = `${size.height}px`;
  }
  if (!fitted && size.width > 0) fit();
  else requestDraw();
}

function fit(): void {
  const bounds = regionBoundsToChunks(props.map.bounds);
  if (!bounds || size.width === 0) return;
  camera.value = fitBounds(bounds, size);
  fitted = true;
  requestDraw();
}

function zoomBy(factor: number): void {
  camera.value = zoomAt(camera.value, size, factor, size.width / 2, size.height / 2);
  requestDraw();
}

function centerOn(cx: number, cz: number): void {
  camera.value = { ...camera.value, cx, cz };
  requestDraw();
}

defineExpose({ fit, zoomIn: () => zoomBy(1.5), zoomOut: () => zoomBy(1 / 1.5), centerOn });

// ── Pointer and keyboard ──────────────────────────────────────────────────

function lookup(cx: number, cz: number): { cell: number; heat: number } {
  const r = regionIndex.value.get(regionKey(regionOf(cx), regionOf(cz)));
  if (!r) return { cell: CELL.EMPTY, heat: 0 };
  const slot = slotOf(cx, cz);
  return { cell: r.cell[slot]!, heat: r.heat[slot]! };
}

const {
  hover,
  cursor,
  cursorClass,
  dragRect,
  isDragging,
  onDown,
  onMove,
  onUp,
  onCancel,
  onLeave,
  onWheel,
  onKey,
  onKeyUp,
} = usePruneMapInput({
  camera,
  size,
  tool: () => props.tool,
  dimension: () => props.map.dimension,
  selection: () => props.selection,
  canvas: () => overCanvas.value,
  host: () => host.value,
  lookup,
  requestDraw,
  fit,
  zoomBy,
  onZone: (rect) => emit("zone", rect),
  onSelect: (rect) => emit("select", rect),
  onInspect: (at) => emit("inspect", at),
  onUndo: () => emit("undo"),
  onRedo: () => emit("redo"),
});

// ── Hover text ────────────────────────────────────────────────────────────

const CELL_LABEL: Record<number, string> = {
  [CELL.DELETE]: "prune.cell.delete",
  [CELL.ACTIVE]: "prune.cell.active",
  [CELL.PROTECTED]: "prune.cell.protected",
  [CELL.BUFFER]: "prune.cell.buffer",
  [CELL.UNREADABLE]: "prune.cell.unreadable",
  [CELL.UNCERTAIN]: "prune.cell.uncertain",
  [CELL.MANUAL_SOFT]: "prune.cell.manualSoft",
  [CELL.MANUAL_HARD]: "prune.cell.manualHard",
};

const hoverText = computed(() => {
  const h = hover.value;
  if (!h) return t("prune.map.hint");
  const where = t("prune.map.chunk", { x: h.cx, z: h.cz, bx: h.cx * 16, bz: h.cz * 16 });
  if (h.cell === CELL.EMPTY) return `${where}: ${t("prune.cell.empty")}`;
  const parts = [t(CELL_LABEL[h.cell] as never)];
  if (h.heat > 0) parts.push(t("prune.map.used", { minutes: formatNumber(heatMinutes(h.heat)) }));
  if (h.selected) parts.push(t("prune.map.selected"));
  return `${where}: ${parts.join(", ")}`;
});

// ── Lifecycle ─────────────────────────────────────────────────────────────

let observer: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;

onMounted(() => {
  overCanvas.value?.addEventListener("wheel", onWheel, { passive: false });
  if (typeof ResizeObserver !== "undefined" && host.value) {
    observer = new ResizeObserver(resize);
    observer.observe(host.value);
  }
  if (typeof MutationObserver !== "undefined") {
    themeObserver = new MutationObserver(invalidateBase);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
  }
  lastDimension = props.map.dimension;
  resize();
});

onBeforeUnmount(() => {
  overCanvas.value?.removeEventListener("wheel", onWheel);
  observer?.disconnect();
  themeObserver?.disconnect();
  tiles.reset();
  if (frame && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(frame);
});

watch(
  () => props.map,
  (next) => {
    // A new scan of the same dimension keeps the view; another dimension starts fitted.
    if (next.dimension !== lastDimension) {
      lastDimension = next.dimension;
      fitted = false;
      tiles.reset();
      fit();
    }
    invalidateBase();
  },
);
watch(() => props.view, invalidateBase);
// A different loader means another server or plan: the pictures held belong to the old one.
watch(() => props.tileLoader, () => {
  tiles.reset();
  requestDraw();
});
watch(() => props.selectionVersion, invalidateSelection);
watch(() => props.inspected, requestDraw);
watch(() => [props.zones, props.showGrid, props.tool], requestDraw, { deep: true });
// Bitmaps are kept per opacity; drop the old ones so a slider drag does not pile them up.
watch(() => props.overlayOpacity, invalidateBase);
</script>

<style scoped>
.prune-map {
  display: grid;
  gap: var(--space-2);
}
.pm-host {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 6px;
  /* Unscanned ground reads as a block grid until the regions are painted over it. */
  --pm-grid: color-mix(in srgb, var(--border) 55%, transparent);
  background:
    linear-gradient(var(--pm-grid) 1px, transparent 1px) 0 0 / 16px 16px,
    linear-gradient(90deg, var(--pm-grid) 1px, transparent 1px) 0 0 / 16px 16px,
    var(--surface);
  touch-action: none;
}
.pm-host:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.pm-layer {
  position: absolute;
  inset: 0;
  display: block;
}
.pm-over.is-pan {
  cursor: grab;
}
.pm-over.is-grabbing {
  cursor: grabbing;
}
.pm-over.is-draw {
  cursor: crosshair;
}
.pm-hover {
  margin: 0;
  min-height: 1.4em;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
</style>

<template>
  <div class="prune-map">
    <div
      ref="host"
      class="pm-host"
      :style="{ height }"
      tabindex="0"
      role="group"
      :aria-label="label"
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight + - 0 Escape"
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
    <p class="pm-hover" role="status" aria-live="off">{{ hoverText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { PruneZone } from "@mcbot/schema/wire/index.js";
import { CELL, type DecodedMap, type DecodedRegion } from "../composables/usePrune";
import {
  chunkAt,
  fitBounds,
  panBy,
  regionBoundsToChunks,
  visibleRegions,
  worldToScreen,
  zoomAt,
  type Camera,
  type ViewSize,
} from "../composables/pruneCamera";
import {
  CELL_ROLE,
  buildRegionPixels,
  buildSelectionPixels,
  heatMinutes,
  isManualCell,
  type Palette,
  type Rgba,
} from "../composables/pruneMapRender";
import type { SelectionModel } from "../composables/pruneSelection";
import { t } from "../i18n";

export type MapTool = "pan" | "select" | "deselect" | "zone";

const props = withDefaults(
  defineProps<{
    map: DecodedMap;
    zones: PruneZone[];
    view: "class" | "heat";
    showGrid: boolean;
    tool: MapTool;
    selection: SelectionModel;
    /** Bumped whenever the selection changes, so the map redraws it. */
    selectionVersion: number;
    label: string;
    height?: string;
  }>(),
  { height: "min(70vh, 34rem)" },
);

const emit = defineEmits<{
  zone: [rect: { x1: number; z1: number; x2: number; z2: number }];
  select: [rect: { mode: "add" | "remove"; x1: number; z1: number; x2: number; z2: number }];
  camera: [info: { zoom: number; cx: number; cz: number }];
  undo: [];
  redo: [];
}>();

const host = ref<HTMLDivElement | null>(null);
const baseCanvas = ref<HTMLCanvasElement | null>(null);
const overCanvas = ref<HTMLCanvasElement | null>(null);

const camera = shallowRef<Camera>({ cx: 0, cz: 0, zoom: 1 });
const size: ViewSize = { width: 0, height: 0 };
let dpr = 1;
let fitted = false;
let lastDimension = "";

const hover = ref<{ cx: number; cz: number; cell: number; heat: number; selected: boolean } | null>(null);

// ── Theme colours ─────────────────────────────────────────────────────────

let colourProbe: CanvasRenderingContext2D | null = null;

/** Any CSS colour to RGBA, by letting a 1x1 canvas parse it. */
function toRgba(css: string, fallback: Rgba): Rgba {
  if (typeof document === "undefined") return fallback;
  colourProbe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colourProbe || !css) return fallback;
  colourProbe.clearRect(0, 0, 1, 1);
  colourProbe.fillStyle = "rgb(0, 0, 0)";
  colourProbe.fillStyle = css;
  colourProbe.fillRect(0, 0, 1, 1);
  const d = colourProbe.getImageData(0, 0, 1, 1).data;
  return [d[0]!, d[1]!, d[2]!, d[3]!];
}

function token(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const css = (rgba: Rgba, alpha = rgba[3] / 255): string => `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${alpha})`;

interface Theme {
  palette: Palette;
  surface: string;
  grid: string;
  zone: string;
  selection: Rgba;
  text: string;
  remove: string;
}

let themeCache: Theme | null = null;

function theme(): Theme {
  if (themeCache) return themeCache;
  const role = (r: string): Rgba => toRgba(token(`--st-${r}`), [128, 128, 128, 255]);
  const cell: Record<number, Rgba> = {};
  for (const [c, r] of Object.entries(CELL_ROLE)) cell[Number(c)] = role(r);
  themeCache = {
    palette: { cell, heat: role("degraded"), unknown: [128, 128, 128, 255] },
    surface: token("--surface") || "canvas",
    grid: css(toRgba(token("--border-strong"), [128, 128, 128, 255]), 0.6),
    zone: css(role("info")),
    selection: toRgba(token("--text"), [255, 255, 255, 255]),
    text: token("--text") || "canvastext",
    remove: css(role("offline")),
  };
  return themeCache;
}

// ── Region bitmaps ────────────────────────────────────────────────────────

const regionIndex = computed(() => {
  const m = new Map<string, { rx: number; rz: number } & DecodedRegion>();
  for (const r of props.map.regions) m.set(`${r.rx},${r.rz}`, r);
  return m;
});

const bitmaps = new Map<string, HTMLCanvasElement>();
const selectionBitmaps = new Map<string, HTMLCanvasElement>();

function canvasOf(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  c.getContext("2d")!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, 32, 32), 0, 0);
  return c;
}

function bitmapFor(r: { rx: number; rz: number } & DecodedRegion): HTMLCanvasElement {
  const key = `${r.rx},${r.rz}`;
  let bmp = bitmaps.get(key);
  if (!bmp) {
    bmp = canvasOf(buildRegionPixels(r.cell, r.heat, props.view, theme().palette));
    bitmaps.set(key, bmp);
  }
  return bmp;
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

/** Pixel-aligned rectangle of a region, so neighbours never leave a seam. */
function regionRect(rx: number, rz: number): { x: number; y: number; w: number; h: number } {
  const a = worldToScreen(camera.value, size, rx * 32, rz * 32);
  const b = worldToScreen(camera.value, size, rx * 32 + 32, rz * 32 + 32);
  const x = Math.floor(a.sx);
  const y = Math.floor(a.sz);
  return { x, y, w: Math.max(1, Math.floor(b.sx) - x), h: Math.max(1, Math.floor(b.sz) - y) };
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
  ctx.imageSmoothingEnabled = camera.value.zoom < 1;
  const v = visibleRegions(camera.value, size);
  for (const r of regionIndex.value.values()) {
    if (r.rx < v.rx0 || r.rx > v.rx1 || r.rz < v.rz0 || r.rz > v.rz1) continue;
    const { x, y, w, h } = regionRect(r.rx, r.rz);
    ctx.drawImage(bitmapFor(r), x, y, w, h);
  }
}

function drawOverlay(): void {
  const el = overCanvas.value;
  const ctx = el && prepare(el);
  if (!ctx) return;
  const th = theme();
  const cam = camera.value;
  const v = visibleRegions(cam, size);
  const inView = (rx: number, rz: number): boolean => rx >= v.rx0 && rx <= v.rx1 && rz >= v.rz0 && rz <= v.rz1;
  const dimension = props.map.dimension;

  // What is chosen by hand, before it has been previewed.
  ctx.imageSmoothingEnabled = cam.zoom < 1;
  props.selection.forEachRegion(dimension, (rx, rz, bits) => {
    if (!inView(rx, rz)) return;
    const key = `${rx},${rz}`;
    let bmp = selectionBitmaps.get(key);
    if (!bmp) {
      bmp = canvasOf(buildSelectionPixels(bits, [th.selection[0], th.selection[1], th.selection[2], 140]));
      selectionBitmaps.set(key, bmp);
    }
    const { x, y, w, h } = regionRect(rx, rz);
    ctx.drawImage(bmp, x, y, w, h);
  });

  // Shapes, so the states are not told apart by colour alone.
  if (cam.zoom >= 8) drawChunkMarks(ctx, th, v, inView);

  if (props.showGrid) {
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    if (cam.zoom >= 0.4) {
      for (let rz = v.rz0; rz <= v.rz1 + 1; rz++) {
        const y = Math.floor(worldToScreen(cam, size, 0, rz * 32).sz) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size.width, y);
        ctx.stroke();
      }
      for (let rx = v.rx0; rx <= v.rx1 + 1; rx++) {
        const x = Math.floor(worldToScreen(cam, size, rx * 32, 0).sx) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size.height);
        ctx.stroke();
      }
    }
    if (cam.zoom >= 12) {
      ctx.strokeStyle = css(toRgba(token("--border"), [128, 128, 128, 255]), 0.4);
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

  // Protected zones: dashed, so they differ from the protected fill in more than hue.
  ctx.lineWidth = 2;
  ctx.strokeStyle = th.zone;
  ctx.setLineDash([6, 4]);
  for (const z of props.zones) {
    if (z.dimension !== dimension) continue;
    const a = worldToScreen(cam, size, z.x1, z.z1);
    const b = worldToScreen(cam, size, z.x2 + 1, z.z2 + 1);
    ctx.strokeRect(a.sx, a.sz, b.sx - a.sx, b.sz - a.sz);
  }
  ctx.setLineDash([]);

  if (drag?.kind === "rect") {
    const x1 = Math.min(drag.from.cx, drag.to.cx);
    const z1 = Math.min(drag.from.cz, drag.to.cz);
    const x2 = Math.max(drag.from.cx, drag.to.cx);
    const z2 = Math.max(drag.from.cz, drag.to.cz);
    const a = worldToScreen(cam, size, x1, z1);
    const b = worldToScreen(cam, size, x2 + 1, z2 + 1);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = drag.mode === "remove" ? th.remove : drag.mode === "zone" ? th.zone : css(th.selection);
    ctx.fillStyle = drag.mode === "remove" ? css(toRgba(token("--st-offline"), [200, 60, 60, 255]), 0.12) : css(th.selection, 0.15);
    ctx.fillRect(a.sx, a.sz, b.sx - a.sx, b.sz - a.sz);
    ctx.strokeRect(a.sx, a.sz, b.sx - a.sx, b.sz - a.sz);
    ctx.setLineDash([]);
  }

  const h = hover.value;
  if (h && !drag) {
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

/** Per-chunk marks at high zoom: a diagonal for chosen chunks, an inset frame for manual deletions. */
function drawChunkMarks(
  ctx: CanvasRenderingContext2D,
  th: Theme,
  v: { rx0: number; rx1: number; rz0: number; rz1: number },
  inView: (rx: number, rz: number) => boolean,
): void {
  const cam = camera.value;
  const z = cam.zoom;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  ctx.strokeStyle = css(th.selection, 0.9);
  ctx.beginPath();
  props.selection.forEachRegion(props.map.dimension, (rx, rz, bits) => {
    if (!inView(rx, rz)) return;
    for (let cz = 0; cz < 32; cz++) {
      const row = bits[cz]!;
      if (row === 0) continue;
      for (let cx = 0; cx < 32; cx++) {
        if (((row >>> cx) & 1) === 0) continue;
        const a = worldToScreen(cam, size, rx * 32 + cx, rz * 32 + cz);
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
  for (const r of regionIndex.value.values()) {
    if (r.rx < v.rx0 || r.rx > v.rx1 || r.rz < v.rz0 || r.rz > v.rz1) continue;
    for (let slot = 0; slot < 1024; slot++) {
      if (!isManualCell(r.cell[slot]!)) continue;
      const a = worldToScreen(cam, size, r.rx * 32 + (slot & 31), r.rz * 32 + (slot >> 5));
      if (a.sx + z < 0 || a.sz + z < 0 || a.sx > size.width || a.sz > size.height) continue;
      ctx.rect(a.sx + 1.5, a.sz + 1.5, z - 3, z - 3);
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function draw(): void {
  if (size.width === 0 || size.height === 0) return;
  drawBase();
  drawOverlay();
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

type Drag =
  | { kind: "pan"; x: number; y: number }
  | { kind: "rect"; from: { cx: number; cz: number }; to: { cx: number; cz: number }; mode: "add" | "remove" | "zone" }
  | { kind: "pinch"; distance: number };

let drag: Drag | null = null;
const pointers = new Map<number, { x: number; y: number }>();
const spaceHeld = ref(false);

const cursorClass = computed(() => ({
  "is-pan": props.tool === "pan" || spaceHeld.value,
  "is-grabbing": drag?.kind === "pan",
  "is-draw": (props.tool !== "pan" && !spaceHeld.value),
}));

function local(ev: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = overCanvas.value!.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function lookup(cx: number, cz: number): { cell: number; heat: number } {
  const r = regionIndex.value.get(`${Math.floor(cx / 32)},${Math.floor(cz / 32)}`);
  if (!r) return { cell: CELL.EMPTY, heat: 0 };
  const slot = (cx & 31) + (cz & 31) * 32;
  return { cell: r.cell[slot]!, heat: r.heat[slot]! };
}

function updateHover(p: { x: number; y: number }): void {
  const { cx, cz } = chunkAt(camera.value, size, p.x, p.y);
  const prev = hover.value;
  if (prev && prev.cx === cx && prev.cz === cz) return;
  hover.value = { cx, cz, ...lookup(cx, cz), selected: props.selection.has(props.map.dimension, cx, cz) };
  requestDraw();
}

function onDown(ev: PointerEvent): void {
  overCanvas.value!.setPointerCapture(ev.pointerId);
  host.value?.focus({ preventScroll: true });
  const p = local(ev);
  pointers.set(ev.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    drag = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) };
    return;
  }
  const wantsPan = props.tool === "pan" || spaceHeld.value || ev.button === 1 || ev.button === 2;
  if (wantsPan) {
    drag = { kind: "pan", x: p.x, y: p.y };
    return;
  }
  if (ev.button !== 0) return;
  const at = chunkAt(camera.value, size, p.x, p.y);
  const mode = props.tool === "zone" ? "zone" : props.tool === "deselect" || ev.altKey ? "remove" : "add";
  drag = { kind: "rect", from: at, to: at, mode };
  requestDraw();
}

function onMove(ev: PointerEvent): void {
  const p = local(ev);
  if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
  if (drag?.kind === "pinch" && pointers.size >= 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (drag.distance > 0 && distance > 0) {
      camera.value = zoomAt(camera.value, size, distance / drag.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    drag.distance = distance;
    requestDraw();
    return;
  }
  if (drag?.kind === "pan") {
    camera.value = panBy(camera.value, p.x - drag.x, p.y - drag.y);
    drag.x = p.x;
    drag.y = p.y;
    requestDraw();
    return;
  }
  if (drag?.kind === "rect") {
    drag.to = chunkAt(camera.value, size, p.x, p.y);
    requestDraw();
  }
  updateHover(p);
}

function onUp(ev: PointerEvent): void {
  pointers.delete(ev.pointerId);
  const finished = drag;
  if (finished?.kind === "pinch") {
    if (pointers.size < 2) drag = null;
    return;
  }
  drag = null;
  if (finished?.kind === "rect") {
    const rect = {
      x1: Math.min(finished.from.cx, finished.to.cx),
      z1: Math.min(finished.from.cz, finished.to.cz),
      x2: Math.max(finished.from.cx, finished.to.cx),
      z2: Math.max(finished.from.cz, finished.to.cz),
    };
    if (finished.mode === "zone") emit("zone", rect);
    else emit("select", { mode: finished.mode, ...rect });
  }
  requestDraw();
}

function onCancel(ev: PointerEvent): void {
  pointers.delete(ev.pointerId);
  drag = null;
  requestDraw();
}

function onLeave(): void {
  if (drag) return;
  hover.value = null;
  requestDraw();
}

function onWheel(ev: WheelEvent): void {
  ev.preventDefault();
  const p = local(ev);
  const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
  camera.value = zoomAt(camera.value, size, factor, p.x, p.y);
  requestDraw();
}

const PAN_STEP = 64;

function onKey(ev: KeyboardEvent): void {
  if (ev.ctrlKey || ev.metaKey) {
    const key = ev.key.toLowerCase();
    if (key === "z" && !ev.shiftKey) emit("undo");
    else if (key === "y" || (key === "z" && ev.shiftKey)) emit("redo");
    else return;
    ev.preventDefault();
    return;
  }
  switch (ev.key) {
    case "ArrowLeft":
      camera.value = panBy(camera.value, PAN_STEP, 0);
      break;
    case "ArrowRight":
      camera.value = panBy(camera.value, -PAN_STEP, 0);
      break;
    case "ArrowUp":
      camera.value = panBy(camera.value, 0, PAN_STEP);
      break;
    case "ArrowDown":
      camera.value = panBy(camera.value, 0, -PAN_STEP);
      break;
    case "+":
    case "=":
      zoomBy(1.25);
      break;
    case "-":
    case "_":
      zoomBy(0.8);
      break;
    case "0":
      fit();
      break;
    case " ":
      spaceHeld.value = true;
      break;
    case "Escape":
      drag = null;
      break;
    default:
      return;
  }
  ev.preventDefault();
  requestDraw();
}

function onKeyUp(ev: KeyboardEvent): void {
  if (ev.key === " ") spaceHeld.value = false;
}

// ── Hover text ────────────────────────────────────────────────────────────

const CELL_LABEL: Record<number, string> = {
  [CELL.DELETE]: "prune.cell.delete",
  [CELL.ACTIVE]: "prune.cell.active",
  [CELL.PROTECTED]: "prune.cell.protected",
  [CELL.BUFFER]: "prune.cell.buffer",
  [CELL.UNREADABLE]: "prune.cell.unreadable",
  [CELL.MANUAL_SOFT]: "prune.cell.manualSoft",
  [CELL.MANUAL_HARD]: "prune.cell.manualHard",
};

const hoverText = computed(() => {
  const h = hover.value;
  if (!h) return t("prune.map.hint");
  const where = t("prune.map.chunk", { x: h.cx, z: h.cz, bx: h.cx * 16, bz: h.cz * 16 });
  if (h.cell === CELL.EMPTY) return `${where}: ${t("prune.cell.empty")}`;
  const parts = [t(CELL_LABEL[h.cell] as never)];
  if (h.heat > 0) parts.push(t("prune.map.used", { minutes: heatMinutes(h.heat).toLocaleString() }));
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
  if (frame && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(frame);
});

watch(
  () => props.map,
  (next) => {
    // A new scan of the same dimension keeps the view; another dimension starts fitted.
    if (next.dimension !== lastDimension) {
      lastDimension = next.dimension;
      fitted = false;
      fit();
    }
    invalidateBase();
  },
);
watch(() => props.view, invalidateBase);
watch(() => props.selectionVersion, invalidateSelection);
watch(() => [props.zones, props.showGrid, props.tool], requestDraw, { deep: true });
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
  background: var(--surface);
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

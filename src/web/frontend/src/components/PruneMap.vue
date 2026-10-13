<template>
  <div class="prune-map">
    <div class="pm-scroll" :style="{ maxHeight }">
      <canvas
        ref="canvas"
        class="pm-canvas"
        :class="{ 'is-drawing': drawing }"
        role="img"
        :aria-label="label"
        @mousemove="onMove"
        @mouseleave="onLeave"
        @mousedown="onDown"
        @mouseup="onUp"
      />
    </div>
    <p class="pm-hover" role="status" aria-live="polite">{{ hoverText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { PruneZone } from "@mcbot/schema/wire/index.js";
import { CELL, type DecodedMap } from "../composables/usePrune";
import { t } from "../i18n";

const props = withDefaults(
  defineProps<{
    map: DecodedMap;
    zones: PruneZone[];
    view: "class" | "heat";
    /** Pixels per chunk. */
    scale: number;
    showGrid: boolean;
    /** Dragging a rectangle adds a protected zone. */
    drawing: boolean;
    label: string;
    maxHeight?: string;
  }>(),
  { maxHeight: "70vh" },
);

const emit = defineEmits<{
  zone: [rect: { x1: number; z1: number; x2: number; z2: number }];
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const hover = ref<{ cx: number; cz: number; cell: number; heat: number } | null>(null);
let dragFrom: { cx: number; cz: number } | null = null;
const dragTo = ref<{ cx: number; cz: number } | null>(null);

/** Colours come from the status tokens so the map follows the theme. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const geometry = computed(() => {
  const b = props.map.bounds;
  if (!b) return { minX: 0, minZ: 0, widthChunks: 32, heightChunks: 32 };
  return {
    minX: b.minX * 32,
    minZ: b.minZ * 32,
    widthChunks: (b.maxX - b.minX + 1) * 32,
    heightChunks: (b.maxZ - b.minZ + 1) * 32,
  };
});

const CELL_ROLE: Record<number, string> = {
  [CELL.DELETE]: "offline",
  [CELL.ACTIVE]: "online",
  [CELL.PROTECTED]: "info",
  [CELL.BUFFER]: "pending",
  [CELL.UNREADABLE]: "degraded",
};

const CELL_LABEL: Record<number, string> = {
  [CELL.DELETE]: "prune.cell.delete",
  [CELL.ACTIVE]: "prune.cell.active",
  [CELL.PROTECTED]: "prune.cell.protected",
  [CELL.BUFFER]: "prune.cell.buffer",
  [CELL.UNREADABLE]: "prune.cell.unreadable",
};

function draw(): void {
  const el = canvas.value;
  if (!el) return;
  const { minX, minZ, widthChunks, heightChunks } = geometry.value;
  const s = props.scale;
  el.width = widthChunks * s;
  el.height = heightChunks * s;
  const ctx = el.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = token("--surface", "transparent");
  ctx.fillRect(0, 0, el.width, el.height);

  const colours: Record<number, string> = {};
  for (const [cell, role] of Object.entries(CELL_ROLE)) colours[Number(cell)] = token(`--st-${role}`, "gray");
  const heatBase = token("--st-degraded", "orange");

  for (const r of props.map.regions) {
    const ox = (r.rx * 32 - minX) * s;
    const oz = (r.rz * 32 - minZ) * s;
    for (let slot = 0; slot < 1024; slot++) {
      const cell = r.cell[slot]!;
      if (cell === CELL.EMPTY) continue;
      const x = ox + (slot & 31) * s;
      const z = oz + (slot >> 5) * s;
      if (props.view === "heat") {
        ctx.globalAlpha = 0.15 + (r.heat[slot]! / 255) * 0.85;
        ctx.fillStyle = heatBase;
      } else {
        ctx.globalAlpha = 1;
        ctx.fillStyle = colours[cell] ?? "gray";
      }
      ctx.fillRect(x, z, s, s);
    }
    ctx.globalAlpha = 1;
  }

  if (props.showGrid && s >= 2) {
    ctx.strokeStyle = token("--border-strong", "silver");
    ctx.lineWidth = 1;
    for (const r of props.map.regions) {
      ctx.strokeRect((r.rx * 32 - minX) * s + 0.5, (r.rz * 32 - minZ) * s + 0.5, 32 * s - 1, 32 * s - 1);
    }
  }

  ctx.lineWidth = 2;
  ctx.strokeStyle = token("--st-info", "steelblue");
  for (const z of props.zones) {
    if (z.dimension !== props.map.dimension) continue;
    ctx.strokeRect((z.x1 - minX) * s, (z.z1 - minZ) * s, (z.x2 - z.x1 + 1) * s, (z.z2 - z.z1 + 1) * s);
  }
  if (dragFrom && dragTo.value) {
    const x1 = Math.min(dragFrom.cx, dragTo.value.cx);
    const z1 = Math.min(dragFrom.cz, dragTo.value.cz);
    const x2 = Math.max(dragFrom.cx, dragTo.value.cx);
    const z2 = Math.max(dragFrom.cz, dragTo.value.cz);
    ctx.setLineDash([4, 3]);
    ctx.strokeRect((x1 - minX) * s, (z1 - minZ) * s, (x2 - x1 + 1) * s, (z2 - z1 + 1) * s);
    ctx.setLineDash([]);
  }
}

function chunkAt(ev: MouseEvent): { cx: number; cz: number } {
  const el = canvas.value!;
  const rect = el.getBoundingClientRect();
  const px = ((ev.clientX - rect.left) / rect.width) * el.width;
  const pz = ((ev.clientY - rect.top) / rect.height) * el.height;
  return {
    cx: geometry.value.minX + Math.floor(px / props.scale),
    cz: geometry.value.minZ + Math.floor(pz / props.scale),
  };
}

function lookup(cx: number, cz: number): { cell: number; heat: number } {
  const rx = Math.floor(cx / 32);
  const rz = Math.floor(cz / 32);
  const r = props.map.regions.find((g) => g.rx === rx && g.rz === rz);
  if (!r) return { cell: CELL.EMPTY, heat: 0 };
  const slot = (cx & 31) + (cz & 31) * 32;
  return { cell: r.cell[slot]!, heat: r.heat[slot]! };
}

function onMove(ev: MouseEvent): void {
  const { cx, cz } = chunkAt(ev);
  hover.value = { cx, cz, ...lookup(cx, cz) };
  if (props.drawing && dragFrom) {
    dragTo.value = { cx, cz };
    draw();
  }
}

function onLeave(): void {
  hover.value = null;
}

function onDown(ev: MouseEvent): void {
  if (!props.drawing) return;
  dragFrom = chunkAt(ev);
  dragTo.value = dragFrom;
}

function onUp(ev: MouseEvent): void {
  if (!props.drawing || !dragFrom) return;
  const to = chunkAt(ev);
  emit("zone", {
    x1: Math.min(dragFrom.cx, to.cx),
    z1: Math.min(dragFrom.cz, to.cz),
    x2: Math.max(dragFrom.cx, to.cx),
    z2: Math.max(dragFrom.cz, to.cz),
  });
  dragFrom = null;
  dragTo.value = null;
  draw();
}

const hoverText = computed(() => {
  const h = hover.value;
  if (!h) return t("prune.map.hint");
  const where = t("prune.map.chunk", { x: h.cx, z: h.cz, bx: h.cx * 16, bz: h.cz * 16 });
  if (h.cell === CELL.EMPTY) return `${where}: ${t("prune.cell.empty")}`;
  return `${where}: ${t(CELL_LABEL[h.cell] as never)}`;
});

onMounted(draw);
watch(() => [props.map, props.zones, props.view, props.scale, props.showGrid], draw, { deep: true });
</script>

<style scoped>
.prune-map {
  display: grid;
  gap: var(--space-2);
}
.pm-scroll {
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}
.pm-canvas {
  display: block;
  image-rendering: pixelated;
  cursor: default;
}
.pm-canvas.is-drawing {
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

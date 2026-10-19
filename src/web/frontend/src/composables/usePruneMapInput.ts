import { computed, ref, type ShallowRef } from "vue";
import { chunkAt, panBy, worldToScreen, zoomAt, type Camera, type ViewSize } from "./pruneCamera";
import type { RectDrag } from "./pruneMapOverlay";
import type { Rect } from "./pruneRegion";
import type { SelectionModel } from "./pruneSelection";

export type MapTool = "pan" | "select" | "deselect" | "zone" | "inspect";

type Chunk = { cx: number; cz: number };
type Point = { x: number; y: number };

type Drag =
  | { kind: "pan"; x: number; y: number }
  | { kind: "click"; x: number; y: number; at: Chunk }
  | ({ kind: "rect" } & RectDrag)
  | { kind: "pinch"; distance: number };

export interface Hover extends Chunk {
  cell: number;
  heat: number;
  selected: boolean;
}

export interface MapInputOptions {
  camera: ShallowRef<Camera>;
  /** Mutated in place by the component whenever the canvas is resized. */
  size: ViewSize;
  tool: () => MapTool;
  dimension: () => string;
  selection: () => SelectionModel;
  canvas: () => HTMLCanvasElement | null;
  host: () => HTMLElement | null;
  lookup: (cx: number, cz: number) => { cell: number; heat: number };
  requestDraw: () => void;
  fit: () => void;
  zoomBy: (factor: number) => void;
  onZone: (rect: Rect) => void;
  onSelect: (rect: Rect & { mode: "add" | "remove" }) => void;
  onInspect: (at: Chunk) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Chunks a Shift+arrow moves the keyboard cursor. */
const JUMP = 8;
const PAGE_PAN = 0.8;
const EDGE_MARGIN_PX = 24;
const CLICK_SLOP_PX = 4;

/**
 * Pointer, wheel and keyboard handling for the prune map: panning, pinch
 * zoom, rectangle drags, a keyboard cursor and the shortcuts. It moves the
 * camera and reports what the user chose; drawing stays with the component.
 */
export function usePruneMapInput(o: MapInputOptions) {
  let drag: Drag | null = null;
  const dragKind = ref<Drag["kind"] | null>(null);
  const pointers = new Map<number, Point>();
  const spaceHeld = ref(false);
  const hover = ref<Hover | null>(null);
  /** The chunk the keyboard cursor is on, or null while the map is only used with a pointer. */
  const cursor = ref<Chunk | null>(null);

  function setDrag(next: Drag | null): void {
    drag = next;
    dragKind.value = next?.kind ?? null;
  }

  const cursorClass = computed(() => ({
    "is-pan": o.tool() === "pan" || spaceHeld.value,
    "is-grabbing": dragKind.value === "pan",
    "is-draw": o.tool() !== "pan" && !spaceHeld.value,
  }));

  /** The rectangle being dragged out, for the overlay. */
  function dragRect(): RectDrag | null {
    return drag?.kind === "rect" ? { from: drag.from, to: drag.to, mode: drag.mode } : null;
  }

  function local(ev: PointerEvent | WheelEvent): Point {
    const rect = o.canvas()!.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function hoverAt(cx: number, cz: number): Hover {
    return { cx, cz, ...o.lookup(cx, cz), selected: o.selection().has(o.dimension(), cx, cz) };
  }

  function updateHover(p: Point): void {
    cursor.value = null; // a pointer in use takes over from the keyboard cursor
    const { cx, cz } = chunkAt(o.camera.value, o.size, p.x, p.y);
    const prev = hover.value;
    if (prev && prev.cx === cx && prev.cz === cz) return;
    hover.value = hoverAt(cx, cz);
    o.requestDraw();
  }

  function onDown(ev: PointerEvent): void {
    o.canvas()!.setPointerCapture(ev.pointerId);
    o.host()?.focus({ preventScroll: true });
    const p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      setDrag({ kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y) });
      return;
    }
    const tool = o.tool();
    const wantsPan = tool === "pan" || spaceHeld.value || ev.button === 1 || ev.button === 2;
    if (wantsPan) {
      setDrag({ kind: "pan", x: p.x, y: p.y });
      return;
    }
    if (tool === "inspect" && ev.button === 0) {
      // A click inspects; a drag still moves the view.
      setDrag({ kind: "click", x: p.x, y: p.y, at: chunkAt(o.camera.value, o.size, p.x, p.y) });
      return;
    }
    if (ev.button !== 0) return;
    const at = chunkAt(o.camera.value, o.size, p.x, p.y);
    const mode = tool === "zone" ? "zone" : tool === "deselect" || ev.altKey ? "remove" : "add";
    setDrag({ kind: "rect", from: at, to: at, mode });
    o.requestDraw();
  }

  function onMove(ev: PointerEvent): void {
    const p = local(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, p);
    if (drag?.kind === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()] as [Point, Point];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (drag.distance > 0 && distance > 0) {
        o.camera.value = zoomAt(o.camera.value, o.size, distance / drag.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      drag.distance = distance;
      o.requestDraw();
      return;
    }
    if (drag?.kind === "click" && Math.hypot(p.x - drag.x, p.y - drag.y) > CLICK_SLOP_PX) {
      setDrag({ kind: "pan", x: drag.x, y: drag.y });
    }
    // Read again: a click that moved far enough has just become a pan.
    const active = drag as Drag | null;
    if (active?.kind === "pan") {
      o.camera.value = panBy(o.camera.value, p.x - active.x, p.y - active.y);
      active.x = p.x;
      active.y = p.y;
      o.requestDraw();
      return;
    }
    if (active?.kind === "rect") {
      active.to = chunkAt(o.camera.value, o.size, p.x, p.y);
      o.requestDraw();
    }
    updateHover(p);
  }

  function onUp(ev: PointerEvent): void {
    pointers.delete(ev.pointerId);
    const finished = drag;
    if (finished?.kind === "pinch") {
      if (pointers.size < 2) setDrag(null);
      return;
    }
    setDrag(null);
    if (finished?.kind === "click") o.onInspect(finished.at);
    if (finished?.kind === "rect") {
      const rect: Rect = {
        x1: Math.min(finished.from.cx, finished.to.cx),
        z1: Math.min(finished.from.cz, finished.to.cz),
        x2: Math.max(finished.from.cx, finished.to.cx),
        z2: Math.max(finished.from.cz, finished.to.cz),
      };
      if (finished.mode === "zone") o.onZone(rect);
      else o.onSelect({ mode: finished.mode, ...rect });
    }
    o.requestDraw();
  }

  function onCancel(ev: PointerEvent): void {
    pointers.delete(ev.pointerId);
    setDrag(null);
    o.requestDraw();
  }

  function onLeave(): void {
    if (drag || cursor.value) return;
    hover.value = null;
    o.requestDraw();
  }

  function onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const p = local(ev);
    const factor = Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015));
    o.camera.value = zoomAt(o.camera.value, o.size, factor, p.x, p.y);
    o.requestDraw();
  }

  function moveCursor(dx: number, dz: number): void {
    const from = cursor.value ?? chunkAt(o.camera.value, o.size, o.size.width / 2, o.size.height / 2);
    const to = { cx: from.cx + dx, cz: from.cz + dz };
    cursor.value = to;
    // Keep it on screen: pan just far enough to bring it back inside a small margin.
    const a = worldToScreen(o.camera.value, o.size, to.cx, to.cz);
    const zoom = o.camera.value.zoom;
    let moveX = 0;
    let moveZ = 0;
    if (a.sx < EDGE_MARGIN_PX) moveX = EDGE_MARGIN_PX - a.sx;
    else if (a.sx + zoom > o.size.width - EDGE_MARGIN_PX) moveX = o.size.width - EDGE_MARGIN_PX - (a.sx + zoom);
    if (a.sz < EDGE_MARGIN_PX) moveZ = EDGE_MARGIN_PX - a.sz;
    else if (a.sz + zoom > o.size.height - EDGE_MARGIN_PX) moveZ = o.size.height - EDGE_MARGIN_PX - (a.sz + zoom);
    if (moveX !== 0 || moveZ !== 0) o.camera.value = panBy(o.camera.value, moveX, moveZ);
    hover.value = hoverAt(to.cx, to.cz);
  }

  /** Keyboard stand-in for a click: choose or unchoose the chunk under the cursor. */
  function toggleAtCursor(): void {
    const at = cursor.value;
    if (!at) return;
    const mode = o.selection().has(o.dimension(), at.cx, at.cz) ? "remove" : "add";
    o.onSelect({ mode, x1: at.cx, z1: at.cz, x2: at.cx, z2: at.cz });
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey) {
      const key = ev.key.toLowerCase();
      if (key === "z" && !ev.shiftKey) o.onUndo();
      else if (key === "y" || (key === "z" && ev.shiftKey)) o.onRedo();
      else return;
      ev.preventDefault();
      return;
    }
    // Arrows move a cursor from chunk to chunk (Shift jumps eight); the view follows it.
    const step = ev.shiftKey ? JUMP : 1;
    switch (ev.key) {
      case "ArrowLeft":
        moveCursor(-step, 0);
        break;
      case "ArrowRight":
        moveCursor(step, 0);
        break;
      case "ArrowUp":
        moveCursor(0, -step);
        break;
      case "ArrowDown":
        moveCursor(0, step);
        break;
      case "PageUp":
        o.camera.value = panBy(o.camera.value, 0, o.size.height * PAGE_PAN);
        break;
      case "PageDown":
        o.camera.value = panBy(o.camera.value, 0, -o.size.height * PAGE_PAN);
        break;
      case "Enter": {
        const at = cursor.value;
        if (!at) return;
        o.onInspect(at);
        break;
      }
      case "+":
      case "=":
        o.zoomBy(1.25);
        break;
      case "-":
      case "_":
        o.zoomBy(0.8);
        break;
      case "0":
        o.fit();
        break;
      case " ":
        if (cursor.value) toggleAtCursor();
        else spaceHeld.value = true;
        break;
      case "Escape":
        setDrag(null);
        cursor.value = null;
        hover.value = null;
        break;
      default:
        return;
    }
    ev.preventDefault();
    o.requestDraw();
  }

  function onKeyUp(ev: KeyboardEvent): void {
    if (ev.key === " ") spaceHeld.value = false;
  }

  return {
    hover,
    cursor,
    cursorClass,
    dragRect,
    isDragging: () => drag !== null,
    onDown,
    onMove,
    onUp,
    onCancel,
    onLeave,
    onWheel,
    onKey,
    onKeyUp,
  };
}

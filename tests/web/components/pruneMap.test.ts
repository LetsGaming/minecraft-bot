// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import PruneMap from "../../../src/web/frontend/src/components/PruneMap.vue";
import { SelectionModel } from "../../../src/web/frontend/src/composables/pruneSelection";
import { CELL, type DecodedMap } from "../../../src/web/frontend/src/composables/usePrune";

/** Records what the map asks the canvas to draw; jsdom has no canvas of its own. */
function fakeContext() {
  const calls: string[] = [];
  const target: Record<string, unknown> = {
    getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }),
    putImageData: () => calls.push("putImageData"),
  };
  return {
    calls,
    ctx: new Proxy(target, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        return (..._args: unknown[]) => {
          calls.push(prop);
        };
      },
      set(t, prop: string, value) {
        t[prop] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D,
  };
}

function region(rx: number, rz: number, cell: number): DecodedMap["regions"][number] {
  const cells = new Uint8Array(1024).fill(cell);
  return { rx, rz, cell: cells, heat: new Uint8Array(1024).fill(40) };
}

function map(): DecodedMap {
  const regions = [region(0, 0, CELL.DELETE), region(-1, 0, CELL.ACTIVE), region(0, -1, CELL.MANUAL_SOFT)];
  return { dimension: "overworld", regions, bounds: { minX: -1, minZ: -1, maxX: 0, maxZ: 0 } };
}

let observed: Array<() => void> = [];

beforeEach(() => {
  observed = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observed.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  // Runs the frame at once; 0 as the handle, so the component sees no frame pending afterwards.
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    cb();
    return 0;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 400, left: 0, top: 0, right: 640, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mountMap(extra: Record<string, unknown> = {}) {
  const regions = map().regions;
  const selection = new SelectionModel(() => regions);
  const log = fakeContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(log.ctx as never);
  const wrapper = mount(PruneMap, {
    props: {
      map: map(),
      zones: [{ name: "base", dimension: "overworld", x1: 0, z1: 0, x2: 10, z2: 10 }],
      view: "class",
      showGrid: true,
      tool: "pan",
      selection,
      selectionVersion: 0,
      label: "Map of overworld",
      ...extra,
    },
    attachTo: document.body,
  });
  return { wrapper, selection, log };
}

describe("PruneMap", () => {
  it("draws the regions in view and the grid, and sizes the canvases to the view", async () => {
    const { wrapper, log } = mountMap();
    await nextTick();
    const canvases = wrapper.findAll("canvas");
    expect(canvases).toHaveLength(2);
    expect((canvases[0]!.element as HTMLCanvasElement).style.width).toBe("640px");
    expect(log.calls.filter((c) => c === "drawImage").length).toBeGreaterThanOrEqual(3);
    expect(log.calls).toContain("strokeRect");
    wrapper.unmount();
  });

  it("is a labelled, focusable group with an announced hint", () => {
    const { wrapper } = mountMap();
    const host = wrapper.get(".pm-host");
    expect(host.attributes("aria-label")).toBe("Map of overworld");
    expect(host.attributes("tabindex")).toBe("0");
    expect(wrapper.get(".pm-hover").text().length).toBeGreaterThan(0);
    wrapper.unmount();
  });

  it("emits a select rectangle for a drag with the select tool, and none for the pan tool", async () => {
    const { wrapper } = mountMap({ tool: "select" });
    const over = wrapper.get(".pm-over");
    const el = over.element as HTMLCanvasElement;
    el.setPointerCapture = vi.fn();
    const at = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, clientX: x, clientY: y, button: 0, altKey: false, ...extra });
    el.dispatchEvent(at("pointerdown", 100, 100));
    el.dispatchEvent(at("pointermove", 200, 160));
    el.dispatchEvent(at("pointerup", 200, 160));
    const emitted = wrapper.emitted("select");
    expect(emitted).toHaveLength(1);
    const rect = emitted![0]![0] as { mode: string; x1: number; z1: number; x2: number; z2: number };
    expect(rect.mode).toBe("add");
    expect(rect.x2).toBeGreaterThanOrEqual(rect.x1);
    expect(rect.z2).toBeGreaterThanOrEqual(rect.z1);

    await wrapper.setProps({ tool: "pan" });
    el.dispatchEvent(at("pointerdown", 100, 100));
    el.dispatchEvent(at("pointermove", 200, 160));
    el.dispatchEvent(at("pointerup", 200, 160));
    expect(wrapper.emitted("select")).toHaveLength(1);
    wrapper.unmount();
  });

  it("holding Alt with the select tool unselects", () => {
    const { wrapper } = mountMap({ tool: "select" });
    const el = wrapper.get(".pm-over").element as HTMLCanvasElement;
    el.setPointerCapture = vi.fn();
    const at = (type: string, extra: Record<string, unknown> = {}) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, clientX: 120, clientY: 120, button: 0, altKey: false, ...extra });
    el.dispatchEvent(at("pointerdown", { altKey: true }));
    el.dispatchEvent(at("pointerup"));
    expect((wrapper.emitted("select")![0]![0] as { mode: string }).mode).toBe("remove");
    wrapper.unmount();
  });

  it("emits a zone for a drag with the protect tool", () => {
    const { wrapper } = mountMap({ tool: "zone" });
    const el = wrapper.get(".pm-over").element as HTMLCanvasElement;
    el.setPointerCapture = vi.fn();
    const at = (type: string, x: number, y: number) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, clientX: x, clientY: y, button: 0, altKey: false });
    el.dispatchEvent(at("pointerdown", 50, 50));
    el.dispatchEvent(at("pointerup", 150, 120));
    expect(wrapper.emitted("zone")).toHaveLength(1);
    wrapper.unmount();
  });

  it("asks for undo and redo with the keyboard", async () => {
    const { wrapper } = mountMap();
    await wrapper.get(".pm-host").trigger("keydown", { key: "z", ctrlKey: true });
    await wrapper.get(".pm-host").trigger("keydown", { key: "y", ctrlKey: true });
    await wrapper.get(".pm-host").trigger("keydown", { key: "Z", ctrlKey: true, shiftKey: true });
    expect(wrapper.emitted("undo")).toHaveLength(1);
    expect(wrapper.emitted("redo")).toHaveLength(2);
    wrapper.unmount();
  });

  it("reports the camera, and keys change it", async () => {
    const { wrapper } = mountMap();
    await nextTick();
    const before = wrapper.emitted("camera")!.at(-1)![0] as { zoom: number };
    await wrapper.get(".pm-host").trigger("keydown", { key: "+" });
    const after = wrapper.emitted("camera")!.at(-1)![0] as { zoom: number };
    expect(after.zoom).toBeGreaterThan(before.zoom);
    await wrapper.get(".pm-host").trigger("keydown", { key: "0" });
    expect((wrapper.emitted("camera")!.at(-1)![0] as { zoom: number }).zoom).toBeCloseTo(before.zoom, 5);
    wrapper.unmount();
  });

  it("redraws the selection when its version changes", async () => {
    const { wrapper, selection, log } = mountMap();
    await nextTick();
    selection.apply([{ dimension: "overworld", mode: "add", x1: 0, z1: 0, x2: 5, z2: 5 }]);
    const before = log.calls.filter((c) => c === "putImageData").length;
    await wrapper.setProps({ selectionVersion: 1 });
    expect(log.calls.filter((c) => c === "putImageData").length).toBeGreaterThan(before);
    wrapper.unmount();
  });
});

describe("PruneMap inspect tool", () => {
  it("a click inspects the chunk under it, and a drag moves the view instead", () => {
    const { wrapper } = mountMap({ tool: "inspect" });
    const el = wrapper.get(".pm-over").element as HTMLCanvasElement;
    el.setPointerCapture = vi.fn();
    const at = (type: string, x: number, y: number) =>
      Object.assign(new Event(type, { bubbles: true }), { pointerId: 1, clientX: x, clientY: y, button: 0, altKey: false });
    el.dispatchEvent(at("pointerdown", 300, 200));
    el.dispatchEvent(at("pointerup", 301, 201));
    expect(wrapper.emitted("inspect")).toHaveLength(1);
    expect(wrapper.emitted("inspect")![0]![0]).toMatchObject({ cx: expect.any(Number), cz: expect.any(Number) });

    el.dispatchEvent(at("pointerdown", 300, 200));
    el.dispatchEvent(at("pointermove", 340, 230));
    el.dispatchEvent(at("pointerup", 340, 230));
    expect(wrapper.emitted("inspect")).toHaveLength(1);
    wrapper.unmount();
  });
});

describe("PruneMap terrain view", () => {
  const tile = () => ({ width: 512, height: 512, close: vi.fn() }) as unknown as ImageBitmap;

  it("asks for the pictures of the regions in view, middle first, and draws them under the classes", async () => {
    const loader = vi.fn(async (_rx: number, _rz: number) => tile());
    const { wrapper, log } = mountMap({ view: "terrain", tileLoader: loader });
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(loader).toHaveBeenCalled();
    const asked = loader.mock.calls.map(([rx, rz]) => `${rx},${rz}`).sort();
    expect(asked).toEqual(["-1,0", "0,-1", "0,0"]);
    // Three tiles and three class bitmaps went onto the canvas.
    const draws = log.calls.filter((c) => c === "drawImage").length;
    expect(draws).toBeGreaterThanOrEqual(6);
    wrapper.unmount();
  });

  it("asks for nothing in the other views, and once zoomed far out", async () => {
    const loader = vi.fn(async () => tile());
    const { wrapper } = mountMap({ view: "class", tileLoader: loader });
    await nextTick();
    expect(loader).not.toHaveBeenCalled();
    await wrapper.setProps({ view: "terrain" });
    await new Promise((r) => setTimeout(r, 0));
    expect(loader).toHaveBeenCalled();
    loader.mockClear();
    for (let i = 0; i < 12; i++) await wrapper.get(".pm-host").trigger("keydown", { key: "-" });
    await new Promise((r) => setTimeout(r, 0));
    const zoomOut = wrapper.emitted("camera")!.at(-1)![0] as { zoom: number };
    expect(zoomOut.zoom).toBeLessThan(2.5);
    expect(loader).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("with the colours hidden, draws only the pictures, and brings the colours back", async () => {
    const loader = vi.fn(async (_rx: number, _rz: number) => tile());
    const { wrapper, log } = mountMap({ view: "terrain", tileLoader: loader });
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    const draws = () => log.calls.filter((c) => c === "drawImage").length;

    log.calls.length = 0;
    await wrapper.setProps({ showOverlay: false });
    expect(draws()).toBe(3);

    log.calls.length = 0;
    await wrapper.setProps({ showOverlay: true });
    expect(draws()).toBe(6);
    wrapper.unmount();
  });

  it("keeps the colours of a region without a picture when they are hidden", async () => {
    const loader = vi.fn(async (rx: number, _rz: number) => (rx === 0 ? tile() : null));
    const { wrapper, log } = mountMap({ view: "terrain", tileLoader: loader });
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    log.calls.length = 0;
    await wrapper.setProps({ showOverlay: false });
    // Two pictures (0,0 and 0,-1) and the classes of -1,0, which has none.
    expect(log.calls.filter((c) => c === "drawImage").length).toBe(3);
    wrapper.unmount();
  });

  it("treats a region without a picture as plain classes and does not ask again", async () => {
    const loader = vi.fn(async () => null);
    const { wrapper } = mountMap({ view: "terrain", tileLoader: loader });
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    const first = loader.mock.calls.length;
    await wrapper.get(".pm-host").trigger("keydown", { key: "+" });
    await new Promise((r) => setTimeout(r, 0));
    expect(loader.mock.calls.length).toBe(first);
    wrapper.unmount();
  });
});

describe("PruneMap keyboard cursor", () => {
  const key = (wrapper: ReturnType<typeof mountMap>["wrapper"], k: string, extra: Record<string, unknown> = {}) =>
    wrapper.get(".pm-host").trigger("keydown", { key: k, ...extra });

  it("arrows move a cursor chunk by chunk, Shift jumps eight, and the hover text follows", async () => {
    const { wrapper } = mountMap();
    await nextTick();
    await key(wrapper, "ArrowRight");
    const first = wrapper.get(".pm-hover").text();
    expect(first).toMatch(/Chunk -?\d+, -?\d+/);
    const at = (text: string) => text.match(/Chunk (-?\d+), (-?\d+)/)!.slice(1).map(Number) as [number, number];
    const [x0, z0] = at(first);
    await key(wrapper, "ArrowRight");
    expect(at(wrapper.get(".pm-hover").text())).toEqual([x0 + 1, z0]);
    await key(wrapper, "ArrowDown", { shiftKey: true });
    expect(at(wrapper.get(".pm-hover").text())).toEqual([x0 + 1, z0 + 8]);
    expect(wrapper.get(".pm-hover").attributes("aria-live")).toBe("polite");
    wrapper.unmount();
  });

  it("Space chooses the chunk under the cursor and chooses it again to unchoose, Enter inspects it", async () => {
    const { wrapper, selection } = mountMap({ tool: "select" });
    await nextTick();
    await key(wrapper, "ArrowRight");
    await key(wrapper, " ");
    const add = wrapper.emitted("select")!.at(-1)![0] as { mode: string; x1: number; z1: number; x2: number; z2: number };
    expect(add.mode).toBe("add");
    expect([add.x1, add.z1]).toEqual([add.x2, add.z2]);
    selection.apply([{ dimension: "overworld", mode: "add", x1: add.x1, z1: add.z1, x2: add.x1, z2: add.z1 }]);
    await key(wrapper, " ");
    expect((wrapper.emitted("select")!.at(-1)![0] as { mode: string }).mode).toBe("remove");
    await key(wrapper, "Enter");
    expect(wrapper.emitted("inspect")![0]![0]).toEqual({ cx: add.x1, cz: add.z1 });
    wrapper.unmount();
  });

  it("keeps the cursor on screen, and Escape drops it", async () => {
    const { wrapper } = mountMap();
    await nextTick();
    const before = wrapper.emitted("camera")!.at(-1)![0] as { cx: number };
    for (let i = 0; i < 80; i++) await key(wrapper, "ArrowRight", { shiftKey: true });
    const after = wrapper.emitted("camera")!.at(-1)![0] as { cx: number };
    expect(after.cx).toBeGreaterThan(before.cx + 100);
    await key(wrapper, "Escape");
    expect(wrapper.get(".pm-hover").attributes("aria-live")).toBe("off");
    wrapper.unmount();
  });

  it("Enter does nothing without a cursor, and Space without one is only the pan modifier", async () => {
    const { wrapper } = mountMap();
    await nextTick();
    await key(wrapper, "Enter");
    await key(wrapper, " ");
    expect(wrapper.emitted("inspect")).toBeUndefined();
    expect(wrapper.emitted("select")).toBeUndefined();
    wrapper.unmount();
  });
});

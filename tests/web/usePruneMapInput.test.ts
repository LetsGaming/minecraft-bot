import { describe, it, expect, vi } from "vitest";
import { shallowRef } from "vue";
import { usePruneMapInput, type MapTool } from "../../src/web/frontend/src/composables/usePruneMapInput.js";
import { SelectionModel } from "../../src/web/frontend/src/composables/pruneSelection.js";
import type { Camera } from "../../src/web/frontend/src/composables/pruneCamera.js";

/** A view 320 by 320 px at 10 px per chunk, centred on chunk (0, 0): chunk (cx, cz) is at (160 + 10cx, 160 + 10cz). */
function setup(tool: MapTool = "select") {
  const camera = shallowRef<Camera>({ cx: 0, cz: 0, zoom: 10 });
  const size = { width: 320, height: 320 };
  const events = {
    onZone: vi.fn(),
    onSelect: vi.fn(),
    onInspect: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const requestDraw = vi.fn();
  const selection = new SelectionModel(() => [{ rx: 0, rz: 0 }]);
  const input = usePruneMapInput({
    camera,
    size,
    tool: () => tool,
    dimension: () => "overworld",
    selection: () => selection,
    canvas: () => canvas,
    host: () => null,
    lookup: () => ({ cell: 0, heat: 0 }),
    requestDraw,
    fit: vi.fn(),
    zoomBy: vi.fn(),
    ...events,
  });
  return { input, camera, events, requestDraw, selection };
}

const pointer = (x: number, y: number, extra: Partial<PointerEvent> = {}): PointerEvent =>
  ({ pointerId: 1, clientX: x, clientY: y, button: 0, altKey: false, ...extra }) as PointerEvent;

const key = (k: string, extra: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...extra }) as unknown as KeyboardEvent;

describe("usePruneMapInput", () => {
  it("dragging with the select tool reports a normalised add rectangle", () => {
    const { input, events } = setup("select");
    input.onDown(pointer(190, 190)); // chunk (3, 3)
    input.onMove(pointer(160, 160)); // chunk (0, 0)
    expect(input.dragRect()).toMatchObject({ mode: "add" });
    input.onUp(pointer(160, 160));
    expect(events.onSelect).toHaveBeenCalledWith({ mode: "add", x1: 0, z1: 0, x2: 3, z2: 3 });
    expect(input.dragRect()).toBeNull();
  });

  it("alt turns a drag into a removal and the zone tool reports a zone", () => {
    const a = setup("select");
    a.input.onDown(pointer(160, 160, { altKey: true }));
    a.input.onUp(pointer(160, 160));
    expect(a.events.onSelect).toHaveBeenCalledWith(expect.objectContaining({ mode: "remove" }));

    const b = setup("zone");
    b.input.onDown(pointer(160, 160));
    b.input.onMove(pointer(170, 170));
    b.input.onUp(pointer(170, 170));
    expect(b.events.onZone).toHaveBeenCalledWith({ x1: 0, z1: 0, x2: 1, z2: 1 });
    expect(b.events.onSelect).not.toHaveBeenCalled();
  });

  it("a click with the inspect tool inspects, a drag pans instead", () => {
    const click = setup("inspect");
    click.input.onDown(pointer(165, 165));
    click.input.onUp(pointer(165, 165));
    expect(click.events.onInspect).toHaveBeenCalledWith({ cx: 0, cz: 0 });

    const drag = setup("inspect");
    drag.input.onDown(pointer(165, 165));
    drag.input.onMove(pointer(205, 165));
    drag.input.onUp(pointer(205, 165));
    expect(drag.events.onInspect).not.toHaveBeenCalled();
    expect(drag.camera.value.cx).toBeCloseTo(-4);
  });

  it("arrow keys move a keyboard cursor and space toggles the chunk under it", () => {
    const { input, events } = setup();
    input.onKey(key("ArrowRight"));
    input.onKey(key("ArrowDown", { shiftKey: true }));
    expect(input.cursor.value).toEqual({ cx: 1, cz: 8 });
    input.onKey(key(" "));
    expect(events.onSelect).toHaveBeenCalledWith({ mode: "add", x1: 1, z1: 8, x2: 1, z2: 8 });
    input.onKey(key("Escape"));
    expect(input.cursor.value).toBeNull();
  });

  it("control z and control y ask for undo and redo", () => {
    const { input, events } = setup();
    input.onKey(key("z", { ctrlKey: true }));
    input.onKey(key("z", { ctrlKey: true, shiftKey: true }));
    input.onKey(key("y", { ctrlKey: true }));
    expect(events.onUndo).toHaveBeenCalledTimes(1);
    expect(events.onRedo).toHaveBeenCalledTimes(2);
  });

  it("the cursor class follows the tool and an active pan", () => {
    const { input } = setup("pan");
    expect(input.cursorClass.value).toMatchObject({ "is-pan": true, "is-grabbing": false });
    input.onDown(pointer(100, 100));
    expect(input.cursorClass.value["is-grabbing"]).toBe(true);
    input.onUp(pointer(100, 100));
    expect(input.cursorClass.value["is-grabbing"]).toBe(false);
  });
});

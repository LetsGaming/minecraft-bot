import { describe, it, expect, vi } from "vitest";

import { createTileStore, type TileImage } from "../../src/web/frontend/src/composables/pruneTiles.js";

const image = (name: string): TileImage & { name: string; close: () => void } => ({ name, width: 512, height: 512, close: vi.fn() });

/** A loader whose requests the test finishes by hand. */
function manual() {
  const pending: Array<{ rx: number; rz: number; resolve: (v: ReturnType<typeof image> | null) => void; reject: (e: Error) => void }> = [];
  const load = (rx: number, rz: number) =>
    new Promise<ReturnType<typeof image> | null>((resolve, reject) => {
      pending.push({ rx, rz, resolve, reject });
    });
  return { load, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const at = (rx: number, rz: number, priority = 0) => ({ rx, rz, priority });

describe("createTileStore", () => {
  it("fetches nearest the middle first, a few at a time, and starts the next as one finishes", async () => {
    const { load, pending } = manual();
    const store = createTileStore({ load, onChange: () => undefined, concurrency: 2 });
    store.want([at(5, 5, 9), at(0, 0, 0), at(1, 0, 1), at(2, 0, 2)]);
    expect(pending.map((p) => [p.rx, p.rz])).toEqual([[0, 0], [1, 0]]);
    pending[0]!.resolve(image("a"));
    await flush();
    expect(pending.map((p) => [p.rx, p.rz])).toEqual([[0, 0], [1, 0], [2, 0]]);
  });

  it("answers null until a tile arrives, then the image, and 'none' for a region without one", async () => {
    const { load, pending } = manual();
    const onChange = vi.fn();
    const store = createTileStore({ load, onChange });
    store.want([at(0, 0), at(1, 0)]);
    expect(store.get(0, 0)).toBeNull();
    const a = image("a");
    pending[0]!.resolve(a);
    pending[1]!.resolve(null);
    await flush();
    expect(store.get(0, 0)).toBe(a);
    expect(store.get(1, 0)).toBe("none");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does not ask twice for a region it has, is loading, or has given up on", async () => {
    const load = vi.fn(async () => image("x"));
    const store = createTileStore({ load, onChange: () => undefined });
    store.want([at(0, 0)]);
    store.want([at(0, 0)]);
    await flush();
    store.want([at(0, 0)]);
    expect(load).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => {
      throw new Error("502");
    });
    const onError = vi.fn();
    const broken = createTileStore({ load: failing, onChange: () => undefined, onError, retryDelaysMs: [] });
    broken.want([at(3, 3)]);
    await flush();
    broken.want([at(3, 3)]);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(3, 3, expect.any(Error));
    expect(broken.get(3, 3)).toBe("none");
  });

  it("retries a failed fetch after a wait, and gives up only after the last retry", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const flaky = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error("504 from the proxy");
        return image("late");
      });
      const onChange = vi.fn();
      const onError = vi.fn();
      const store = createTileStore({ load: flaky, onChange, onError, retryDelaysMs: [100, 200] });
      // The map asks again on every redraw; onChange is what triggers one.
      const redraw = () => store.want([at(0, 0)]);
      redraw();
      await vi.advanceTimersByTimeAsync(0);
      expect(store.get(0, 0)).toBeNull(); // failed once, not given up
      redraw(); // too early: still waiting out the first delay
      expect(flaky).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(onChange).toHaveBeenCalled();
      redraw();
      await vi.advanceTimersByTimeAsync(0);
      expect(flaky).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(200);
      redraw();
      await vi.advanceTimersByTimeAsync(0);
      expect(flaky).toHaveBeenCalledTimes(3);
      expect((store.get(0, 0) as { name: string }).name).toBe("late");
      expect(onError).not.toHaveBeenCalled();

      const dead = vi.fn(async () => {
        throw new Error("down");
      });
      const gone = createTileStore({ load: dead, onChange: () => undefined, onError, retryDelaysMs: [50] });
      gone.want([at(1, 1)]);
      await vi.advanceTimersByTimeAsync(50);
      gone.want([at(1, 1)]);
      await vi.advanceTimersByTimeAsync(0);
      expect(dead).toHaveBeenCalledTimes(2);
      expect(gone.get(1, 1)).toBe("none");
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops regions that are no longer wanted before they start", async () => {
    const { load, pending } = manual();
    const store = createTileStore({ load, onChange: () => undefined, concurrency: 1 });
    store.want([at(0, 0, 0), at(1, 0, 1), at(2, 0, 2)]);
    store.want([at(2, 0, 0)]);
    pending[0]!.resolve(image("a"));
    await flush();
    expect(pending.map((p) => [p.rx, p.rz])).toEqual([[0, 0], [2, 0]]);
  });

  it("reset forgets everything, closes what it held, and ignores arrivals from before", async () => {
    const { load, pending } = manual();
    const onChange = vi.fn();
    const store = createTileStore({ load, onChange });
    store.want([at(0, 0), at(1, 0)]);
    const held = image("held");
    pending[0]!.resolve(held);
    await flush();
    const late = image("late");
    store.reset();
    expect(held.close).toHaveBeenCalled();
    pending[1]!.resolve(late);
    await flush();
    expect(late.close).toHaveBeenCalled();
    expect(store.get(0, 0)).toBeNull();
    expect(store.get(1, 0)).toBeNull();
  });

  it("releases the tiles furthest from what is wanted once it holds too many", async () => {
    const images = new Map<string, ReturnType<typeof image>>();
    const load = async (rx: number, rz: number) => {
      const i = image(`${rx},${rz}`);
      images.set(`${rx},${rz}`, i);
      return i;
    };
    const store = createTileStore({ load, onChange: () => undefined, maxTiles: 3, concurrency: 8 });
    store.want([0, 1, 2, 3].map((n) => at(n, 0, n)));
    await flush();
    store.want([at(3, 0), at(4, 0, 1)]);
    await flush();
    expect(store.get(3, 0)).not.toBeNull();
    expect([0, 1, 2].filter((n) => store.get(n, 0) === null).length).toBeGreaterThan(0);
    const released = [...images.values()].filter((i) => (i.close as ReturnType<typeof vi.fn>).mock.calls.length > 0);
    expect(released.length).toBeGreaterThan(0);
  });
});

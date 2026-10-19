import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { effectScope } from "vue";
import { usePolling } from "../../src/web/frontend/src/composables/usePolling.js";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("runs on every interval and immediately when asked", async () => {
    const fn = vi.fn(async () => undefined);
    const polling = usePolling(fn, 1000, { immediate: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(3);
    polling.stop();
  });

  it("skips ticks while one is still in flight", async () => {
    let release!: () => void;
    const fn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const polling = usePolling(fn, 1000);
    await vi.advanceTimersByTimeAsync(3500);
    expect(fn).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    polling.stop();
  });

  it("stops when the owning scope is disposed, even before the first run finishes", async () => {
    const fn = vi.fn(async () => undefined);
    const scope = effectScope();
    scope.run(() => usePolling(fn, 1000));
    scope.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps ticking after a failed run", async () => {
    const fn = vi.fn(async () => {
      throw new Error("down");
    });
    const polling = usePolling(fn, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(2);
    polling.stop();
  });
});

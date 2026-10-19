import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { startPoller } from "../../src/bot/logWatcher/watchers/poller.js";
import { log } from "../../src/core/utils/logger.js";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("startPoller", () => {
  it("ticks after the interval and re-arms", async () => {
    const fn = vi.fn();
    const poller = startPoller("t", fn, 100);
    await vi.advanceTimersByTimeAsync(99);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it("honours a separate initial delay", async () => {
    const fn = vi.fn();
    const poller = startPoller("t", fn, 1_000, { initialDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("never overlaps ticks, even when one outlasts the interval", async () => {
    let running = 0;
    let maxRunning = 0;
    const fn = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 250));
      running--;
    });
    const poller = startPoller("t", fn, 100);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(maxRunning).toBe(1);
    expect(fn.mock.calls.length).toBeGreaterThan(1);
    poller.stop();
  });

  it("logs a throwing or rejecting tick and keeps going", async () => {
    const fn = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("sync boom");
      })
      .mockRejectedValueOnce(new Error("async boom"))
      .mockResolvedValue(undefined);
    const poller = startPoller("t", fn, 100);
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(vi.mocked(log.error)).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it("reads a dynamic interval before every tick and survives a throwing reader", async () => {
    let interval = 100;
    let broken = false;
    const fn = vi.fn();
    const poller = startPoller("t", fn, () => {
      if (broken) throw new Error("config gone");
      return interval;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);

    interval = 50;
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    broken = true;
    await vi.advanceTimersByTimeAsync(200);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(4);
    poller.stop();
  });

  it("stops for good, including a tick that is in flight", async () => {
    const fn = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const poller = startPoller("t", fn, 100);
    await vi.advanceTimersByTimeAsync(120);
    poller.stop();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

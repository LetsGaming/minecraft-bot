import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  enqueueSend,
  flushSendQueues,
  runDetached,
} from "../../src/bot/logWatcher/watchers/sendQueue.js";
import { log } from "../../src/core/utils/logger.js";

beforeEach(() => vi.clearAllMocks());

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("enqueueSend", () => {
  it("keeps sends on one channel in order even when an earlier one is slow", async () => {
    const order: string[] = [];
    const slow = deferred();
    void enqueueSend("c1", async () => {
      await slow.promise;
      order.push("first");
    }, "first", "t");
    void enqueueSend("c1", async () => {
      order.push("second");
    }, "second", "t");

    await Promise.resolve();
    expect(order).toEqual([]);
    slow.resolve();
    await flushSendQueues();
    expect(order).toEqual(["first", "second"]);
  });

  it("does not make one channel wait for another", async () => {
    const order: string[] = [];
    const slow = deferred();
    void enqueueSend("slow", async () => {
      await slow.promise;
      order.push("slow");
    }, "slow", "t");
    await enqueueSend("fast", async () => {
      order.push("fast");
    }, "fast", "t");
    expect(order).toEqual(["fast"]);
    slow.resolve();
    await flushSendQueues();
    expect(order).toEqual(["fast", "slow"]);
  });

  it("logs a failed send and still runs the ones behind it", async () => {
    const ran = vi.fn();
    void enqueueSend("c1", () => Promise.reject(new Error("nope")), "Failed to send", "tag");
    await enqueueSend("c1", async () => ran(), "second", "tag");
    expect(ran).toHaveBeenCalledOnce();
    expect(vi.mocked(log.error)).toHaveBeenCalledWith("tag", expect.stringContaining("nope"));
  });

  it("warns once when a channel falls far behind", async () => {
    const gate = deferred();
    for (let i = 0; i < 26; i++) {
      void enqueueSend("busy", () => gate.promise, "send", "tag");
    }
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    gate.resolve();
    await flushSendQueues();
  });
});

describe("runDetached", () => {
  it("runs the work off the caller and logs a failure instead of throwing", async () => {
    const work = vi.fn().mockRejectedValue(new Error("tip failed"));
    const done = runDetached("deaths", "Follow-up failed", work);
    expect(work).not.toHaveBeenCalled();
    await expect(done).resolves.toBeUndefined();
    expect(work).toHaveBeenCalledOnce();
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith("deaths", expect.stringContaining("tip failed"));
  });

  it("is drained by flushSendQueues", async () => {
    const slow = deferred();
    const finished = vi.fn();
    void runDetached("t", "x", async () => {
      await slow.promise;
      finished();
    });
    slow.resolve();
    await flushSendQueues();
    expect(finished).toHaveBeenCalledOnce();
  });
});

/**
 * The two helpers that replaced repeated idioms: errMsg (107 copies of
 * the same catch-narrowing ternary) and scheduleAt (two schedulers with
 * their own setTimeout-overflow handling, only one of them correct).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { errMsg } from "../../src/core/utils/error.js";
import { scheduleAt, MAX_TIMEOUT_MS } from "../../src/core/utils/longTimer.js";

describe("errMsg", () => {
  it("takes the message off an Error", () => {
    expect(errMsg(new Error("boom"))).toBe("boom");
  });

  it("appends a cause, which fetch and node:sqlite hide the detail in", () => {
    const err = new Error("request failed", { cause: new Error("ECONNREFUSED") });
    expect(errMsg(err)).toBe("request failed (cause: ECONNREFUSED)");
  });

  it("unpacks an AggregateError instead of reporting the wrapper", () => {
    const err = new AggregateError(
      [new Error("v4 refused"), new Error("v6 refused")],
      "all attempts failed",
    );
    expect(errMsg(err)).toBe("all attempts failed: v4 refused; v6 refused");
  });

  it("passes strings through", () => {
    expect(errMsg("plain string throw")).toBe("plain string throw");
  });

  it("finds a message on a thrown object rather than [object Object]", () => {
    expect(errMsg({ message: "from an object" })).toBe("from an object");
  });

  it("falls back to JSON for an object with no message", () => {
    expect(errMsg({ code: 42 })).toBe('{"code":42}');
  });

  it("survives a circular object", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => errMsg(circular)).not.toThrow();
  });

  it("handles null and undefined", () => {
    expect(errMsg(null)).toBe("null");
    expect(errMsg(undefined)).toBe("undefined");
  });
});

describe("scheduleAt", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires at the deadline", async () => {
    const onDue = vi.fn();
    scheduleAt(Date.now() + 5_000, onDue);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(onDue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("does not fire early past the setTimeout ceiling", async () => {
    const onDue = vi.fn();
    scheduleAt(Date.now() + MAX_TIMEOUT_MS * 3, onDue);

    // A plain setTimeout would have overflowed and fired immediately here.
    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 1);
    expect(onDue).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS * 2 + 1);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("fires on the next tick when the deadline already passed", async () => {
    const onDue = vi.fn();
    scheduleAt(Date.now() - 60_000, onDue);

    await vi.advanceTimersByTimeAsync(0);
    expect(onDue).toHaveBeenCalledTimes(1);
  });

  it("cancel stops it, including mid-chunk on a long wait", async () => {
    const onDue = vi.fn();
    const timer = scheduleAt(Date.now() + MAX_TIMEOUT_MS * 2, onDue);

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 1);
    timer.cancel();

    await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS * 2);
    expect(onDue).not.toHaveBeenCalled();
  });

  it("cancel is idempotent", () => {
    const timer = scheduleAt(Date.now() + 1_000, vi.fn());
    expect(() => {
      timer.cancel();
      timer.cancel();
    }).not.toThrow();
  });
});

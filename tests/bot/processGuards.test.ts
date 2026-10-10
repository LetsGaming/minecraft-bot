import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { installProcessGuards } from "../../src/bot/processGuards.js";
import { log } from "../../src/core/utils/logger.js";

describe("installProcessGuards", () => {
  let before: { exc: NodeJS.UncaughtExceptionListener[]; rej: NodeJS.UnhandledRejectionListener[] };

  beforeEach(() => {
    vi.clearAllMocks();
    before = {
      exc: process.listeners("uncaughtException"),
      rej: process.listeners("unhandledRejection"),
    };
  });

  afterEach(() => {
    for (const l of process.listeners("uncaughtException")) {
      if (!before.exc.includes(l)) process.off("uncaughtException", l);
    }
    for (const l of process.listeners("unhandledRejection")) {
      if (!before.rej.includes(l)) process.off("unhandledRejection", l);
    }
  });

  function installed() {
    const flush = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    installProcessGuards(flush, exit);
    const add = <T extends (...a: never[]) => void>(list: T[], prior: T[]) =>
      list.find((l) => !prior.includes(l))!;
    return {
      flush,
      exit,
      exception: add(process.listeners("uncaughtException") as never[], before.exc as never[]) as (e: unknown) => void,
      rejection: add(process.listeners("unhandledRejection") as never[], before.rej as never[]) as (r: unknown) => void,
    };
  }

  it("logs an uncaught exception, flushes, and exits 1", async () => {
    const { exception, flush, exit } = installed();
    exception(new Error("boom"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(flush).toHaveBeenCalledOnce();
    expect(String(vi.mocked(log.error).mock.calls[0]![1])).toContain("boom");
  });

  it("handles an unhandled rejection with a non-Error reason", async () => {
    const { rejection, exit } = installed();
    rejection("plain reason");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(String(vi.mocked(log.error).mock.calls[0]![1])).toContain("plain reason");
  });

  it("neutralizes line breaks in the fault text", async () => {
    const { rejection, exit } = installed();
    rejection("line one\n[INFO] [forged] fake line");
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    const message = String(vi.mocked(log.error).mock.calls[0]![1]);
    expect(message).not.toContain("\n");
  });

  it("still exits when the flush fails, and only flushes once for repeated faults", async () => {
    const { exception, rejection, flush, exit } = installed();
    flush.mockRejectedValue(new Error("db closed"));
    exception(new Error("first"));
    rejection(new Error("second"));
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(flush).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});

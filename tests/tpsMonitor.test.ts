/**
 * tpsMonitor — interval callback branches (fake timers)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/core/config.js", () => ({
  loadConfig: vi
    .fn()
    .mockReturnValue({ tpsWarningThreshold: 15, tpsPollIntervalMs: 100 }),
}));
vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
}));

const TICK = 200;
import { startTpsMonitor } from "../src/bot/logWatcher/watchers/tpsMonitor.js";

function srv(id: string, tps: unknown) {
  return {
    id,
    supportsTps: true,
    getTps: vi.fn().mockResolvedValue(tps),
  } as never;
}
function client(send = vi.fn().mockResolvedValue(undefined)) {
  return { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as never;
}
function guild(srvId?: string) {
  return {
    g1: {
      tpsAlerts: { channelId: "ch1", ...(srvId ? { server: srvId } : {}) },
    },
  } as never;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("returns null when supportsTps is false", () => {
  expect(
    startTpsMonitor({ id: "s", supportsTps: false } as never, client(), {}),
  ).toBeNull();
});

it("sends a warning embed when TPS drops below threshold (Paper 3-value)", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const t = startTpsMonitor(
    srv("s1", { tps1m: 8, tps5m: 10, tps15m: 12 }),
    client(send),
    guild(),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  expect(send).toHaveBeenCalledTimes(1);
  clearInterval(t!);
});

it("includes 1m/5m/15m addFields for Paper TPS (has tps5m)", async () => {
  const { createEmbed } = await import("../src/bot/utils/embedUtils.js");
  const addFields = vi.fn().mockReturnThis();
  vi.mocked(createEmbed).mockReturnValue({
    addFields,
    setFooter: vi.fn().mockReturnThis(),
  } as never);
  const t = startTpsMonitor(
    srv("s2", { tps1m: 8, tps5m: 10, tps15m: 12 }),
    client(),
    guild(),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  expect(addFields).toHaveBeenCalledWith(
    expect.objectContaining({ name: "1 min" }),
    expect.anything(),
    expect.anything(),
  );
  clearInterval(t!);
});

it("includes TPS + MSPT addFields for vanilla format (no tps5m)", async () => {
  const { createEmbed } = await import("../src/bot/utils/embedUtils.js");
  const addFields = vi.fn().mockReturnThis();
  vi.mocked(createEmbed).mockReturnValue({
    addFields,
    setFooter: vi.fn().mockReturnThis(),
  } as never);
  const t = startTpsMonitor(
    srv("s3", { tps1m: 8, mspt: 125 }),
    client(),
    guild(),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  expect(addFields).toHaveBeenCalledWith(
    expect.objectContaining({ name: "TPS" }),
  );
  clearInterval(t!);
});

it("does NOT send a warning when TPS is above threshold", async () => {
  const send = vi.fn();
  const t = startTpsMonitor(srv("s4", { tps1m: 20 }), client(send), guild());
  await vi.advanceTimersByTimeAsync(TICK);
  expect(send).not.toHaveBeenCalled();
  clearInterval(t!);
});

it("respects the 5-minute cooldown — no duplicate alerts", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const t = startTpsMonitor(
    srv("s5", { tps1m: 5, tps5m: 6, tps15m: 7 }),
    client(send),
    guild(),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(send).toHaveBeenCalledTimes(1);
  clearInterval(t!);
});

it("skips guild when tpsAlert.server targets a different server", async () => {
  const send = vi.fn();
  const t = startTpsMonitor(
    srv("my-srv", { tps1m: 5 }),
    client(send),
    guild("other-srv"),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  expect(send).not.toHaveBeenCalled();
  clearInterval(t!);
});

it("does not crash when getTps() throws", async () => {
  const s = {
    id: "e",
    supportsTps: true,
    getTps: vi.fn().mockRejectedValue(new Error("RCON")),
  } as never;
  const t = startTpsMonitor(s, client(), guild());
  await vi.advanceTimersByTimeAsync(TICK);
  clearInterval(t!);
});

it("uses red color (0xff0000) for critically low TPS (< 10)", async () => {
  const { createEmbed } = await import("../src/bot/utils/embedUtils.js");
  vi.mocked(createEmbed).mockClear();
  const t = startTpsMonitor(
    srv("red", { tps1m: 5, tps5m: 6, tps15m: 7 }),
    client(),
    guild(),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  expect(vi.mocked(createEmbed)).toHaveBeenCalledWith(
    expect.objectContaining({ color: 0xff0000 }),
  );
  clearInterval(t!);
});

it("uses amber color (0xffaa00) for TPS between 10 and threshold", async () => {
  const { createEmbed } = await import("../src/bot/utils/embedUtils.js");
  vi.mocked(createEmbed).mockClear();
  const t = startTpsMonitor(
    srv("amber", { tps1m: 12, tps5m: 13, tps15m: 14 }),
    client(),
    guild(),
  );
  await vi.advanceTimersByTimeAsync(TICK);
  expect(vi.mocked(createEmbed)).toHaveBeenCalledWith(
    expect.objectContaining({ color: 0xffaa00 }),
  );
  clearInterval(t!);
});

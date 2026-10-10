/**
 * tpsMonitor — interval callback branches (fake timers)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi
    .fn()
    .mockReturnValue({ tpsWarningThreshold: 15, tpsPollIntervalMs: 100 }),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
}));

const TICK = 200;
import { startTpsMonitor } from "../../src/bot/logWatcher/watchers/monitors/tpsMonitor.js";

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

beforeEach(async () => {
  vi.useFakeTimers();
  const { loadConfig } = await import("../../src/core/config.js");
  vi.mocked(loadConfig).mockReset().mockReturnValue({
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 100,
  } as never);
  const { createEmbed } = await import("../../src/bot/utils/embeds/embedUtils.js");
  vi.mocked(createEmbed).mockReset().mockReturnValue({
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
  } as never);
});
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
  t!.stop();
});

it("includes 1m/5m/15m addFields for Paper TPS (has tps5m)", async () => {
  const { createEmbed } = await import("../../src/bot/utils/embeds/embedUtils.js");
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
  t!.stop();
});

it("includes TPS + MSPT addFields for vanilla format (no tps5m)", async () => {
  const { createEmbed } = await import("../../src/bot/utils/embeds/embedUtils.js");
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
  t!.stop();
});

it("does NOT send a warning when TPS is above threshold", async () => {
  const send = vi.fn();
  const t = startTpsMonitor(srv("s4", { tps1m: 20 }), client(send), guild());
  await vi.advanceTimersByTimeAsync(TICK);
  expect(send).not.toHaveBeenCalled();
  t!.stop();
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
  t!.stop();
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
  t!.stop();
});

it("does not crash when getTps() throws", async () => {
  const s = {
    id: "e",
    supportsTps: true,
    getTps: vi.fn().mockRejectedValue(new Error("RCON")),
  } as never;
  const t = startTpsMonitor(s, client(), guild());
  await vi.advanceTimersByTimeAsync(TICK);
  t!.stop();
});

it("uses red color (0xff0000) for critically low TPS (< 10)", async () => {
  const { createEmbed } = await import("../../src/bot/utils/embeds/embedUtils.js");
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
  t!.stop();
});

it("uses amber color (0xffaa00) for TPS between 10 and threshold", async () => {
  const { createEmbed } = await import("../../src/bot/utils/embeds/embedUtils.js");
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
  t!.stop();
});

describe("live config", () => {
  it("reads the threshold on every tick", async () => {
    const { loadConfig } = await import("../../src/core/config.js");
    const send = vi.fn().mockResolvedValue(undefined);
    vi.mocked(loadConfig).mockReturnValue({
      tpsWarningThreshold: 5,
      tpsPollIntervalMs: 100,
    } as never);
    const t = startTpsMonitor(srv("live1", { tps1m: 12 }), client(send), guild());
    await vi.advanceTimersByTimeAsync(100);
    expect(send).not.toHaveBeenCalled();

    vi.mocked(loadConfig).mockReturnValue({
      tpsWarningThreshold: 15,
      tpsPollIntervalMs: 100,
    } as never);
    await vi.advanceTimersByTimeAsync(100);
    expect(send).toHaveBeenCalledTimes(1);
    t!.stop();
  });

  it("reads the poll interval before arming each next tick", async () => {
    const { loadConfig } = await import("../../src/core/config.js");
    const server = srv("live2", { tps1m: 20 });
    vi.mocked(loadConfig).mockReturnValue({
      tpsWarningThreshold: 15,
      tpsPollIntervalMs: 100,
    } as never);
    const t = startTpsMonitor(server, client(), guild());
    await vi.advanceTimersByTimeAsync(100);
    expect(vi.mocked((server as { getTps: () => unknown }).getTps)).toHaveBeenCalledTimes(1);

    vi.mocked(loadConfig).mockReturnValue({
      tpsWarningThreshold: 15,
      tpsPollIntervalMs: 1000,
    } as never);
    await vi.advanceTimersByTimeAsync(100);
    const getTps = (server as { getTps: ReturnType<typeof vi.fn> }).getTps;
    expect(getTps).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(getTps).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(getTps).toHaveBeenCalledTimes(3);
    t!.stop();
  });

  it("stop() ends the polling", async () => {
    const server = srv("live3", { tps1m: 20 });
    const t = startTpsMonitor(server, client(), guild());
    t!.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect((server as { getTps: ReturnType<typeof vi.fn> }).getTps).not.toHaveBeenCalled();
  });
});

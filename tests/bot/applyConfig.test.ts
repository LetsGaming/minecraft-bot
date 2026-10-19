import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const cfg = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  reloadConfig: vi.fn(),
}));
vi.mock("../../src/core/config.js", () => cfg);

const heartbeat = vi.hoisted(() => ({
  reportApplied: vi.fn(),
  beginConfigApply: vi.fn(),
}));
vi.mock("../../src/core/utils/server/runtimeHeartbeat.js", () => ({
  beginConfigApply: heartbeat.beginConfigApply,
}));

const reconcile = vi.hoisted(() => ({ reconcileServers: vi.fn() }));
vi.mock("../../src/bot/logWatcher/initMinecraftCommands.js", () => reconcile);

const summarize = vi.hoisted(() => vi.fn());
vi.mock("../../src/core/utils/config/configDiff.js", () => ({
  summarizeConfigChanges: summarize,
}));

import { log } from "../../src/core/utils/logger.js";
import { applyConfig, markStartupConfigApplied } from "../../src/bot/utils/applyConfig.js";

const client = {} as never;
const startup = { servers: { a: {} } } as never;
const reloaded = { servers: { a: {}, b: {} } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  heartbeat.beginConfigApply.mockReturnValue(heartbeat.reportApplied);
  cfg.loadConfig.mockReturnValue(startup);
  cfg.reloadConfig.mockReturnValue(reloaded);
  summarize.mockReturnValue([]);
  reconcile.reconcileServers.mockResolvedValue({
    added: [],
    failed: [],
    removed: [],
    replaced: [],
    changed: [],
  });
  markStartupConfigApplied(startup);
  heartbeat.beginConfigApply.mockClear();
  heartbeat.reportApplied.mockClear();
});

describe("applyConfig", () => {
  it("reloads the file, reconciles, reports the revision and returns the full result", async () => {
    reconcile.reconcileServers.mockResolvedValue({
      added: ["b"],
      failed: [],
      removed: [],
      replaced: ["a"],
      changed: ["c"],
    });
    summarize.mockReturnValue(["guild g1: language en -> de"]);

    const result = await applyConfig(client);

    expect(cfg.reloadConfig).toHaveBeenCalledOnce();
    expect(summarize).toHaveBeenCalledWith(startup, reloaded);
    expect(reconcile.reconcileServers).toHaveBeenCalledWith(client, reloaded);
    expect(heartbeat.reportApplied).toHaveBeenCalledWith(["c"]);
    expect(result).toEqual({
      config: reloaded,
      settingChanges: ["guild g1: language en -> de"],
      added: ["b"],
      failed: [],
      removed: [],
      replaced: ["a"],
      changed: ["c"],
    });
  });

  it("takes the revision before reconciling", async () => {
    const order: string[] = [];
    heartbeat.beginConfigApply.mockImplementation(() => {
      order.push("begin");
      return heartbeat.reportApplied;
    });
    reconcile.reconcileServers.mockImplementation(async () => {
      order.push("reconcile");
      return { added: [], failed: [], removed: [], replaced: [], changed: [] };
    });
    await applyConfig(client);
    expect(order).toEqual(["begin", "reconcile"]);
  });

  it("uses the config the file watcher already reloaded and diffs against the last applied one", async () => {
    const watched = { servers: { x: {} } } as never;
    await applyConfig(client, watched);
    expect(cfg.reloadConfig).not.toHaveBeenCalled();
    expect(reconcile.reconcileServers).toHaveBeenCalledWith(client, watched);

    await applyConfig(client, reloaded);
    expect(summarize).toHaveBeenLastCalledWith(watched, reloaded);
  });

  it("logs each setting change and one summary line only when something changed", async () => {
    summarize.mockReturnValue(["one", "two"]);
    await applyConfig(client);
    expect(log.info).toHaveBeenCalledWith("config", "Reload: one");
    expect(log.info).toHaveBeenCalledWith("config", "Reload: two");
    expect(log.info).not.toHaveBeenCalledWith("config", expect.stringContaining("Reload applied"));

    reconcile.reconcileServers.mockResolvedValue({
      added: ["b"],
      failed: ["z"],
      removed: [],
      replaced: [],
      changed: [],
    });
    await applyConfig(client);
    expect(log.info).toHaveBeenCalledWith(
      "config",
      expect.stringMatching(/Reload applied, added: \[b\].*failed to start: \[z\]/),
    );
  });

  it("does not report the revision as applied when reconciling throws", async () => {
    reconcile.reconcileServers.mockRejectedValue(new Error("boom"));
    await expect(applyConfig(client)).rejects.toThrow("boom");
    expect(heartbeat.reportApplied).not.toHaveBeenCalled();
  });
});

describe("markStartupConfigApplied", () => {
  it("reports the startup revision as applied with nothing needing a restart", () => {
    markStartupConfigApplied(startup);
    expect(heartbeat.reportApplied).toHaveBeenCalledWith([]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const saved = vi.hoisted(() => ({ last: null as unknown, loaded: null as unknown }));
vi.mock("../../src/core/utils/jsonStore.js", () => ({
  saveJson: vi.fn(async (_p: string, v: unknown) => {
    saved.last = v;
  }),
  loadJson: vi.fn(async () => saved.loaded),
}));
vi.mock("../../src/core/config.js", () => ({
  getConfigPath: () => "unused",
  getLoadedConfigRevision: () => ({ hash: "loaded-hash", loadedAt: 1 }),
}));

import { computeConfigStatus } from "../../src/core/utils/config/configApplyStatus.js";
import {
  STALE_AFTER_MS,
  noteConfigApplied,
  beginConfigApply,
  startRuntimeHeartbeat,
  readRuntimeHeartbeat,
  type RuntimeHeartbeat,
} from "../../src/core/utils/server/runtimeHeartbeat.js";

const NOW = 1_000_000_000;
const rev = { hash: "h2", at: NOW - 5 };

function beat(overrides: Partial<RuntimeHeartbeat> = {}): RuntimeHeartbeat {
  return { at: NOW - 1000, startedAt: 0, pid: 1, version: "7", ...overrides };
}

describe("computeConfigStatus", () => {
  it("is applied when the bot reports the on-disk hash", () => {
    const s = computeConfigStatus(rev, beat({ config: { hash: "h2", appliedAt: NOW, restartRequired: [] } }), NOW);
    expect(s.state).toBe("applied");
    expect(s.botAlive).toBe(true);
  });

  it("is pending when the bot last applied an older file", () => {
    const s = computeConfigStatus(rev, beat({ config: { hash: "h1", appliedAt: NOW - 9, restartRequired: [] } }), NOW);
    expect(s.state).toBe("pending");
    expect(s.applied?.hash).toBe("h1");
  });

  it("reports restart-required for applied revisions with changed connections", () => {
    const s = computeConfigStatus(rev, beat({ config: { hash: "h2", appliedAt: NOW, restartRequired: ["smp"] } }), NOW);
    expect(s.state).toBe("restart-required");
    expect(s.restartRequired).toEqual(["smp"]);
  });

  it("lets a stale heartbeat override a matching report", () => {
    const s = computeConfigStatus(
      rev,
      beat({ at: NOW - STALE_AFTER_MS - 1, config: { hash: "h2", appliedAt: NOW, restartRequired: [] } }),
      NOW,
    );
    expect(s.state).toBe("bot-down");
  });

  it("is bot-down without any heartbeat", () => {
    expect(computeConfigStatus(rev, null, NOW).state).toBe("bot-down");
  });

  it("is unknown for a live bot that never reports a revision", () => {
    expect(computeConfigStatus(rev, beat(), NOW).state).toBe("unknown");
  });
});

describe("applied revision in the heartbeat", () => {
  beforeEach(() => {
    saved.last = null;
  });

  it("publishes immediately when the bot reports an applied config", () => {
    vi.useFakeTimers();
    startRuntimeHeartbeat("7");
    noteConfigApplied("abc", ["smp"]);
    expect((saved.last as RuntimeHeartbeat).config).toMatchObject({
      hash: "abc",
      restartRequired: ["smp"],
    });
    vi.useRealTimers();
  });

  it("captures the loaded hash before the reconcile runs", () => {
    vi.useFakeTimers();
    startRuntimeHeartbeat("7");
    saved.last = null;
    const done = beginConfigApply();
    done([]);
    expect((saved.last as RuntimeHeartbeat).config?.hash).toBe("loaded-hash");
    vi.useRealTimers();
  });

  it("round-trips the report and ignores a malformed one", async () => {
    saved.loaded = {
      at: 1,
      config: { hash: "x", appliedAt: 2, restartRequired: ["a"] },
    };
    expect((await readRuntimeHeartbeat())?.config?.hash).toBe("x");
    saved.loaded = { at: 1, config: { hash: 5 } };
    expect((await readRuntimeHeartbeat())?.config).toBeUndefined();
  });
});

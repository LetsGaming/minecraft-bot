import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────
vi.mock("../src/utils/utils.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordCheck,
  getUptimeStats,
  flushUptimeHistory,
  startUptimeFlushScheduler,
} from "../src/utils/uptimeTracker.js";
import { saveJson } from "../src/utils/utils.js";

// Each test uses a unique server ID to avoid module-level state pollution
let serverIdCounter = 0;
function nextServerId(): string {
  return `test-server-${++serverIdCounter}`;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getUptimeStats — empty history ─────────────────────────────────────────

describe("getUptimeStats — no history", () => {
  it("returns 'unknown' currentState when no checks exist", async () => {
    const stats = await getUptimeStats(nextServerId());
    expect(stats.currentState).toBe("unknown");
  });

  it("returns null percentages when no checks exist", async () => {
    const stats = await getUptimeStats(nextServerId());
    expect(stats.pct24h).toBeNull();
    expect(stats.pct7d).toBeNull();
    expect(stats.pct30d).toBeNull();
  });

  it("returns zero check counts when no checks exist", async () => {
    const stats = await getUptimeStats(nextServerId());
    expect(stats.checks24h.total).toBe(0);
    expect(stats.checks24h.online).toBe(0);
  });
});

// ── getUptimeStats — all online ────────────────────────────────────────────

describe("getUptimeStats — all checks online", () => {
  it("returns 100% uptime for 24h window", async () => {
    const sid = nextServerId();
    for (let i = 0; i < 5; i++) await recordCheck(sid, true);
    const stats = await getUptimeStats(sid);
    expect(stats.pct24h).toBe(100);
  });

  it("currentState is 'online'", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true);
    const stats = await getUptimeStats(sid);
    expect(stats.currentState).toBe("online");
  });

  it("currentStateDuration is positive", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true);
    const stats = await getUptimeStats(sid);
    expect(stats.currentStateDuration).toBeGreaterThanOrEqual(0);
  });
});

// ── getUptimeStats — all offline ───────────────────────────────────────────

describe("getUptimeStats — all checks offline", () => {
  it("returns 0% uptime for 24h window", async () => {
    const sid = nextServerId();
    for (let i = 0; i < 5; i++) await recordCheck(sid, false);
    const stats = await getUptimeStats(sid);
    expect(stats.pct24h).toBe(0);
  });

  it("currentState is 'offline'", async () => {
    const sid = nextServerId();
    await recordCheck(sid, false);
    const stats = await getUptimeStats(sid);
    expect(stats.currentState).toBe("offline");
  });
});

// ── getUptimeStats — mixed ─────────────────────────────────────────────────

describe("getUptimeStats — mixed online/offline", () => {
  it("returns 50% uptime when half are online", async () => {
    const sid = nextServerId();
    for (let i = 0; i < 5; i++) await recordCheck(sid, true);
    for (let i = 0; i < 5; i++) await recordCheck(sid, false);
    const stats = await getUptimeStats(sid);
    expect(stats.pct24h).toBe(50);
  });

  it("sets currentState based on the most recent check (online)", async () => {
    const sid = nextServerId();
    await recordCheck(sid, false);
    await recordCheck(sid, true); // last = online
    const stats = await getUptimeStats(sid);
    expect(stats.currentState).toBe("online");
  });

  it("sets currentState based on the most recent check (offline)", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true);
    await recordCheck(sid, false); // last = offline
    const stats = await getUptimeStats(sid);
    expect(stats.currentState).toBe("offline");
  });
});

// ── UptimeStats shape ──────────────────────────────────────────────────────

describe("getUptimeStats return shape", () => {
  it("returns all expected fields", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true);
    const stats = await getUptimeStats(sid);
    expect(stats).toHaveProperty("pct24h");
    expect(stats).toHaveProperty("pct7d");
    expect(stats).toHaveProperty("pct30d");
    expect(stats).toHaveProperty("checks24h");
    expect(stats).toHaveProperty("checks7d");
    expect(stats).toHaveProperty("checks30d");
    expect(stats).toHaveProperty("currentState");
    expect(stats).toHaveProperty("currentStateDuration");
  });

  it("check window objects have total and online fields", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true);
    const stats = await getUptimeStats(sid);
    expect(stats.checks24h).toHaveProperty("total");
    expect(stats.checks24h).toHaveProperty("online");
  });
});

// ── flushUptimeHistory ─────────────────────────────────────────────────────

describe("flushUptimeHistory", () => {
  it("calls saveJson when there are dirty changes", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true); // marks dirty
    await flushUptimeHistory();
    expect(saveJson).toHaveBeenCalled();
  });

  it("resolves without error", async () => {
    await expect(flushUptimeHistory()).resolves.toBeUndefined();
  });
});

// ── startUptimeFlushScheduler ─────────────────────────────────────────────

describe("startUptimeFlushScheduler", () => {
  it("returns a timer that can be cleared", () => {
    const timer = startUptimeFlushScheduler();
    expect(timer).toBeTruthy();
    clearInterval(timer);
  });
});

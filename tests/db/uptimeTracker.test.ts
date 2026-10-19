import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────
vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordCheck,
  getUptimeStats,
} from "../../src/core/utils/stores/uptimeTracker.js";
import { getDb } from "../../src/core/db/index.js";

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

// ── recordCheck persistence ────────────────────────────────────────────────

describe("recordCheck persistence", () => {
  it("persists immediately", async () => {
    const sid = nextServerId();
    await recordCheck(sid, true);
    const row = getDb()
      .prepare("SELECT COUNT(*) AS n FROM uptime_checks WHERE server_id = ?")
      .get(sid) as { n: number };
    expect(row.n).toBe(1);
  });
});

// ── getUptimeStats — custom range ──────────────────────────────────────────

describe("getUptimeStats — rangeHours", () => {
  const HOUR = 3_600_000;

  function insert(sid: string, ageHours: number, up: number): void {
    getDb()
      .prepare("INSERT INTO uptime_checks (server_id, t, up) VALUES (?, ?, ?)")
      .run(sid, Date.now() - ageHours * HOUR, up);
  }

  it("omits the range block when none is requested", async () => {
    const stats = await getUptimeStats(nextServerId());
    expect(stats.range).toBeUndefined();
  });

  it("counts only checks inside the requested window", async () => {
    const sid = nextServerId();
    insert(sid, 100, 0);
    insert(sid, 30, 0);
    insert(sid, 10, 1);
    insert(sid, 2, 1);
    const stats = await getUptimeStats(sid, { rangeHours: 12 });
    expect(stats.range).toEqual({
      rangeHours: 12,
      pct: 100,
      checks: { total: 2, online: 2 },
    });
    expect((await getUptimeStats(sid, { rangeHours: 48 })).range?.pct).toBe(
      66.67,
    );
  });

  it("returns null pct when the window holds no checks", async () => {
    const sid = nextServerId();
    insert(sid, 100, 1);
    const stats = await getUptimeStats(sid, { rangeHours: 6 });
    expect(stats.range).toEqual({
      rangeHours: 6,
      pct: null,
      checks: { total: 0, online: 0 },
    });
  });

  it("clamps the window to the 30 day retention", async () => {
    const stats = await getUptimeStats(nextServerId(), { rangeHours: 24 * 400 });
    expect(stats.range?.rangeHours).toBe(24 * 30);
  });

  it("keeps the fixed windows unchanged alongside the range", async () => {
    const sid = nextServerId();
    insert(sid, 2, 1);
    const stats = await getUptimeStats(sid, { rangeHours: 3 });
    expect(stats.pct24h).toBe(100);
    expect(stats.checks30d.total).toBe(1);
  });
});

// ── retention, windows and the current streak ──────────────────────────────

describe("recordCheck retention", () => {
  const DAY = 24 * 3_600_000;

  function insertAt(sid: string, t: number, up: number): void {
    getDb()
      .prepare("INSERT INTO uptime_checks (server_id, t, up) VALUES (?, ?, ?)")
      .run(sid, t, up);
  }
  const countFor = (sid: string): number =>
    (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM uptime_checks WHERE server_id = ?")
        .get(sid) as { n: number }
    ).n;

  it("deletes checks older than 30 days by timestamp and keeps the rest", async () => {
    const sid = nextServerId();
    const other = nextServerId();
    insertAt(sid, Date.now() - 31 * DAY, 1);
    insertAt(sid, Date.now() - 29 * DAY, 1);
    insertAt(other, Date.now() - 40 * DAY, 1);
    await recordCheck(sid, true);
    expect(countFor(sid)).toBe(2);
    expect(countFor(other)).toBe(1);
  });

  it("keeps every check inside the window regardless of how many there are", async () => {
    const sid = nextServerId();
    const base = Date.now() - 20 * DAY;
    getDb().exec("BEGIN");
    for (let n = 0; n < 5_000; n++) insertAt(sid, base + n * 1_000, 1);
    getDb().exec("COMMIT");
    await recordCheck(sid, true);
    expect(countFor(sid)).toBe(5_001);
  });
});

describe("getUptimeStats windows", () => {
  const HOUR = 3_600_000;
  function insert(sid: string, ageHours: number, up: number): void {
    getDb()
      .prepare("INSERT INTO uptime_checks (server_id, t, up) VALUES (?, ?, ?)")
      .run(sid, Date.now() - ageHours * HOUR, up);
  }

  it("splits checks into the 24 h, 7 d and 30 d windows", async () => {
    const sid = nextServerId();
    insert(sid, 2, 1); // all windows
    insert(sid, 48, 0); // 7 d and 30 d
    insert(sid, 24 * 10, 1); // 30 d only
    insert(sid, 24 * 40, 1); // outside every window
    const stats = await getUptimeStats(sid);
    expect(stats.checks24h).toEqual({ total: 1, online: 1 });
    expect(stats.checks7d).toEqual({ total: 2, online: 1 });
    expect(stats.checks30d).toEqual({ total: 3, online: 2 });
    expect(stats.pct7d).toBe(50);
  });

  it("measures the current state from the start of the current run", async () => {
    const sid = nextServerId();
    insert(sid, 10, 1);
    insert(sid, 8, 0);
    insert(sid, 6, 0);
    insert(sid, 1, 0);
    const offline = await getUptimeStats(sid);
    expect(offline.currentState).toBe("offline");
    expect(offline.currentStateDuration).toBeGreaterThanOrEqual(8 * HOUR);
    expect(offline.currentStateDuration).toBeLessThan(8 * HOUR + 60_000);

    const sid2 = nextServerId();
    insert(sid2, 10, 0);
    insert(sid2, 5, 1);
    insert(sid2, 3, 1);
    const online = await getUptimeStats(sid2);
    expect(online.currentState).toBe("online");
    expect(online.currentStateDuration).toBeGreaterThanOrEqual(5 * HOUR);
    expect(online.currentStateDuration).toBeLessThan(5 * HOUR + 60_000);
  });

  it("measures a history that never changed state from its first check", async () => {
    const sid = nextServerId();
    insert(sid, 30, 1);
    insert(sid, 2, 1);
    const stats = await getUptimeStats(sid);
    expect(stats.currentStateDuration).toBeGreaterThanOrEqual(30 * HOUR);
  });

  it("draws the sparkline from the last 24 hours only", async () => {
    const sid = nextServerId();
    insert(sid, 100, 0);
    insert(sid, 0.2, 1);
    const stats = await getUptimeStats(sid);
    expect(stats.sparkline24h).toHaveLength(24);
    expect(stats.sparkline24h.endsWith("█")).toBe(true);
    expect(stats.sparkline24h.slice(0, 23)).toBe("·".repeat(23));
  });
});

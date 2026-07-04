/**
 * downtimeMonitor — state machine tests.
 *
 * checkServer() is private but runs inside the setInterval set up by
 * startDowntimeMonitor().  We drive it with vi.useFakeTimers() +
 * vi.advanceTimersByTimeAsync().  Each test uses a unique server.id so the
 * module-level serverStates Map never leaks state between tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Scope helper: replicate the pure semantics (string eq, list
// membership, unset = unrestricted) without pulling in the config chain.
vi.mock("../src/utils/guildRouter.js", () => ({
  serverInScope: vi.fn(
    (scope: string | string[] | undefined, serverId: string) =>
      typeof scope === "string"
        ? scope === serverId
        : Array.isArray(scope)
          ? scope.includes(serverId)
          : true,
  ),
  getAllowedServerIds: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/utils/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockReturnValue({
    setDescription: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    addFields: vi.fn().mockReturnThis(),
  }),
}));

const TICK = 60_001; // just past the 60 000 ms check interval

import {
  startDowntimeMonitor,
  suppressAlerts,
} from "../src/logWatcher/watchers/downtimeMonitor.js";

// ── Helpers ────────────────────────────────────────────────────────────────

let _idSeq = 0;
const uid = () => `srv-${++_idSeq}`;

function fakeServer(id: string, online: boolean | Error) {
  return {
    id,
    isRunning: vi.fn().mockImplementation(async () => {
      if (online instanceof Error) throw online;
      return online;
    }),
  } as never;
}

function fakeClient(send = vi.fn().mockResolvedValue(undefined)) {
  return { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as never;
}

function guildsFor(serverId?: string) {
  return {
    g1: {
      downtimeAlerts: {
        channelId: "ch1",
        ...(serverId ? { server: serverId } : {}),
      },
    },
  } as never;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// ── suppressAlerts ─────────────────────────────────────────────────────────

describe("suppressAlerts()", () => {
  it("prevents an alert during the grace period", async () => {
    const id = uid();
    const send = vi.fn();
    const timer = startDowntimeMonitor(
      [fakeServer(id, false)],
      fakeClient(send),
      guildsFor(),
    );
    suppressAlerts(id); // <-- suppress before failures
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("resets the alerted flag so no duplicate alert fires after suppression", async () => {
    const id = uid();
    const send = vi.fn().mockResolvedValue(undefined);
    const server = fakeServer(id, false);
    const timer = startDowntimeMonitor([server], fakeClient(send), guildsFor());

    // First 3 ticks → initial downtime alert sent
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    // Suppress → next tick must NOT re-alert
    suppressAlerts(id);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1); // still 1
    clearInterval(timer);
  });
});

// ── online server ──────────────────────────────────────────────────────────

describe("startDowntimeMonitor — online server", () => {
  it("records each check via recordCheck", async () => {
    const { recordCheck } = await import("../src/utils/uptimeTracker.js");
    const id = uid();
    const timer = startDowntimeMonitor(
      [fakeServer(id, true)],
      fakeClient(),
      guildsFor(),
    );
    await vi.advanceTimersByTimeAsync(TICK);
    expect(vi.mocked(recordCheck)).toHaveBeenCalledWith(id, true);
    clearInterval(timer);
  });

  it("sends a recovery embed after the server comes back online", async () => {
    const id = uid();
    const send = vi.fn().mockResolvedValue(undefined);
    const srv = { id, isRunning: vi.fn().mockResolvedValue(false) } as never;
    const timer = startDowntimeMonitor([srv], fakeClient(send), guildsFor());

    // Three offline ticks → downtime alert
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    // Server recovers
    vi.mocked(srv.isRunning).mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(TICK);

    expect(send).toHaveBeenCalledTimes(2);
    clearInterval(timer);
  });
});

// ── offline server ─────────────────────────────────────────────────────────

describe("startDowntimeMonitor — offline server", () => {
  it("does NOT alert before 3 consecutive failures", async () => {
    const send = vi.fn();
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), false)],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 2; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("sends exactly one downtime alert on the 3rd consecutive failure", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), false)],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it("does NOT send duplicate alerts for a persistently offline server", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), false)],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1); // still just 1
    clearInterval(timer);
  });

  it("skips the alert when the guild monitors a different server", async () => {
    const id = uid();
    const send = vi.fn();
    const timer = startDowntimeMonitor(
      [fakeServer(id, false)],
      fakeClient(send),
      guildsFor("other-server"),
    );
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("handles isRunning() throwing without crashing the monitor", async () => {
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), new Error("RCON gone"))],
      fakeClient(),
      guildsFor(),
    );
    await vi.advanceTimersByTimeAsync(TICK); // must not throw
    clearInterval(timer);
  });
});

// ── no guilds configured ───────────────────────────────────────────────────

describe("startDowntimeMonitor — no downtime alert guilds", () => {
  it("still returns a timer and does not throw", async () => {
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), false)],
      fakeClient(),
      {},
    );
    await vi.advanceTimersByTimeAsync(TICK);
    expect(timer).toBeTruthy();
    clearInterval(timer);
  });
});

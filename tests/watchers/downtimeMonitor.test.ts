/**
 * downtimeMonitor — state machine tests.
 *
 * checkServer() is private but runs inside the setInterval set up by
 * startDowntimeMonitor().  We drive it with vi.useFakeTimers() +
 * vi.advanceTimersByTimeAsync().  Each test uses a unique server.id so the
 * module-level serverStates Map never leaks state between tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Scope helper: replicate the pure semantics (string eq, list
// membership, unset = unrestricted) without pulling in the config chain.
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
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

vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
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
} from "../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js";

// ── Helpers ────────────────────────────────────────────────────────────────

let _idSeq = 0;
const uid = () => `srv-${++_idSeq}`;

/**
 * A health value. `wrapper` is a second, independent axis — that separation is
 * the thing under test, so it has to be settable on its own.
 */
function health(state: string, wrapper = "up") {
  return {
    state,
    source: wrapper === "up" ? "wrapper" : state === "unknown" ? "none" : "ping",
    wrapper,
    processUp: state === "online" || state === "unresponsive",
    rcon: state === "online" && wrapper === "up" ? "responsive" : "unknown",
    probe: state === "offline" ? "none" : "socket",
    players:
      wrapper === "unreachable" && state === "online"
        ? { online: 4, max: 20, names: ["Alice"], sampled: true }
        : null,
    reason: wrapper === "unreachable" ? "ECONNREFUSED" : null,
    checkedAt: Date.now(),
  };
}

/** Wrapper down, but the server answered a direct ping with players on it. */
const PINGED_ONLINE = () => health("online", "unreachable");
/** Wrapper down AND the game port silent — the only true "we don't know". */
const NOTHING_ANSWERED = () => health("unknown", "unreachable");

/**
 * `online` is a boolean for the legacy cases (true → online, false →
 * offline), a state string for the new ones, or an Error to assert the
 * monitor survives a throwing probe.
 */
function fakeServer(
  id: string,
  online: boolean | string | Error | ReturnType<typeof health>,
) {
  return {
    id,
    getHealth: vi.fn().mockImplementation(async () => {
      if (online instanceof Error) throw online;
      if (typeof online === "string") return health(online);
      if (typeof online === "object") return online;
      return health(online ? "online" : "offline");
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
    const { recordCheck } = await import("../../src/core/utils/stores/uptimeTracker.js");
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
    const srv = { id, getHealth: vi.fn().mockResolvedValue(health("offline")) } as never;
    const timer = startDowntimeMonitor([srv], fakeClient(send), guildsFor());

    // Three offline ticks → downtime alert
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    // Server recovers
    vi.mocked(srv.getHealth).mockResolvedValue(health("online"));
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

  it("handles getHealth() throwing without crashing the monitor", async () => {
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), new Error("RCON gone"))],
      fakeClient(),
      guildsFor(),
    );
    await vi.advanceTimersByTimeAsync(TICK); // must not throw
    clearInterval(timer);
  });
});

// ── unreachable wrapper — the bug this monitor got wrong ───────────────────

describe("startDowntimeMonitor — the API wrapper is unreachable", () => {
  // The wrapper is a separate process on the server host. When it stops
  // answering, the Minecraft server is usually still up with players on it —
  // and since the bot now pings the server directly, it can say so.

  it("never reports the server down while a ping says it is online", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), PINGED_ONLINE())],
      fakeClient(send),
      guildsFor(),
    );
    // Past the server threshold (3) but short of the wrapper one (5).
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("records the server as UP — the ping established that", async () => {
    const { recordCheck } = await import("../../src/core/utils/stores/uptimeTracker.js");
    vi.mocked(recordCheck).mockClear();
    const id = uid();
    const timer = startDowntimeMonitor(
      [fakeServer(id, PINGED_ONLINE())],
      fakeClient(),
      guildsFor(),
    );
    await vi.advanceTimersByTimeAsync(TICK);
    // The old code recorded `false` here, quietly poisoning uptime every time
    // the wrapper was restarted. It is not even a gap now — we know it is up.
    expect(vi.mocked(recordCheck)).toHaveBeenCalledWith(id, true);
    clearInterval(timer);
  });

  it("still raises its own alert — controls are gone even though players are fine", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), PINGED_ONLINE())],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    // …and does not repeat it while the wrapper stays down.
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  });

  it("clears the wrapper alert as soon as the wrapper answers again", async () => {
    const id = uid();
    const send = vi.fn().mockResolvedValue(undefined);
    const srv = fakeServer(id, PINGED_ONLINE()) as unknown as {
      getHealth: ReturnType<typeof vi.fn>;
    };
    const timer = startDowntimeMonitor(
      [srv as never],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(1);

    srv.getHealth.mockResolvedValue(health("online"));
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).toHaveBeenCalledTimes(2); // recovery notice
    clearInterval(timer);
  });
});

describe("startDowntimeMonitor — nothing answered at all", () => {
  // Both channels failed. This is the only case where the bot genuinely
  // cannot say, and it should be rare.

  it("records no uptime sample — a missing sample beats a fabricated one", async () => {
    const { recordCheck } = await import("../../src/core/utils/stores/uptimeTracker.js");
    vi.mocked(recordCheck).mockClear();
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), NOTHING_ANSWERED())],
      fakeClient(),
      guildsFor(),
    );
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(vi.mocked(recordCheck)).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("never raises a server-down alert on an unknown state", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), NOTHING_ANSWERED())],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });
});

// ── unresponsive server — up, but not answering ────────────────────────────

describe("startDowntimeMonitor — the server is loaded but running", () => {
  it("does not alert: a lag spike is not an outage", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const timer = startDowntimeMonitor(
      [fakeServer(uid(), "unresponsive")],
      fakeClient(send),
      guildsFor(),
    );
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("records it as uptime — the process is up", async () => {
    const { recordCheck } = await import("../../src/core/utils/stores/uptimeTracker.js");
    const id = uid();
    const timer = startDowntimeMonitor(
      [fakeServer(id, "unresponsive")],
      fakeClient(),
      guildsFor(),
    );
    await vi.advanceTimersByTimeAsync(TICK);
    expect(vi.mocked(recordCheck)).toHaveBeenCalledWith(id, true);
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

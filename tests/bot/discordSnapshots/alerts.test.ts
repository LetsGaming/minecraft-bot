/**
 * Snapshots of the downtime alert after a crash and its recovery, rendered through the
 * real monitor and embed builders for an English and a German guild, with
 * the explicit `always` mention policy and the default `escalation` one.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { NOW, SNAPSHOT_CONFIG, fixturePath, renderMessage, stringify } from "./render.js";

vi.mock("../../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfig: () => SNAPSHOT_CONFIG,
}));
vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: vi.fn().mockReturnValue(true),
  getAllowedServerIds: vi.fn().mockReturnValue(null),
}));
vi.mock("../../../src/core/utils/stores/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/core/utils/stores/sessionStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateSessionStore: vi.fn((fn: (store: object) => unknown) => fn({})),
  closeAllOpenSessions: vi.fn().mockReturnValue(0),
}));
vi.mock("../../../src/bot/logWatcher/watchers/watchFirer.js", () => ({
  fireWatches: vi.fn(),
}));

import { startDowntimeMonitor } from "../../../src/bot/logWatcher/watchers/monitors/downtimeMonitor.js";

const TICK = 60_001;

afterEach(() => vi.useRealTimers());

function health(state: "online" | "offline") {
  return {
    state,
    source: "wrapper",
    wrapper: "up",
    processUp: state === "online",
    rcon: state === "online" ? "responsive" : "unknown",
    probe: state === "online" ? "socket" : "none",
    players: null,
    reason: null,
    checkedAt: Date.now(),
    restartCount: 0,
    unitFailed: false,
  };
}

describe("Discord snapshots: downtime alerts", () => {
  it("offline alert and recovery per guild language and mention policy", async () => {
    vi.useFakeTimers({ now: NOW });
    const sent: Record<string, Array<Record<string, unknown>>> = {};
    const channel = (id: string) => ({
      send: async (payload: unknown) => {
        (sent[id] ??= []).push(renderMessage("channel.send", payload));
      },
    });
    const client = {
      channels: { fetch: vi.fn(async (id: string) => channel(id)) },
    } as never;
    const guilds = {
      "g-en": {
        downtimeAlerts: {
          channelId: "en, always",
          mentionRole: "role-admins",
          mentionPolicy: "always",
        },
      },
      "g-de": { downtimeAlerts: { channelId: "de, escalation", mentionRole: "role-admins" } },
    } as never;
    const server = {
      id: "smp",
      getHealth: vi.fn().mockResolvedValue(health("online")),
      getList: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { playerCount: "3", maxPlayers: "20", players: [] } }),
    };

    const timer = startDowntimeMonitor([server as never], client, guilds);
    await vi.advanceTimersByTimeAsync(TICK);
    server.getHealth.mockResolvedValue(health("offline"));
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(TICK);
    server.getHealth.mockResolvedValue(health("online"));
    await vi.advanceTimersByTimeAsync(TICK);
    clearInterval(timer);

    await expect(stringify(sent)).toMatchFileSnapshot(fixturePath("downtime"));
  });
});

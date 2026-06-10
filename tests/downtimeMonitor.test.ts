/**
 * downtimeMonitor.test.ts
 * Covers suppressAlerts (exported) and startDowntimeMonitor via mock server + client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockReturnValue({ type: "base-embed" }),
}));

vi.mock("../src/utils/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

import {
  suppressAlerts,
  startDowntimeMonitor,
} from "../src/logWatcher/watchers/downtimeMonitor.js";
import type { ServerInstance } from "../src/utils/server.js";
import type { Client } from "discord.js";

function makeServer(id: string, isRunning = true) {
  return {
    id,
    isRunning: vi.fn().mockResolvedValue(isRunning),
  } as unknown as ServerInstance;
}

function makeClient(channel: { send: ReturnType<typeof vi.fn> }) {
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as unknown as Client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── suppressAlerts ─────────────────────────────────────────────────────────

describe("suppressAlerts", () => {
  it("runs without throwing for a new server ID", () => {
    expect(() => suppressAlerts("new-server-id")).not.toThrow();
  });

  it("accepts a custom grace period in ms", () => {
    expect(() => suppressAlerts("srv1", 30_000)).not.toThrow();
  });

  it("can be called multiple times for the same server", () => {
    suppressAlerts("multi-srv");
    suppressAlerts("multi-srv");
    expect(true).toBe(true); // no throw
  });
});

// ── startDowntimeMonitor ───────────────────────────────────────────────────

describe("startDowntimeMonitor", () => {
  it("returns a timer", () => {
    const timer = startDowntimeMonitor([], makeClient({ send: vi.fn() }), {});
    expect(timer).toBeTruthy();
    clearInterval(timer);
  });

  it("logs that no alert channels are configured when guilds are empty", async () => {
    const { log } = await import("../src/utils/logger.js");
    const timer = startDowntimeMonitor([], makeClient({ send: vi.fn() }), {});
    expect(vi.mocked(log.info)).toHaveBeenCalledWith(
      "downtime",
      expect.stringContaining("No downtime alert channels"),
    );
    clearInterval(timer);
  });

  it("returns a valid interval timer that can be cleared", () => {
    const timer = startDowntimeMonitor(
      [makeServer("server-a")],
      makeClient({ send: vi.fn() }),
      { guild1: { downtimeAlerts: { channelId: "ch1" } } },
    );
    expect(typeof timer).toBe("object");
    clearInterval(timer);
  });
});

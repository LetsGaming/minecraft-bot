/**
 * ServerInstance response parsing.
 *
 * Every method here asks the wrapper to run a console command and parses
 * the reply with a regex; a broken regex silently returns wrong data. The
 * tests control what the console "says" and assert on the parsed output.
 *
 * Before 5.0.0 this file mocked RconClient, because the class owned its own
 * connection and a sudo/screen fallback. Both are gone — the wrapper owns
 * RCON now — so the seam to mock is serverAccess. The TPS parsing that used
 * to live here moved with the connection: see tests/tps.test.ts in the
 * api-wrapper, including the Bug 1/2/4 regression guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sendCommand = vi.fn();
const getHealthFn = vi.fn();
const getListFn = vi.fn();
const getTpsFn = vi.fn();
const tailLog = vi.fn();
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  sendCommand: (...a: unknown[]) => sendCommand(...a),
  getHealth: (...a: unknown[]) => getHealthFn(...a),
  getList: (...a: unknown[]) => getListFn(...a),
  getTps: (...a: unknown[]) => getTpsFn(...a),
  tailLog: (...a: unknown[]) => tailLog(...a),
}));

import { ServerInstance } from "../../src/core/utils/server/server.js";
import type { ServerConfig } from "../../src/core/types/index.js";

const cfg: ServerConfig = {
  id: "survival",
  apiUrl: "http://127.0.0.1:3030",
  apiKey: "k",
};

let inst: ServerInstance;

beforeEach(() => {
  for (const m of [sendCommand, getHealthFn, getListFn, getTpsFn, tailLog]) {
    m.mockReset();
  }
  tailLog.mockResolvedValue("");
  inst = new ServerInstance(cfg);
});

describe("ServerInstance.getPlayerCoords()", () => {
  it("parses a Pos response into x/y/z numbers", async () => {
    sendCommand.mockResolvedValue(
      "Steve has the following entity data: [123.5d, 64.0d, -456.7d]",
    );
    const c = await inst.getPlayerCoords("Steve");
    expect(c?.x).toBeCloseTo(123.5);
    expect(c?.y).toBeCloseTo(64.0);
    expect(c?.z).toBeCloseTo(-456.7);
  });

  it("handles negative coordinates", async () => {
    sendCommand.mockResolvedValue("data: [-1000.0d, 100.0d, -2000.5d]");
    const c = await inst.getPlayerCoords("Alex");
    expect(c?.x).toBeCloseTo(-1000.0);
    expect(c?.z).toBeCloseTo(-2000.5);
  });

  it("returns null when the player is not found", async () => {
    sendCommand.mockResolvedValue("No entity was found");
    expect(await inst.getPlayerCoords("Ghost")).toBeNull();
  });

  it("falls back to the log when the wrapper has no reply channel", async () => {
    // A null reply means the wrapper reached the server over screen, which
    // has no response channel. The answer still lands in the log.
    sendCommand.mockResolvedValue(null);
    tailLog.mockResolvedValue("Steve has data: [1.0d, 2.0d, 3.0d]");
    const c = await inst.getPlayerCoords("Steve");
    expect(c).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("ServerInstance.getSeed()", () => {
  it("parses and caches the seed", async () => {
    sendCommand.mockResolvedValue("Seed: [-4172144997902289642]");
    expect(await inst.getSeed()).toBe("-4172144997902289642");

    // Cached: a second call must not ask the server again.
    sendCommand.mockReset();
    expect(await inst.getSeed()).toBe("-4172144997902289642");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("returns null when the response has no seed", async () => {
    sendCommand.mockResolvedValue("Unknown command");
    expect(await inst.getSeed()).toBeNull();
  });
});

describe("ServerInstance.isRunning()", () => {
  // isRunning() is now a view over getHealth(): "the process is up", rather
  // than the old "RCON answered inside three seconds". The distinction is the
  // whole point — see tests/server/serverHealth.test.ts for the full model.
  const health = (state: string) => ({
    state,
    processUp: state === "online" || state === "unresponsive",
    rcon: "responsive",
    probe: "socket",
    reason: null,
    checkedAt: Date.now(),
  });

  it("reports what the wrapper reports", async () => {
    getHealthFn.mockResolvedValue(health("online"));
    expect(await inst.isRunning()).toBe(true);
  });

  it("returns false without retrying when the server is simply down", async () => {
    // A wrapper that says "offline" has answered — retrying it would double
    // every downtime check for no new information.
    getHealthFn.mockResolvedValue(health("offline"));
    expect(await inst.isRunning()).toBe(false);
    expect(getHealthFn).toHaveBeenCalledTimes(1);
  });

  it("counts a loaded, unresponsive server as running", async () => {
    getHealthFn.mockResolvedValue(health("unresponsive"));
    expect(await inst.isRunning()).toBe(true);
    expect(getHealthFn).toHaveBeenCalledTimes(1);
  });

  it("retries once when nothing answered, before giving up", async () => {
    // A timeout or a momentarily busy wrapper is transient; one failed
    // request must not change what we report about the server.
    getHealthFn.mockResolvedValueOnce(health("unknown", "unreachable"));
    getHealthFn.mockResolvedValueOnce(health("online"));
    expect(await inst.isRunning()).toBe(true);
    expect(getHealthFn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry", async () => {
    getHealthFn.mockResolvedValue(health("unknown", "unreachable"));
    expect(await inst.isRunning()).toBe(false);
    expect(getHealthFn).toHaveBeenCalledTimes(2);
  });
});

describe("ServerInstance.getList()", () => {
  it("passes the wrapper's player list through", async () => {
    getListFn.mockResolvedValue({
      playerCount: "2",
      maxPlayers: "20",
      players: ["Steve", "Alex"],
    });
    expect(await inst.getList()).toEqual({
      playerCount: "2",
      maxPlayers: "20",
      players: ["Steve", "Alex"],
    });
  });

  it("degrades to an empty list rather than throwing", async () => {
    getListFn.mockRejectedValue(new Error("wrapper down"));
    expect(await inst.getList()).toEqual({
      playerCount: "0",
      maxPlayers: "?",
      players: [],
    });
  });
});

describe("ServerInstance.getTps()", () => {
  it("delegates to the wrapper, which owns the parsing", async () => {
    getTpsFn.mockResolvedValue({ tps1m: 19.9, raw: "..." });
    expect((await inst.getTps())?.tps1m).toBeCloseTo(19.9);
  });

  it("returns null rather than throwing when the wrapper is unreachable", async () => {
    getTpsFn.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await inst.getTps()).toBeNull();
  });
});

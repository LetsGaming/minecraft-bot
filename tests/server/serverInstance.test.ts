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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sendCommand = vi.fn();
const getHealthFn = vi.fn();
const getListFn = vi.fn();
const getTpsFn = vi.fn();
const tailLog = vi.fn();
const pingServer = vi.fn();
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  sendCommandOutcome: async (...a: unknown[]) => {
    const r = await sendCommand(...a);
    if (r !== null && typeof r === "object") return r;
    return r === null || r === undefined
      ? { kind: "sent", via: "screen" }
      : { kind: "delivered", output: r };
  },
  getHealth: (...a: unknown[]) => getHealthFn(...a),
  getList: (...a: unknown[]) => getListFn(...a),
  getTps: (...a: unknown[]) => getTpsFn(...a),
  tailLog: (...a: unknown[]) => tailLog(...a),
  pingServer: (...a: unknown[]) => pingServer(...a),
}));

import { ServerInstance } from "../../src/core/utils/server/server.js";
import type { ServerConfig } from "../../src/core/types/index.js";

const cfg: ServerConfig = {
  id: "survival",
  apiUrl: "http://127.0.0.1:3030",
  apiKey: "k",
};

const P = "[12:00:00] [Server thread/INFO]: ";
const val = <T>(r: { ok: boolean; value?: T }): T | null =>
  r.ok ? (r.value as T) : null;
const UNREACHABLE = { kind: "unreachable", reason: "wrapper-down", detail: "x" };
let inst: ServerInstance;

beforeEach(() => {
  for (const m of [
    sendCommand,
    getHealthFn,
    getListFn,
    getTpsFn,
    tailLog,
    pingServer,
  ]) {
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
    const c = val(await inst.getPlayerCoords("Steve"));
    expect(c?.x).toBeCloseTo(123.5);
    expect(c?.y).toBeCloseTo(64.0);
    expect(c?.z).toBeCloseTo(-456.7);
  });

  it("handles negative coordinates", async () => {
    sendCommand.mockResolvedValue("data: [-1000.0d, 100.0d, -2000.5d]");
    const c = val(await inst.getPlayerCoords("Alex"));
    expect(c?.x).toBeCloseTo(-1000.0);
    expect(c?.z).toBeCloseTo(-2000.5);
  });

  it("returns null when the player is not found", async () => {
    sendCommand.mockResolvedValue("No entity was found");
    expect(val(await inst.getPlayerCoords("Ghost"))).toBeNull();
  });

  it("falls back to the log when the wrapper has no reply channel", async () => {
    // A null reply means the wrapper reached the server over screen, which
    // has no response channel. The answer still lands in the log.
    sendCommand.mockResolvedValue(null);
    tailLog.mockResolvedValue(
      `${P}Steve has the following entity data: [1.0d, 2.0d, 3.0d]`,
    );
    const c = val(await inst.getPlayerCoords("Steve"));
    expect(c).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("ServerInstance.getSeed()", () => {
  it("parses and caches the seed", async () => {
    sendCommand.mockResolvedValue("Seed: [-4172144997902289642]");
    expect(val(await inst.getSeed())).toBe("-4172144997902289642");

    // Cached: a second call must not ask the server again.
    sendCommand.mockReset();
    expect(val(await inst.getSeed())).toBe("-4172144997902289642");
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("returns null when the response has no seed", async () => {
    sendCommand.mockResolvedValue("Unknown command");
    expect(val(await inst.getSeed())).toBeNull();
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

  it("retries once after a transient failure instead of reporting empty", async () => {
    getListFn
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        playerCount: "1",
        maxPlayers: "20",
        players: ["Steve"],
      });
    expect(await inst.getList()).toEqual({
      playerCount: "1",
      maxPlayers: "20",
      players: ["Steve"],
    });
    expect(getListFn).toHaveBeenCalledTimes(2);
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

describe("ServerInstance.getSeed()", () => {
  const SEED_LINE = "Seed: [-8123456789012345678]";

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the seed from the RCON reply and caches it", async () => {
    sendCommand.mockResolvedValue(SEED_LINE);
    expect(val(await inst.getSeed())).toBe("-8123456789012345678");
    expect(val(await inst.getSeed())).toBe("-8123456789012345678");
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(tailLog).not.toHaveBeenCalled();
  });

  it("polls the log when the command produced no output channel", async () => {
    sendCommand.mockResolvedValue(null);
    tailLog
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(`[12:00:00] [Server thread/INFO]: ${SEED_LINE}`);
    const p = inst.getSeed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(val(await p)).toBe("-8123456789012345678");
    expect(tailLog).toHaveBeenCalledTimes(2);
    expect(val(await inst.getSeed())).toBe("-8123456789012345678");
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither RCON nor the log yields a seed", async () => {
    sendCommand.mockResolvedValue(null);
    const p = inst.getSeed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(val(await p)).toBeNull();
    expect(tailLog).toHaveBeenCalledTimes(3);
  });

  it("does not poll the log when RCON answered without a seed", async () => {
    sendCommand.mockResolvedValue("Unknown or incomplete command");
    expect(val(await inst.getSeed())).toBeNull();
    expect(tailLog).not.toHaveBeenCalled();
  });

  it("does not resend the command while a miss is cached, then retries", async () => {
    sendCommand.mockResolvedValue(null);
    const first = inst.getSeed();
    await vi.advanceTimersByTimeAsync(1000);
    expect(val(await first)).toBeNull();
    expect(sendCommand).toHaveBeenCalledTimes(1);

    expect(val(await inst.getSeed())).toBeNull();
    expect(sendCommand).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);
    sendCommand.mockResolvedValue(SEED_LINE);
    expect(val(await inst.getSeed())).toBe("-8123456789012345678");
    expect(sendCommand).toHaveBeenCalledTimes(2);
  });
});

describe("ServerInstance.getMinecraftVersion()", () => {
  it("returns the version parsed from the status ping and caches it", async () => {
    pingServer.mockResolvedValue({
      kind: "status",
      result: { version: "Paper 1.21.4" },
    });
    expect(await inst.getMinecraftVersion()).toBe("1.21.4");
    expect(await inst.getMinecraftVersion()).toBe("1.21.4");
    expect(pingServer).toHaveBeenCalledTimes(1);
  });

  it("returns null when the ping gives no status", async () => {
    pingServer.mockResolvedValue({ kind: "refused", reason: "no" });
    expect(await inst.getMinecraftVersion()).toBeNull();
  });

  it("returns null when pinging is switched off", async () => {
    pingServer.mockResolvedValue(null);
    expect(await inst.getMinecraftVersion()).toBeNull();
  });
});

describe("log-poll parsers ignore player-typed lines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendCommand.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle<T>(p: Promise<T>): Promise<T> {
    await vi.advanceTimersByTimeAsync(1000);
    return p;
  }

  const seedSpoofs = [
    `${P}<Mallory> Seed: [999]`,
    "[12:00:00] [Async Chat Thread - #0/INFO]: <Mallory> Seed: [999]",
    `${P}[Server] Seed: [999]`,
    `${P}[Rcon] Seed: [999]`,
    `${P}<Mallory> hi
${P}Seed: [999] and more`,
  ];

  it.each(seedSpoofs)("getSeed ignores %s", async (line) => {
    tailLog.mockResolvedValue(line);
    expect(val(await settle(inst.getSeed()))).toBeNull();
  });

  it("getSeed accepts the genuine line, including a Forge extra tag", async () => {
    tailLog.mockResolvedValue(
      "[12:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: Seed: [42]",
    );
    expect(val(await settle(inst.getSeed()))).toBe("42");
  });

  it("getSeed prefers the genuine line when a spoof is newer", async () => {
    tailLog.mockResolvedValue(
      `${P}Seed: [42]
${P}<Mallory> Seed: [999]
${P}[Server] Seed: [999]`,
    );
    expect(val(await settle(inst.getSeed()))).toBe("42");
  });

  it("getSeed takes the newest genuine line", async () => {
    tailLog.mockResolvedValue(`${P}Seed: [1]
${P}Seed: [2]`);
    expect(val(await settle(inst.getSeed()))).toBe("2");
  });

  it("getSeed rejects values outside signed 64-bit", async () => {
    tailLog.mockResolvedValue(`${P}Seed: [9223372036854775808]`);
    expect(val(await settle(inst.getSeed()))).toBeNull();
    const rcon = new ServerInstance(cfg);
    sendCommand.mockResolvedValue("Seed: [99999999999999999999]");
    expect(val(await rcon.getSeed())).toBeNull();
  });

  it("a spoofed seed is never cached", async () => {
    tailLog.mockResolvedValue(`${P}<Mallory> Seed: [999]`);
    expect(val(await settle(inst.getSeed()))).toBeNull();
    inst = new ServerInstance(cfg);
    tailLog.mockResolvedValue(`${P}Seed: [42]`);
    expect(val(await settle(inst.getSeed()))).toBe("42");
  });

  const spoofData = (rest: string) => [
    `${P}<Mallory> Steve has the following entity data: ${rest}`,
    `${P}[Server] Steve has the following entity data: ${rest}`,
    `[12:00:00] [Async Chat Thread - #0/INFO]: <Mallory> Steve has the following entity data: ${rest}`,
  ];

  it.each(spoofData("[9.0d, 9.0d, 9.0d]"))("coords ignore %s", async (l) => {
    tailLog.mockResolvedValue(l);
    expect(val(await settle(inst.getPlayerCoords("Steve")))).toBeNull();
  });

  it("coords ignore another player's genuine answer", async () => {
    tailLog.mockResolvedValue(
      `${P}Alex has the following entity data: [9.0d, 9.0d, 9.0d]`,
    );
    expect(val(await settle(inst.getPlayerCoords("Steve")))).toBeNull();
  });

  it("coords prefer the genuine line over a newer spoof", async () => {
    tailLog.mockResolvedValue(
      `${P}Steve has the following entity data: [1.0d, 2.0d, 3.0d]
${P}<Mallory> Steve has the following entity data: [9.0d, 9.0d, 9.0d]`,
    );
    expect(val(await settle(inst.getPlayerCoords("Steve")))).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it.each(spoofData('"minecraft:the_end"'))(
    "dimension ignores %s",
    async (l) => {
      tailLog.mockResolvedValue(l);
      expect(val(await settle(inst.getPlayerDimension("Steve")))).toBeNull();
    },
  );

  it("dimension accepts the genuine line over a newer spoof", async () => {
    tailLog.mockResolvedValue(
      `${P}Steve has the following entity data: "minecraft:the_nether"
${P}<Mallory> Steve has the following entity data: "minecraft:the_end"`,
    );
    expect(val(await settle(inst.getPlayerDimension("Steve")))).toBe("the_nether");
  });

  const death =
    '{pos: [I; 10, 64, -20], dimension: "minecraft:the_nether"}';

  it.each(spoofData(death))("death location ignores %s", async (l) => {
    tailLog.mockResolvedValue(l);
    expect(val(await settle(inst.getLastDeathLocation("Steve")))).toBeNull();
  });

  it("death location accepts the genuine line over a newer spoof", async () => {
    tailLog.mockResolvedValue(
      `${P}Steve has the following entity data: ${death}
${P}<Mallory> Steve has the following entity data: {pos: [I; 1, 1, 1], dimension: "minecraft:the_end"}`,
    );
    expect(val(await settle(inst.getLastDeathLocation("Steve")))).toEqual({
      x: 10,
      y: 64,
      z: -20,
      dimension: "the_nether",
    });
  });
});

describe("live queries when the server cannot be reached", () => {
  it("fail at once without polling the log", async () => {
    sendCommand.mockResolvedValue(UNREACHABLE);
    expect(await inst.getSeed()).toEqual({ ok: false, reason: "unreachable" });
    expect(await inst.getPlayerCoords("Steve")).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(await inst.getPlayerDimension("Steve")).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(await inst.getLastDeathLocation("Steve")).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(tailLog).not.toHaveBeenCalled();
  });

  it("does not ask the seed again while the failure is cached", async () => {
    sendCommand.mockResolvedValue(UNREACHABLE);
    await inst.getSeed();
    expect(await inst.getSeed()).toEqual({ ok: false, reason: "unreachable" });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });
});

describe("live queries when the log read fails", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendCommand.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("report unreachable instead of throwing", async () => {
    tailLog.mockRejectedValue(new Error("circuit breaker open"));
    const p = inst.getPlayerCoords("Steve");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual({ ok: false, reason: "unreachable" });
  });
});

describe("live query failure reasons", () => {
  it("name an offline player", async () => {
    sendCommand.mockResolvedValue("No entity was found");
    expect(await inst.getPlayerCoords("Ghost")).toEqual({
      ok: false,
      reason: "player-offline",
    });
  });

  it("name a player with no recorded death", async () => {
    sendCommand.mockResolvedValue("Found no elements matching LastDeathLocation");
    expect(await inst.getLastDeathLocation("Steve")).toEqual({
      ok: false,
      reason: "no-data",
    });
  });

  it("never invent an overworld dimension for an unreadable reply", async () => {
    sendCommand.mockResolvedValue("something unexpected");
    expect(await inst.getPlayerDimension("Steve")).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("read the dimension from an RCON reply", async () => {
    sendCommand.mockResolvedValue('Steve has the following entity data: "minecraft:the_nether"');
    expect(await inst.getPlayerDimension("Steve")).toEqual({
      ok: true,
      value: "the_nether",
    });
  });
});

/**
 * ServerInstance response-parsing tests.
 *
 * Every method that talks to RCON parses a string response with a regex.
 * A broken regex silently returns wrong data to callers.  These tests
 * control what RCON "says" and assert on the parsed, structured output.
 *
 * Mock approach (Vitest 4+ requirement):
 *   vi.fn().mockImplementation(class { ... }) for constructor mocks.
 *   After `new ServerInstance(...)` the stub instance is retrieved via
 *   vi.mocked(RconClient).mock.instances[0].
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/core/shell/execCommand.js", () => ({
  execSafe: vi.fn().mockResolvedValue(null),
  isSudoPermissionError: vi.fn().mockReturnValue(false),
}));

vi.mock("../src/core/rcon/RconClient.js", () => ({
  RconClient: vi.fn().mockImplementation(
    class {
      send = vi.fn();
      trySend = vi.fn();
      connect = vi.fn().mockResolvedValue(undefined);
      disconnect = vi.fn();
      get lastSuccessTime() {
        return Date.now();
      }
    },
  ),
}));

import { RconClient } from "../src/core/rcon/RconClient.js";
import { ServerInstance } from "../src/core/utils/server.js";

const rconCfg = {
  id: "survival",
  serverDir: "/tmp/fake",
  linuxUser: "mc",
  screenSession: "server",
  useRcon: true,
  rconHost: "127.0.0.1",
  rconPort: 25575,
  rconPassword: "pw",
  scriptDir: "",
} as never;

// After `new ServerInstance(rconCfg)`, the ServerInstance constructor calls
// `new RconClient(...)` once.  Vitest records that instance in mock.instances.
function getSendMock(): ReturnType<typeof vi.fn> {
  const inst = vi.mocked(RconClient).mock.instances.at(-1) as
    | { send: ReturnType<typeof vi.fn> }
    | undefined;
  if (!inst) throw new Error("RconClient was never instantiated");
  return inst.send;
}

let inst: ServerInstance;

beforeEach(() => {
  vi.mocked(RconClient).mockClear();
  inst = new ServerInstance(rconCfg);
  getSendMock().mockReset();
});

// ── getList() ─────────────────────────────────────────────────────────────

describe("ServerInstance.getList()", () => {
  it("parses a standard vanilla response", async () => {
    getSendMock().mockResolvedValue(
      "There are 2 of a max of 20 players online: Alice, Bob",
    );
    const r = await inst.getList();
    expect(r.playerCount).toBe("2");
    expect(r.maxPlayers).toBe("20");
    expect(r.players).toEqual(["Alice", "Bob"]);
  });

  it("parses a Paper-style '/' separator", async () => {
    getSendMock().mockResolvedValue(
      "There are 3/20 players online: Steve, Alex, Notch",
    );
    const r = await inst.getList();
    expect(r.playerCount).toBe("3");
    expect(r.maxPlayers).toBe("20");
    expect(r.players).toEqual(["Steve", "Alex", "Notch"]);
  });

  it("returns an empty player list when nobody is online", async () => {
    getSendMock().mockResolvedValue(
      "There are 0 of a max of 20 players online: ",
    );
    expect((await inst.getList()).players).toEqual([]);
  });

  it("returns safe defaults when RCON throws", async () => {
    getSendMock().mockRejectedValue(new Error("RCON lost"));
    const r = await inst.getList();
    expect(r.playerCount).toBe("0");
    expect(r.players).toEqual([]);
  });
});

// ── getSeed() ─────────────────────────────────────────────────────────────

describe("ServerInstance.getSeed()", () => {
  it("parses a positive seed", async () => {
    getSendMock().mockResolvedValue("Seed: [1234567890]");
    expect(await inst.getSeed()).toBe("1234567890");
  });

  it("parses a negative seed", async () => {
    getSendMock().mockResolvedValue("Seed: [-987654321]");
    expect(await inst.getSeed()).toBe("-987654321");
  });

  it("caches the seed — only one RCON call even with repeated invocations", async () => {
    getSendMock().mockResolvedValue("Seed: [111]");
    await inst.getSeed();
    await inst.getSeed();
    expect(getSendMock()).toHaveBeenCalledTimes(1);
  });
});

// ── getTps() — Paper/Spigot ────────────────────────────────────────────────

describe("ServerInstance.getTps() — Paper tps command", () => {
  it("parses 'TPS from last 1m, 5m, 15m: *N, *N, *N'", async () => {
    getSendMock().mockResolvedValue(
      "TPS from last 1m, 5m, 15m: *19.98, *19.99, *20.0",
    );
    const tps = await inst.getTps();
    expect(tps?.tps1m).toBeCloseTo(19.98);
    expect(tps?.tps5m).toBeCloseTo(19.99);
    expect(tps?.tps15m).toBeCloseTo(20.0);
  });

  it("parses values without the '*' prefix", async () => {
    getSendMock().mockResolvedValue(
      "TPS from last 1m, 5m, 15m: 18.5, 19.0, 20.0",
    );
    expect((await inst.getTps())?.tps1m).toBeCloseTo(18.5);
  });

  it("returns tps1m < 15 for a degraded server (would trigger TPS alert)", async () => {
    getSendMock().mockResolvedValue(
      "TPS from last 1m, 5m, 15m: *8.2, *10.1, *15.4",
    );
    expect((await inst.getTps())!.tps1m).toBeLessThan(15);
  });
});

// ── getTps() — vanilla tick query fallback ────────────────────────────────

describe("ServerInstance.getTps() — vanilla tick query fallback", () => {
  it("falls back to tick query when tps command is unknown", async () => {
    getSendMock()
      .mockResolvedValueOnce("Unknown command: tps")
      .mockResolvedValue("Average time per tick: 50.0 ms");
    expect((await inst.getTps())?.tps1m).toBeCloseTo(20.0); // 1000/50 = 20
  });

  it("includes MSPT in the result", async () => {
    getSendMock()
      .mockResolvedValueOnce("Unknown command: tps")
      .mockResolvedValue("Average time per tick: 50.0 ms");
    expect(((await inst.getTps()) as { mspt?: number })?.mspt).toBeCloseTo(
      50.0,
    );
  });

  it("includes P50/P95/P99 percentiles when the response contains them", async () => {
    getSendMock()
      .mockResolvedValueOnce("Unknown command: tps")
      .mockResolvedValue(
        "Average time per tick: 50.0 ms (P50: 48.0 ms, P95: 55.0 ms, P99: 62.0 ms)",
      );
    const tps = (await inst.getTps()) as {
      p50?: number;
      p95?: number;
      p99?: number;
    };
    expect(tps?.p50).toBeCloseTo(48.0);
    expect(tps?.p95).toBeCloseTo(55.0);
    expect(tps?.p99).toBeCloseTo(62.0);
  });

  it("caps TPS at 20 even when MSPT is very small", async () => {
    getSendMock()
      .mockResolvedValueOnce("Unknown command: tps")
      .mockResolvedValue("Average time per tick: 1.0 ms");
    expect((await inst.getTps())!.tps1m).toBeLessThanOrEqual(20);
  });

  it("returns null when tick query is also unsupported", async () => {
    getSendMock()
      .mockResolvedValueOnce("Unknown command: tps")
      .mockResolvedValue("Unknown command: tick");
    expect(await inst.getTps()).toBeNull();
  });

  it("returns null when tick query response has no expected line (Bug 2 regression)", async () => {
    // Bug 2 fix: return null, not { tps1m: 0 }, when the line is missing.
    // A zero-TPS result would trigger a false Low TPS alert.
    getSendMock()
      .mockResolvedValueOnce("Unknown command: tps")
      .mockResolvedValue("something completely unexpected");
    expect(await inst.getTps()).toBeNull();
  });
});

// ── getPlayerCoords() ─────────────────────────────────────────────────────

describe("ServerInstance.getPlayerCoords()", () => {
  it("parses RCON Pos response into x/y/z numbers", async () => {
    getSendMock().mockResolvedValue(
      "Steve has the following entity data: [123.5d, 64.0d, -456.7d]",
    );
    const c = await inst.getPlayerCoords("Steve");
    expect(c?.x).toBeCloseTo(123.5);
    expect(c?.y).toBeCloseTo(64.0);
    expect(c?.z).toBeCloseTo(-456.7);
  });

  it("handles negative coordinates", async () => {
    getSendMock().mockResolvedValue("data: [-1000.0d, 100.0d, -2000.5d]");
    const c = await inst.getPlayerCoords("Alex");
    expect(c?.x).toBeCloseTo(-1000.0);
    expect(c?.z).toBeCloseTo(-2000.5);
  });

  it("returns null when the player is not found", async () => {
    getSendMock().mockResolvedValue("No entity was found");
    expect(await inst.getPlayerCoords("Ghost")).toBeNull();
  });
});

// ── getPlayerDimension() ──────────────────────────────────────────────────

describe("ServerInstance.getPlayerDimension()", () => {
  it("parses overworld", async () => {
    getSendMock().mockResolvedValue('data: "minecraft:overworld"');
    expect(await inst.getPlayerDimension("Steve")).toBe("overworld");
  });

  it("parses the_nether", async () => {
    getSendMock().mockResolvedValue('data: "minecraft:the_nether"');
    expect(await inst.getPlayerDimension("Steve")).toBe("the_nether");
  });

  it("parses the_end", async () => {
    getSendMock().mockResolvedValue('data: "minecraft:the_end"');
    expect(await inst.getPlayerDimension("Steve")).toBe("the_end");
  });

  it("defaults to overworld when response has no dimension pattern", async () => {
    getSendMock().mockResolvedValue("No entity was found");
    expect(await inst.getPlayerDimension("Ghost")).toBe("overworld");
  });
});

// ── isRunning() ───────────────────────────────────────────────────────────

describe("ServerInstance.isRunning()", () => {
  it("returns true when a RCON probe succeeds", async () => {
    getSendMock().mockResolvedValue(
      "There are 0 of a max of 20 players online",
    );
    expect(await inst.isRunning()).toBe(true);
  });

  it("returns false when all RCON probes fail", async () => {
    getSendMock().mockRejectedValue(new Error("RCON timeout"));
    expect(await inst.isRunning()).toBe(false);
  });
});

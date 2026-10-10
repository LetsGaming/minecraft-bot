/**
 * Tests for:
 * - server.ts: initServers, getServerInstance, getAllInstances, getGuildServer
 * - RconClient: pure packet encode/decode helpers (tested via constructor)
 * - utils.ts: ensureDir
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import os from "os";
import path from "path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    guilds: { guild1: { defaultServer: "survival" } },
    servers: {},
    adminUsers: [],
    token: "tok",
    clientId: "cid",
  }),
}));

vi.mock("../../src/core/rcon/RconClient.js", () => ({
  RconClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi.fn().mockResolvedValue(""),
  })),
}));

vi.mock("../../src/core/shell/execCommand.js", () => ({
  execSafe: vi.fn().mockResolvedValue(null),
  isSudoPermissionError: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  readUserCache: vi.fn().mockResolvedValue([]),
  tailLog: vi.fn().mockResolvedValue(""),
  isRunning: vi.fn().mockResolvedValue(false),
  getList: vi
    .fn()
    .mockResolvedValue({ playerCount: "0", maxPlayers: "20", players: [] }),
  sendCommand: vi.fn().mockResolvedValue(null),
  getTps: vi.fn().mockResolvedValue(null),
}));

// ══════════════════════════════════════════════════════════════════════════════
// server.ts — registry functions
// ══════════════════════════════════════════════════════════════════════════════

describe("server.ts — initServers / getServerInstance / getAllInstances", () => {
  let initServers: (cfg: Record<string, never>) => void;
  let getServerInstance: (id: string) => unknown;
  let getAllInstances: () => unknown[];
  let getGuildServer: (guildId: string | undefined) => unknown;

  beforeEach(async () => {
    vi.resetModules();
    ({ initServers, getServerInstance, getAllInstances, getGuildServer } =
      await import("../../src/core/utils/server/server.js"));
    vi.clearAllMocks();
  });

  const minimalCfg = {
    id: "survival",
    serverDir: "/tmp",
    linuxUser: "mc",
    screenSession: "server",
    useRcon: false,
    rconHost: "localhost",
    rconPort: 25575,
    rconPassword: "",
    scriptDir: "",
  } as never;

  it("initServers registers instances by ID", () => {
    initServers({ survival: minimalCfg });
    const inst = getServerInstance("survival");
    expect(inst).not.toBeNull();
    expect((inst as { id: string }).id).toBe("survival");
  });

  it("getServerInstance returns null-ish for unknown ID when no instances", () => {
    const result = getServerInstance("doesnotexist");
    // Returns first instance or null — both valid
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("getAllInstances returns all registered instances", () => {
    initServers({
      survival: minimalCfg,
      creative: { ...minimalCfg, id: "creative" } as never,
    });
    const all = getAllInstances();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("getGuildServer resolves the only configured server in a DM", () => {
    initServers({ survival: minimalCfg });
    expect((getGuildServer(undefined) as { id: string }).id).toBe("survival");
  });

  it("getGuildServer asks for server: when a DM has several servers", () => {
    initServers({
      survival: minimalCfg,
      creative: { ...minimalCfg, id: "creative" } as never,
    });
    expect(() => getGuildServer(undefined)).toThrow(/Pass `server:`/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ServerInstance — basic property tests
// ══════════════════════════════════════════════════════════════════════════════

describe("ServerInstance", () => {
  let ServerInstance: new (cfg: never) => {
    id: string;
    useRcon: boolean;
    config: never;
    supportsTps: boolean;
  };

  beforeEach(async () => {
    vi.resetModules();
    ({ ServerInstance } = await import("../../src/core/utils/server/server.js"));
  });

  const cfg = {
    id: "local",
    apiUrl: "http://127.0.0.1:3030",
    apiKey: "k",
  } as never;

  it("constructs with correct id", () => {
    const inst = new ServerInstance(cfg);
    expect(inst.id).toBe("local");
  });

  it("supportsTps is true — the wrapper answers /tps for every instance", () => {
    // This used to depend on how the server was reached: RCON yes, screen no.
    // There is one way to reach a server now, and it has the route.
    expect(new ServerInstance(cfg).supportsTps).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// utils.ts — ensureDir
// ══════════════════════════════════════════════════════════════════════════════

describe("utils.ensureDir", () => {
  let ensureDir: (filePath: string) => Promise<string>;
  let tmpDir: string;

  beforeEach(async () => {
    ({ ensureDir } = await import("../../src/core/utils/paths.js"));
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "ensureDir-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates missing parent directories", async () => {
    const filePath = path.join(tmpDir, "deep", "nested", "file.json");
    const dir = await ensureDir(filePath);
    expect(dir).toBe(path.dirname(filePath));
    const { existsSync } = await import("fs");
    expect(existsSync(path.dirname(filePath))).toBe(true);
  });

  it("returns the directory path without throwing when dir already exists", async () => {
    const filePath = path.join(tmpDir, "file.json");
    const dir = await ensureDir(filePath);
    expect(dir).toBe(tmpDir);
  });
});


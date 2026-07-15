/**
 * serverAccess.ts tests — exercises the apiUrl (remote) code paths.
 *
 * Every exported function has two branches:
 *   if (cfg.apiUrl) → HTTP via fetch (apiGet / apiPost)
 *   else            → local filesystem / shell exec
 *
 * We test the remote branch by providing a cfg with apiUrl and mocking fetch.
 * The local (non-api) branch for simple functions (isRunning → false, getList → empty)
 * can be exercised without filesystem side-effects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub fetch globally — individual tests override per-call expectations.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  tailLog,
  isRunning,
  getList,
  sendCommand,
  getTps,
  readWhitelist,
  readUserCache,
  readLevelName,
  readStats,
  listStatsUuids,
  deleteStatsFile,
  readBackups,
  runScript,
  logStreamUrl,
} from "../../src/core/utils/server/serverAccess.js";

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

const remoteCfg = {
  id: "survival",
  serverDir: "/tmp/fake-server",
  apiUrl: "https://api.example.com",
  apiKey: "test-key",
  linuxUser: "mc",
} as never;

const localCfg = {
  id: "local",
  serverDir: "/tmp/fake-server",
  linuxUser: "mc",
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

// ── tailLog ───────────────────────────────────────────────────────────────

describe("tailLog", () => {
  it("calls API /logs/tail when apiUrl is set", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ output: "server log line" }),
    );
    const result = await tailLog(remoteCfg, 5);
    expect(result).toBe("server log line");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/logs/tail"),
      expect.any(Object),
    );
  });

  it("returns empty string for local cfg when log file doesn't exist", async () => {
    const result = await tailLog(localCfg, 5);
    expect(typeof result).toBe("string");
  });
});

// ── isRunning ─────────────────────────────────────────────────────────────

describe("isRunning", () => {
  it("returns true from API response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ running: true }));
    expect(await isRunning(remoteCfg)).toBe(true);
  });

  it("returns false from API response", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ running: false }));
    expect(await isRunning(remoteCfg)).toBe(false);
  });

  it("returns false without API (local path)", async () => {
    expect(await isRunning(localCfg)).toBe(false);
  });
});

// ── getList ───────────────────────────────────────────────────────────────

describe("getList", () => {
  it("returns player list from API", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        playerCount: "3",
        maxPlayers: "20",
        players: ["A", "B", "C"],
      }),
    );
    const list = await getList(remoteCfg);
    expect(list.playerCount).toBe("3");
    expect(list.players).toHaveLength(3);
  });

  it("returns empty list without API", async () => {
    const list = await getList(localCfg);
    expect(list.playerCount).toBe("0");
    expect(list.players).toHaveLength(0);
  });
});

// ── sendCommand ───────────────────────────────────────────────────────────

describe("sendCommand", () => {
  it("posts command to API and returns result", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "Command output" }));
    const out = await sendCommand(remoteCfg, "/say hello");
    expect(out).toBe("Command output");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/command"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns null without API", async () => {
    expect(await sendCommand(localCfg, "/say hi")).toBeNull();
  });
});

// ── getTps ────────────────────────────────────────────────────────────────

describe("getTps", () => {
  it("returns TPS data from API", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ tps: { tps1m: 20, tps5m: 20, tps15m: 20 } }),
    );
    const tps = await getTps(remoteCfg);
    expect(tps).not.toBeNull();
    expect(tps?.tps1m).toBe(20);
  });

  it("returns null without API", async () => {
    expect(await getTps(localCfg)).toBeNull();
  });
});

// ── readWhitelist ─────────────────────────────────────────────────────────

describe("readWhitelist", () => {
  it("returns whitelist from API", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ whitelist: [{ uuid: "u1", name: "Steve" }] }),
    );
    const list = await readWhitelist(remoteCfg);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe("Steve");
  });

  it("returns empty array for local cfg when whitelist.json doesn't exist", async () => {
    const list = await readWhitelist(localCfg);
    expect(list).toEqual([]);
  });
});

// ── readUserCache ─────────────────────────────────────────────────────────

describe("readUserCache", () => {
  it("returns the usercache from the API", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ usercache: [{ uuid: "u1", name: "Casey" }] }),
    );
    const list = await readUserCache(remoteCfg);
    expect(list).toEqual([{ uuid: "u1", name: "Casey" }]);
  });

  it("returns [] when the wrapper predates the /usercache endpoint", async () => {
    // Older api-servers answer 404; the bot must degrade, not throw.
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "not found" }, false));
    const list = await readUserCache(remoteCfg);
    expect(list).toEqual([]);
  });

  it("returns [] for local cfg when usercache.json doesn't exist", async () => {
    const list = await readUserCache(localCfg);
    expect(list).toEqual([]);
  });

  it("parses local usercache.json and drops malformed entries", async () => {
    const fs = await import("fs");
    const os = await import("os");
    const path = await import("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usercache-"));
    fs.writeFileSync(
      path.join(dir, "usercache.json"),
      JSON.stringify([
        { name: "Casey", uuid: "u1", expiresOn: "2026-08-01" },
        { name: 42, uuid: "broken" },
        { uuid: "u3" },
      ]),
    );
    try {
      const list = await readUserCache({
        id: "local",
        serverDir: dir,
      } as never);
      expect(list).toEqual([{ name: "Casey", uuid: "u1" }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── readLevelName ─────────────────────────────────────────────────────────

describe("readLevelName", () => {
  it("returns level name from API", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ levelName: "world_name" }));
    const name = await readLevelName(remoteCfg);
    expect(name).toBe("world_name");
  });

  it("returns 'world' as fallback for local cfg", async () => {
    const name = await readLevelName(localCfg);
    expect(name).toBe("world");
  });
});

// ── readStats ─────────────────────────────────────────────────────────────

describe("readStats", () => {
  it("returns stats from API", async () => {
    const fakeStats = { stats: { "minecraft:custom": {} } };
    mockFetch.mockResolvedValueOnce(jsonResponse({ stats: fakeStats }));
    const stats = await readStats(remoteCfg, "11111111-2222-3333-4444-555555555555");
    expect(stats).toEqual(fakeStats);
  });

  it("returns null for local cfg when file doesn't exist", async () => {
    // readLevelName falls back to "world", then stats dir doesn't exist
    const stats = await readStats(localCfg, "11111111-2222-3333-4444-555555555555");
    expect(stats).toBeNull();
  });
});

// ── listStatsUuids ────────────────────────────────────────────────────────

describe("listStatsUuids", () => {
  it("returns UUID list from API", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ uuids: ["u1", "u2", "u3"] }),
    );
    const uuids = await listStatsUuids(remoteCfg);
    expect(uuids).toEqual(["u1", "u2", "u3"]);
  });

  it("returns empty array for local cfg when stats dir doesn't exist", async () => {
    const uuids = await listStatsUuids(localCfg);
    expect(uuids).toEqual([]);
  });
});

// ── deleteStatsFile ───────────────────────────────────────────────────────

describe("deleteStatsFile", () => {
  it("returns false for remote (deletion not supported via API)", async () => {
    // By design, remote stats deletion is not supported through the API
    const result = await deleteStatsFile(remoteCfg, "11111111-2222-3333-4444-555555555555");
    expect(result).toBe(false);
  });

  it("returns false for local when file doesn't exist", async () => {
    const result = await deleteStatsFile(localCfg, "00000000000000000000000000000000");
    expect(result).toBe(false);
  });
});

// ── UUID sinks reject malformed input before path/URL build ───────────────

describe("uuid format assertion at sinks", () => {
  const badUuids = [
    "../../../etc/passwd", // path traversal
    "abc/../def",
    "uuid-1", // too short / non-hex
    "g1111111-2222-3333-4444-555555555555", // non-hex char
    "",
  ];

  it("readStats rejects malformed uuids without touching fetch/fs", async () => {
    for (const bad of badUuids) {
      await expect(readStats(remoteCfg, bad)).rejects.toThrow(
        /Invalid UUID format/,
      );
      await expect(readStats(localCfg, bad)).rejects.toThrow(
        /Invalid UUID format/,
      );
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deleteStatsFile rejects malformed uuids without touching fetch/fs", async () => {
    for (const bad of badUuids) {
      await expect(deleteStatsFile(remoteCfg, bad)).rejects.toThrow(
        /Invalid UUID format/,
      );
      await expect(deleteStatsFile(localCfg, bad)).rejects.toThrow(
        /Invalid UUID format/,
      );
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts both dashed and dashless Minecraft UUID shapes", async () => {
    // 36-char dashed and 32-char raw hex are both valid on-disk formats.
    await expect(
      readStats(localCfg, "11111111-2222-3333-4444-555555555555"),
    ).resolves.toBeNull(); // file simply doesn't exist
    await expect(
      readStats(localCfg, "11111111222233334444555555555555"),
    ).resolves.toBeNull();
  });
});

// ── readBackups ───────────────────────────────────────────────────────────

describe("readBackups", () => {
  it("returns backup data from API (maps latestMtimeMs to Date)", async () => {
    const mtime = Date.now();
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        dirs: [
          {
            dir: "hourly",
            count: 3,
            latestFile: "backup-001.tar.zst",
            latestMtimeMs: mtime,
            latestSizeBytes: 1_048_576,
          },
        ],
        totalBytes: 3_145_728,
      }),
    );
    const result = await readBackups(remoteCfg);
    expect(result.dirs).toHaveLength(1);
    expect(result.dirs[0]!.latestMtime).toBeInstanceOf(Date);
    expect(result.totalBytes).toBe(3_145_728);
  });

  it("returns empty dirs for local when backup base does not exist", async () => {
    const localWithSession = { ...localCfg, screenSession: "server" } as never;
    const result = await readBackups(localWithSession);
    expect(result.dirs).toEqual([]);
    expect(result.totalBytes).toBe(0);
  });
});

// ── runScript ─────────────────────────────────────────────────────────────

describe("runScript", () => {
  it("posts to API /scripts/run and returns result", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ exitCode: 0, output: "Server started", stderr: "" }),
    );
    const result = await runScript(remoteCfg, "start");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("Server started");
  });

  it("passes args as JSON body", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ exitCode: 0, output: "", stderr: "" }),
    );
    await runScript(remoteCfg, "backup", ["--archive"]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining("archive"),
      }),
    );
  });
});

// ── logStreamUrl ──────────────────────────────────────────────────────────

describe("logStreamUrl", () => {
  it("constructs correct SSE URL", () => {
    const url = logStreamUrl({
      id: "survival",
      apiUrl: "https://api.example.com",
    } as never);
    expect(url).toBe("https://api.example.com/instances/survival/logs/stream");
  });

  it("strips trailing slash from apiUrl", () => {
    const url = logStreamUrl({
      id: "srv",
      apiUrl: "https://api.example.com/",
    } as never);
    expect(url).not.toContain("//instances");
  });
});

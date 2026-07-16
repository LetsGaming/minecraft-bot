/**
 * serverAccess.ts tests.
 *
 * Every exported function has two branches:
 *   if (cfg.apiUrl) → HTTP via fetch (apiGet / apiPost)
 *   else            → local filesystem / shell exec
 *
 * The remote branch is tested with a cfg carrying apiUrl and a mocked fetch.
 * The local branch is tested against real temp directories where the layout
 * on disk is the whole point — statsDir below — and without filesystem
 * side-effects otherwise (isRunning → false, getList → empty).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Stub fetch globally — individual tests override per-call expectations.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  statsDir,
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
  apiUrl: "https://api.example.com",
  apiKey: "test-key",
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


});

// ── readLevelName ─────────────────────────────────────────────────────────

describe("readLevelName", () => {
  it("returns level name from API", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ levelName: "world_name" }));
    const name = await readLevelName(remoteCfg);
    expect(name).toBe("world_name");
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

});

// ── deleteStatsFile ───────────────────────────────────────────────────────

describe("deleteStatsFile", () => {
  it("returns false for remote (deletion not supported via API)", async () => {
    // By design, remote stats deletion is not supported through the API
    const result = await deleteStatsFile(remoteCfg, "11111111-2222-3333-4444-555555555555");
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
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deleteStatsFile rejects malformed uuids without touching fetch/fs", async () => {
    for (const bad of badUuids) {
      await expect(deleteStatsFile(remoteCfg, bad)).rejects.toThrow(
        /Invalid UUID format/,
      );
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts both dashed and dashless Minecraft UUID shapes", async () => {
    // 36-char dashed and 32-char raw hex are both valid on-disk formats, so
    // the guard must let each through to the wrapper rather than reject it.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('{"error":"Stats not found"}'),
    });
    for (const uuid of [
      "11111111-2222-3333-4444-555555555555",
      "11111111222233334444555555555555",
    ]) {
      await expect(readStats(remoteCfg, uuid)).resolves.toBeNull();
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

// A player who has never played is the common case: the wrapper answers 404
// and readStats used to let that throw, so /stats replied "Failed to retrieve
// stats" and logged an ERROR for what is simply "no stats yet". The 404 is
// the wrapper telling us something specific; treating it as a transport
// failure throws that away.
describe("readStats — a missing stats file is an answer, not a failure", () => {
  beforeEach(() => mockFetch.mockReset());

  it("returns null when the wrapper says 404, rather than throwing", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('{"error":"Stats not found"}'),
    });

    await expect(
      readStats(remoteCfg, "069a79f4-44e9-4726-a5be-fca90e38aaf5"),
    ).resolves.toBeNull();
  });

  it("still throws on a real wrapper failure", async () => {
    // 500 is not "this player has no stats" — it means the read itself broke,
    // and swallowing it would look identical to a player who never played.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn(),
      text: vi.fn().mockResolvedValue('{"error":"Internal server error"}'),
    });

    await expect(
      readStats(remoteCfg, "069a79f4-44e9-4726-a5be-fca90e38aaf5"),
    ).rejects.toThrow(/500/);
  });

  it("returns the stats document when the wrapper has one", async () => {
    const doc = { stats: { "minecraft:custom": { "minecraft:play_time": 42 } } };
    mockFetch.mockResolvedValue(jsonResponse({ stats: doc }));

    await expect(
      readStats(remoteCfg, "069a79f4-44e9-4726-a5be-fca90e38aaf5"),
    ).resolves.toEqual(doc);
  });
});

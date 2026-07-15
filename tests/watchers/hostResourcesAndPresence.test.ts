/**
 * Host resources (df/ps parsing, path selection) and the bot presence
 * formatter that rides the status pass.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/shell/execCommand.js", () => ({
  execSafe: vi.fn(),
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
}));

import { execSafe } from "../../src/core/shell/execCommand.js";
import { loadConfig } from "../../src/core/config.js";
import {
  getDiskUsage,
  getServerProcessUsage,
  monitoredPaths,
  getHostResources,
  formatBytes,
} from "../../src/core/utils/server/hostResources.js";
import { updateBotPresence } from "../../src/bot/logWatcher/watchers/schedulers/statusEmbed.js";
import type { ServerInstance } from "../../src/core/utils/server/server.js";
import type { Client } from "discord.js";

beforeEach(() => vi.clearAllMocks());

// ── df parsing ──────────────────────────────────────────────────────────────

describe("getDiskUsage", () => {
  it("parses POSIX df output", async () => {
    vi.mocked(execSafe).mockResolvedValue(
      [
        "Filesystem     1024-blocks      Used Available Capacity Mounted on",
        "/dev/sda1        102400000  92160000  10240000      90% /",
      ].join("\n"),
    );
    const usage = await getDiskUsage("/srv/minecraft");
    expect(usage).toEqual({
      path: "/srv/minecraft",
      usedPercent: 90,
      availableBytes: 10240000 * 1024,
      totalBytes: 102400000 * 1024,
    });
    expect(execSafe).toHaveBeenCalledWith("df", ["-Pk", "/srv/minecraft"]);
  });

  it("returns null on missing or malformed output", async () => {
    vi.mocked(execSafe).mockResolvedValue(null);
    expect(await getDiskUsage("/x")).toBeNull();
    vi.mocked(execSafe).mockResolvedValue("Filesystem only header");
    expect(await getDiskUsage("/x")).toBeNull();
    vi.mocked(execSafe).mockResolvedValue("head\nnot numbers at all\n");
    expect(await getDiskUsage("/x")).toBeNull();
  });
});

// ── ps parsing ──────────────────────────────────────────────────────────────

describe("getServerProcessUsage", () => {
  it("picks the biggest java process of the user", async () => {
    vi.mocked(execSafe).mockResolvedValue(
      [
        "  101  0.5  20480 bash",
        "  202 45.3 4096000 java",
        "  203  1.0  512000 java",
      ].join("\n"),
    );
    const usage = await getServerProcessUsage("mc-smp");
    expect(usage).toEqual({
      pid: 202,
      cpuPercent: 45.3,
      rssBytes: 4096000 * 1024,
    });
  });

  it("returns null when no java process runs", async () => {
    vi.mocked(execSafe).mockResolvedValue("  101 0.0 1000 bash\n");
    expect(await getServerProcessUsage("mc-smp")).toBeNull();
  });
});

// ── path selection + remote skip ────────────────────────────────────────────

describe("monitoredPaths / getHostResources", () => {
  const srv = (over: Record<string, unknown> = {}) =>
    ({
      id: "smp",
      config: { serverDir: "/srv/mc/smp", linuxUser: "mc-smp", ...over },
      capabilities: { backups: true },
    }) as unknown as ServerInstance;

  it("includes the suite backups dir only when the capability probe found it", () => {
    expect(monitoredPaths(srv())).toEqual(["/srv/mc/smp", "/srv/mc/backups"]);
    const plain = srv();
    (plain as { capabilities: { backups: boolean } }).capabilities.backups =
      false;
    expect(monitoredPaths(plain)).toEqual(["/srv/mc/smp"]);
  });

  it("returns null for remote instances when /info is unreachable (pre-1.2.0 wrapper)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNREFUSED"));
    expect(
      await getHostResources(srv({ apiUrl: "http://wrapper:8080" })),
    ).toBeNull();
    expect(execSafe).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("maps the wrapper /info host block for remote instances (wrapper >= 1.2.0)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "1.2.0",
        host: {
          process: { pid: 42, cpuPercent: 3.5, rssBytes: 2048 },
          disks: [
            { path: "/srv/mc", usedPercent: 71, availableBytes: 10, totalBytes: 100 },
            { path: "broken" }, // malformed entry — must be filtered
          ],
        },
      }),
    } as unknown as Response);

    const host = await getHostResources(srv({ apiUrl: "http://wrapper:8080" }));
    expect(host).not.toBeNull();
    expect(host!.process).toEqual({ pid: 42, cpuPercent: 3.5, rssBytes: 2048 });
    expect(host!.disks).toHaveLength(1);
    expect(host!.disks[0]!.path).toBe("/srv/mc");
    expect(execSafe).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(300 * 1024 ** 2)).toBe("300 MB");
    expect(formatBytes(4.25 * 1024 ** 3)).toBe("4.3 GB");
  });
});

// ── presence ────────────────────────────────────────────────────────────────

describe("updateBotPresence", () => {
  const fieldMap = (entries: Record<string, { online: number; max: number }>) =>
    new Map(
      Object.entries(entries).map(([id, counts]) => [
        id,
        { counts } as never,
      ]),
    );

  const makeClient = () => {
    const setPresence = vi.fn();
    return {
      client: { user: { setPresence } } as unknown as Client,
      setPresence,
    };
  };

  it("aggregates across servers with the default format", () => {
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      presence: { enabled: true },
    } as never);
    const { client, setPresence } = makeClient();

    updateBotPresence(
      client,
      fieldMap({ smp: { online: 3, max: 20 }, creative: { online: 4, max: 10 } }),
    );

    expect(setPresence).toHaveBeenCalledWith(
      expect.objectContaining({
        activities: [expect.objectContaining({ name: "7 online @ 2 servers" })],
      }),
    );
  });

  it("supports a single pinned server and custom format placeholders", () => {
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      presence: {
        enabled: true,
        server: "smp",
        format: "{online}/{max} on {server}",
      },
    } as never);
    const { client, setPresence } = makeClient();

    updateBotPresence(
      client,
      fieldMap({ smp: { online: 5, max: 20 }, creative: { online: 9, max: 10 } }),
    );

    expect(setPresence).toHaveBeenCalledWith(
      expect.objectContaining({
        activities: [expect.objectContaining({ name: "5/20 on smp" })],
      }),
    );
  });

  it("clears the activity once when toggled off, then stays quiet", () => {
    const { client, setPresence } = makeClient();
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      presence: { enabled: true },
    } as never);
    updateBotPresence(client, fieldMap({ smp: { online: 1, max: 5 } }));
    expect(setPresence).toHaveBeenCalledTimes(1);

    vi.mocked(loadConfig).mockReturnValue({ language: "en" } as never);
    updateBotPresence(client, fieldMap({ smp: { online: 1, max: 5 } }));
    expect(setPresence).toHaveBeenCalledTimes(2);
    expect(setPresence).toHaveBeenLastCalledWith({ activities: [] });

    updateBotPresence(client, fieldMap({ smp: { online: 1, max: 5 } }));
    expect(setPresence).toHaveBeenCalledTimes(2); // no repeat clears
  });

  it("does nothing for an unknown pinned server", () => {
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      presence: { enabled: true, server: "ghost" },
    } as never);
    const { client, setPresence } = makeClient();
    updateBotPresence(client, fieldMap({ smp: { online: 1, max: 5 } }));
    expect(setPresence).not.toHaveBeenCalled();
  });
});

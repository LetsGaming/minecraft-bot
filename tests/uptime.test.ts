/**
 * uptime.ts command tests
 *
 * The private helpers formatDuration, uptimeBar, stateEmoji, buildSingleEmbed
 * are all exercised when execute() runs through its happy paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/server.js", () => ({
  getAllInstances: vi.fn(),
  getServerInstance: vi.fn(),
  getGuildServer: vi.fn(),
}));

vi.mock("../src/utils/guildRouter.js", () => ({
  resolveServer: vi.fn(),
}));

vi.mock("../src/utils/uptimeTracker.js", () => ({
  getUptimeStats: vi.fn(),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockImplementation((opts) => {
    // Return a minimal object that quacks like EmbedBuilder
    const fields: Array<{name: string; value: string; inline: boolean}> = [];
    return {
      _opts: opts,
      addFields: vi.fn((...args) => {
        if (Array.isArray(args[0])) fields.push(...args[0]);
        else fields.push(args[0] as typeof fields[0]);
        return this;
      }),
      setFooter: vi.fn().mockReturnThis(),
      toJSON: () => ({ title: opts?.title, description: opts?.description, fields }),
    };
  }),
}));

vi.mock("../src/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
}));

import { getAllInstances } from "../src/utils/server.js";
import { resolveServer } from "../src/utils/guildRouter.js";
import { getUptimeStats } from "../src/utils/uptimeTracker.js";
import { execute } from "../src/commands/info/uptime.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { UptimeStats } from "../src/utils/uptimeTracker.js";

function makeInteraction(serverId: string | null = null): ChatInputCommandInteraction {
  return {
    user: { id: "user1" },
    commandName: "uptime",
    options: {
      getString: vi.fn().mockReturnValue(serverId),
    },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({}),
    deferred: false,
    replied: false,
  } as unknown as ChatInputCommandInteraction;
}

const onlineStats: UptimeStats = {
  pct24h: 99.5,
  pct7d: 98.0,
  pct30d: 95.0,
  checks24h: { total: 1440, online: 1433 },
  checks7d: { total: 10080, online: 9878 },
  checks30d: { total: 43200, online: 41040 },
  currentState: "online",
  currentStateDuration: 3600_000,
};

const offlineStats: UptimeStats = {
  pct24h: 0,
  pct7d: null,
  pct30d: null,
  checks24h: { total: 5, online: 0 },
  checks7d: { total: 0, online: 0 },
  checks30d: { total: 0, online: 0 },
  currentState: "offline",
  currentStateDuration: 120_000,
};

const unknownStats: UptimeStats = {
  pct24h: null,
  pct7d: null,
  pct30d: null,
  checks24h: { total: 0, online: 0 },
  checks7d: { total: 0, online: 0 },
  checks30d: { total: 0, online: 0 },
  currentState: "unknown",
  currentStateDuration: 0,
};

const fakeServer = { id: "survival" } as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAllInstances).mockReturnValue([fakeServer]);
  vi.mocked(resolveServer).mockReturnValue(fakeServer);
  vi.mocked(getUptimeStats).mockResolvedValue(onlineStats);
});

describe("uptime execute — single server (default)", () => {
  it("calls getUptimeStats with the server id", async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    expect(getUptimeStats).toHaveBeenCalledWith("survival");
  });

  it("calls editReply with an embed", async () => {
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("works when server is offline", async () => {
    vi.mocked(getUptimeStats).mockResolvedValue(offlineStats);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("works when server state is unknown (no data yet)", async () => {
    vi.mocked(getUptimeStats).mockResolvedValue(unknownStats);
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

describe("uptime execute — explicit server option", () => {
  it("resolves the server when serverId option is provided", async () => {
    const interaction = makeInteraction("survival");
    await execute(interaction);
    expect(resolveServer).toHaveBeenCalledWith(interaction);
    expect(getUptimeStats).toHaveBeenCalledWith("survival");
  });
});

describe("uptime execute — multi-server overview", () => {
  it("shows all server stats when multiple instances exist", async () => {
    const server2 = { id: "creative" } as never;
    vi.mocked(getAllInstances).mockReturnValue([fakeServer, server2]);
    vi.mocked(getUptimeStats).mockResolvedValue(onlineStats);

    // No explicit server option → multi-server path
    const interaction = makeInteraction(null);
    await execute(interaction);

    // getUptimeStats should be called for both servers
    expect(getUptimeStats).toHaveBeenCalledTimes(2);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

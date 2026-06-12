/**
 * Admin config command and logWatcher in-game commands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/commands/middleware.js", () => ({
  withErrorHandling: vi.fn((fn) => fn),
  requireServerAdmin: vi.fn((fn) => fn),
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    adminUsers: ["admin1"],
    servers: {
      survival: {
        id: "survival",
        useRcon: false,
        rconHost: "localhost",
        rconPort: 25575,
        linuxUser: "mc",
        serverDir: "/srv",
      },
    },
    guilds: { guild1: { defaultServer: "survival" } },
    leaderboardInterval: "daily",
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 60_000,
    token: "tok12345678",
    clientId: "12345",
    commands: {},
  }),
  reloadConfig: vi.fn().mockReturnValue({
    adminUsers: ["admin1"],
    servers: {},
    guilds: {},
  }),
  getServerIds: vi.fn().mockReturnValue(["survival"]),
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi.fn().mockImplementation((opts) => ({
    _opts: opts,
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
    toJSON: () => ({ title: opts?.title }),
  })),
  createSuccessEmbed: vi.fn().mockReturnValue({ type: "success" }),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// M-05(b): /config reload now applies server changes live via reconciliation
vi.mock("../src/logWatcher/initMinecraftCommands.js", () => ({
  reconcileServers: vi
    .fn()
    .mockResolvedValue({ added: [], removed: [], changed: [] }),
}));

vi.mock("../src/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
  getGlobalWatchers: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/utils/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn().mockReturnValue({ id: "survival" }),
}));

import type { ChatInputCommandInteraction } from "discord.js";

function makeInteraction(sub = "show") {
  return {
    user: { id: "admin1", tag: "Admin#0001" },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: "msg" }),
    reply: vi.fn().mockResolvedValue(undefined),
    options: {
      getString: vi.fn().mockReturnValue(null),
      getSubcommand: vi.fn().mockReturnValue(sub),
    },
    deferred: false,
    replied: false,
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// /config admin command
// ══════════════════════════════════════════════════════════════════════════════

describe("/config admin command — show subcommand", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/admin/config.js"));
  });

  it("replies with config embed on 'show'", async () => {
    const interaction = makeInteraction("show");
    await execute(interaction as never);
    expect(interaction.editReply).toHaveBeenCalled();
  });
});

describe("/config admin command — reload subcommand", () => {
  let execute: (i: never) => Promise<void>;
  beforeEach(async () => {
    ({ execute } = await import("../src/commands/admin/config.js"));
  });

  it("replies with success embed after reloading config", async () => {
    const interaction = makeInteraction("reload");
    await execute(interaction as never);
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("reconciles server changes and reports them as applied live (M-05b)", async () => {
    const { reconcileServers } = await import(
      "../src/logWatcher/initMinecraftCommands.js"
    );
    vi.mocked(reconcileServers).mockResolvedValue({
      added: ["creative"],
      removed: ["old"],
      changed: ["survival"],
    });
    const { createSuccessEmbed } = await import("../src/utils/embedUtils.js");

    const interaction = makeInteraction("reload");
    await execute(interaction as never);

    expect(reconcileServers).toHaveBeenCalledOnce();
    const msg = vi.mocked(createSuccessEmbed).mock.calls.at(-1)![0] as string;
    expect(msg).toContain("+ Added (live): creative");
    expect(msg).toContain("- Removed (live): old");
    expect(msg).toContain("require a restart: survival");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// logWatcher in-game commands
// ══════════════════════════════════════════════════════════════════════════════

describe("logWatcher !seed command", () => {
  it("registers via init() without throwing", async () => {
    const { init } = await import("../src/logWatcher/commands/seed.js");
    expect(() => init()).not.toThrow();
  });
});

describe("logWatcher !netherportal command", () => {
  it("registers via init() without throwing", async () => {
    const { init } = await import("../src/logWatcher/commands/netherportal.js");
    expect(() => init()).not.toThrow();
  });
});

describe("logWatcher !chunkbase command", () => {
  it("registers via init() without throwing", async () => {
    const { init } = await import("../src/logWatcher/commands/chunkbase.js");
    expect(() => init()).not.toThrow();
  });
});

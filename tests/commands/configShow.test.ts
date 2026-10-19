/**
 * /config show runs through the real middleware: the reply must be ephemeral
 * and must not expose the token, wrapper URLs or other guilds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageFlags } from "discord.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    language: "en",
    adminUsers: ["111111111111111111", "222222222222222222"],
    servers: {
      survival: { apiUrl: "https://user:pw@mc.example.com:3030/secret/path?k=1" },
    },
    guilds: {
      guild1: {
        defaultServer: "survival",
        console: { channelId: "c1" },
        statusEmbed: { enabled: false },
        leaderboard: { channelId: "c2" },
        chatBridge: [{ channelId: "c3" }, { channelId: "c4" }],
      },
      otherGuild: { defaultServer: "survival" },
    },
    leaderboardInterval: "daily",
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 60_000,
    token: "super-secret-token-value",
    clientId: "12345",
    commands: {},
  }),
  reloadConfig: vi.fn(),
}));

vi.mock("../../src/bot/logWatcher/initMinecraftCommands.js", () => ({
  reconcileServers: vi.fn(),
}));
vi.mock("../../src/core/utils/server/runtimeHeartbeat.js", () => ({
  beginConfigApply: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));

import { execute } from "../../src/bot/commands/admin/config.js";

function makeInteraction() {
  return {
    commandName: "config",
    user: { id: "111111111111111111", tag: "admin#1" },
    guild: { id: "guild1" },
    member: { roles: [] },
    options: { getSubcommand: () => "show" },
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("/config show", () => {
  it("defers ephemerally", async () => {
    const i = makeInteraction();
    await execute(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
  });

  it("does not leak the token, wrapper URL details, admin ids or other guilds", async () => {
    const i = makeInteraction();
    await execute(i as never);
    const reply = i.editReply.mock.calls[0]![0] as {
      embeds: Array<{ toJSON(): unknown }>;
    };
    const json = JSON.stringify(reply.embeds[0]!.toJSON());
    expect(json).not.toContain("super-secret");
    expect(json).not.toContain("su••");
    expect(json).not.toContain("user:pw");
    expect(json).not.toContain("/secret/path");
    expect(json).not.toContain("111111111111111111");
    expect(json).not.toContain("otherGuild");
    expect(json).toContain("mc.example.com:3030");
    expect(json).toContain("guild1");
  });

  it("lists the guild's enabled features from the shared feature table, console included", async () => {
    const i = makeInteraction();
    await execute(i as never);
    const reply = i.editReply.mock.calls[0]![0] as {
      embeds: Array<{ toJSON(): unknown }>;
    };
    const json = JSON.stringify(reply.embeds[0]!.toJSON());
    expect(json).toContain("leaderboard");
    expect(json).toContain("console");
    expect(json).toContain("chat bridge ×2");
  });
});

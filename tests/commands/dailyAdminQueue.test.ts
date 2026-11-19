/**
 * /daily-admin queue: show, clear and retry a player's queued and failed
 * rewards, against the real store and the same tenant rules as the other
 * subcommands.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/config.js")>()),
  loadConfig: vi.fn(),
  getServerIds: vi.fn(),
}));

vi.mock("../../src/core/utils/stores/linkStore.js", () => ({
  getLinkedAccount: vi.fn(),
}));

vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));

import { loadConfig, getServerIds } from "../../src/core/config.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import { getLinkedAccount } from "../../src/core/utils/stores/linkStore.js";
import { recordAdminAction } from "../../src/core/utils/stores/adminAudit.js";
import {
  enqueuePending,
  recordFailed,
  peekPlayerQueue,
} from "../../src/core/utils/stores/dailyStore.js";
import {
  initServers,
  getAllInstances,
  removeServerInstance,
} from "../../src/core/utils/server/server.js";
import { execute } from "../../src/bot/commands/admin/dailyAdmin.js";
import type { BotConfig } from "../../src/core/types/index.js";
import type { ChatInputCommandInteraction } from "discord.js";

function serverCfg(id: string) {
  return {
    id,
    serverDir: "/tmp",
    linuxUser: "mc",
    screenSession: "server",
    useRcon: false,
    rconHost: "localhost",
    rconPort: 25575,
    rconPassword: "",
    scriptDir: "",
  };
}

function setup(): void {
  const ids = ["a", "b"];
  const servers = Object.fromEntries(ids.map((id) => [id, serverCfg(id)]));
  vi.mocked(loadConfig).mockReturnValue({
    adminUsers: ["operator"],
    guilds: {
      g1: { defaultServer: "a", adminUsers: ["guildAdmin1"] },
      g2: { defaultServer: "b", adminUsers: ["guildAdmin2"] },
    },
    servers,
  } as unknown as BotConfig);
  vi.mocked(getServerIds).mockReturnValue(ids);
  initServers(servers as never);
}

function call(opts: {
  action: "show" | "clear" | "retry";
  userId?: string;
  strings?: Record<string, string>;
  withUser?: boolean;
}) {
  const editReply = vi.fn().mockResolvedValue({});
  const strings: Record<string, string> = { action: opts.action, ...opts.strings };
  const interaction = {
    guild: { id: "g1" },
    user: { id: opts.userId ?? "guildAdmin1", tag: "admin#1" },
    member: null,
    commandName: "daily-admin",
    deferred: true,
    ephemeral: true,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    editReply,
    options: {
      getSubcommand: () => "queue",
      getUser: () => (opts.withUser ? { id: "target", tag: "target#1" } : null),
      getString: (name: string, required?: boolean) => {
        const value = strings[name] ?? null;
        if (value === null && required) throw new Error(`missing ${name}`);
        return value;
      },
      getBoolean: () => null,
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, editReply };
}

function replyText(editReply: ReturnType<typeof vi.fn>): string {
  const embed = editReply.mock.calls[0]![0].embeds[0];
  return String(embed.data.description ?? embed.data.title ?? "");
}

const failed = {
  discordId: "u1",
  items: [{ item: "minecraft:stick", amount: 1 }],
  queuedAt: 1,
  failedAt: 2,
  reason: "rejected" as const,
};

beforeEach(async () => {
  vi.clearAllMocks();
  closeDbForTesting();
  for (const inst of getAllInstances()) removeServerInstance(inst.id);
  setup();
  vi.mocked(getLinkedAccount).mockResolvedValue("Steve");
  await enqueuePending("a", "steve", {
    discordId: "u1",
    items: [{ item: "minecraft:diamond", amount: 4 }],
    queuedAt: 10,
  });
  await recordFailed("a", "steve", [failed]);
});

describe("/daily-admin queue", () => {
  it("shows queued and failed entries of a typed player name", async () => {
    const { interaction, editReply } = call({ action: "show", strings: { player: "STEVE" } });
    await execute(interaction);
    const text = replyText(editReply);
    expect(text).toContain("Queued (1)");
    expect(text).toContain("Failed (1)");
    expect(text).toContain("the server rejected the item");
  });

  it("resolves the player from a linked Discord user", async () => {
    const { interaction, editReply } = call({ action: "show", withUser: true });
    await execute(interaction);
    expect(getLinkedAccount).toHaveBeenCalledWith("target");
    expect(replyText(editReply)).toContain("Queued (1)");
  });

  it("asks for a target when neither user nor player is given", async () => {
    const { interaction, editReply } = call({ action: "show" });
    await execute(interaction);
    expect(replyText(editReply)).toMatch(/user|player/);
    expect(recordAdminAction).not.toHaveBeenCalled();
  });

  it("clear empties both lists and writes an audit entry", async () => {
    const { interaction } = call({ action: "clear", strings: { player: "steve" } });
    await execute(interaction);
    expect(peekPlayerQueue("a", "steve")).toEqual({ pending: [], failed: [] });
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily-queue-clear", server: "a" }),
    );
  });

  it("retry moves failed entries back to the queue", async () => {
    const { interaction } = call({ action: "retry", strings: { player: "steve" } });
    await execute(interaction);
    const { pending, failed: left } = peekPlayerQueue("a", "steve");
    expect(left).toEqual([]);
    expect(pending).toHaveLength(2);
    expect(recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily-queue-retry" }),
    );
  });

  it("retry reports when nothing failed", async () => {
    const { interaction, editReply } = call({
      action: "retry",
      strings: { player: "nobody" },
    });
    await execute(interaction);
    expect(replyText(editReply)).toMatch(/no failed entries/);
  });

  it("refuses another tenant's server and changes nothing", async () => {
    await recordFailed("b", "steve", [failed]);
    const { interaction, editReply } = call({
      action: "clear",
      strings: { player: "steve", server: "b" },
    });
    await execute(interaction);
    expect(replyText(editReply)).toMatch(/not available from this Discord server/);
    expect(peekPlayerQueue("b", "steve").failed).toHaveLength(1);
  });
});

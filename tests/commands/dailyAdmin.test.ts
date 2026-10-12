import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/config.js")>()),
  loadConfig: vi.fn(),
  getServerIds: vi.fn(),
}));

vi.mock("../../src/core/utils/stores/dailyStore.js", () => ({
  loadClaimedStore: vi.fn(),
  saveClaimedStore: vi.fn().mockResolvedValue(undefined),
  getServerClaims: (store: { servers: Record<string, Record<string, unknown>> }, id: string) =>
    (store.servers[id] ??= {}),
}));

vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));

import { loadConfig, getServerIds } from "../../src/core/config.js";
import {
  loadClaimedStore,
  saveClaimedStore,
} from "../../src/core/utils/stores/dailyStore.js";
import {
  initServers,
  getAllInstances,
  removeServerInstance,
} from "../../src/core/utils/server/server.js";
import { execute } from "../../src/bot/commands/admin/dailyAdmin.js";
import type { BotConfig } from "../../src/core/types/index.js";
import type { ChatInputCommandInteraction } from "discord.js";

const record = { currentStreak: 3, longestStreak: 5, lastClaim: 1_700_000_000_000 };

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

function setup(guildAdmins: Record<string, string[]>): void {
  const ids = ["a", "b"];
  const servers = Object.fromEntries(ids.map((id) => [id, serverCfg(id)]));
  vi.mocked(loadConfig).mockReturnValue({
    adminUsers: ["operator"],
    guilds: {
      g1: { defaultServer: "a", adminUsers: guildAdmins["g1"] ?? [] },
      g2: { defaultServer: "b", adminUsers: guildAdmins["g2"] ?? [] },
    },
    servers,
  } as unknown as BotConfig);
  vi.mocked(getServerIds).mockReturnValue(ids);
  initServers(servers as never);
}

function call(opts: {
  sub: "move" | "reset" | "show";
  userId: string;
  guildId: string;
  strings?: Record<string, string>;
}) {
  const editReply = vi.fn().mockResolvedValue({});
  const interaction = {
    guild: { id: opts.guildId },
    user: { id: opts.userId, tag: "admin#1" },
    member: null,
    commandName: "daily-admin",
    deferred: true,
    ephemeral: true,
    replied: false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    editReply,
    options: {
      getSubcommand: () => opts.sub,
      getUser: () => ({ id: "target", tag: "target#1" }),
      getString: (name: string) => opts.strings?.[name] ?? null,
      getBoolean: () => null,
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, editReply };
}

function replyText(editReply: ReturnType<typeof vi.fn>): string {
  const embed = editReply.mock.calls[0]![0].embeds[0];
  return String(embed.data.description ?? embed.data.title ?? "");
}

let store: { version: number; servers: Record<string, Record<string, unknown>> };

beforeEach(() => {
  vi.clearAllMocks();
  for (const inst of getAllInstances()) removeServerInstance(inst.id);
  setup({ g1: ["guildAdmin1"], g2: ["guildAdmin2"] });
  store = { version: 2, servers: { a: { target: { ...record } }, b: { target: { ...record } } } };
  vi.mocked(loadClaimedStore).mockResolvedValue(store as never);
});

describe("/daily-admin tenant isolation", () => {
  it("reset defaults to the guild's default server", async () => {
    const { interaction } = call({ sub: "reset", userId: "guildAdmin1", guildId: "g1" });
    await execute(interaction);
    expect(store.servers["a"]!["target"]).toBeUndefined();
    expect(store.servers["b"]!["target"]).toBeDefined();
    expect(saveClaimedStore).toHaveBeenCalled();
  });

  it("reset refuses another tenant's server", async () => {
    const { interaction, editReply } = call({
      sub: "reset",
      userId: "guildAdmin1",
      guildId: "g1",
      strings: { server: "b" },
    });
    await execute(interaction);
    expect(replyText(editReply)).toMatch(/not available from this Discord server/);
    expect(store.servers["b"]!["target"]).toBeDefined();
    expect(saveClaimedStore).not.toHaveBeenCalled();
  });

  it("move refuses a target outside the guild's servers", async () => {
    const { interaction, editReply } = call({
      sub: "move",
      userId: "guildAdmin1",
      guildId: "g1",
      strings: { from: "a", to: "b" },
    });
    await execute(interaction);
    expect(replyText(editReply)).toMatch(/not available from this Discord server/);
    expect(saveClaimedStore).not.toHaveBeenCalled();
  });

  it("move refuses a source outside the guild's servers", async () => {
    const { interaction, editReply } = call({
      sub: "move",
      userId: "guildAdmin1",
      guildId: "g1",
      strings: { from: "b", to: "a" },
    });
    await execute(interaction);
    expect(replyText(editReply)).toMatch(/not available from this Discord server/);
    expect(saveClaimedStore).not.toHaveBeenCalled();
  });

  it("show lists only servers the guild may target", async () => {
    const { interaction, editReply } = call({ sub: "show", userId: "guildAdmin1", guildId: "g1" });
    await execute(interaction);
    const text = replyText(editReply);
    expect(text).toContain("a");
    expect(text).not.toContain("**b**");
    expect(text.split("\n")).toHaveLength(1);
  });

  it("operators may reset any server and see every record", async () => {
    const reset = call({
      sub: "reset",
      userId: "operator",
      guildId: "g1",
      strings: { server: "b" },
    });
    await execute(reset.interaction);
    expect(store.servers["b"]!["target"]).toBeUndefined();

    store.servers["b"]!["target"] = { ...record };
    const show = call({ sub: "show", userId: "operator", guildId: "g1" });
    await execute(show.interaction);
    expect(replyText(show.editReply).split("\n")).toHaveLength(2);
  });
});

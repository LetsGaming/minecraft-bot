/**
 * The small helpers the slash commands share: audit envelope, player name
 * validation, paging, load-or-friendly-error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  recordAdminAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  handlePagination: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: (fn: unknown) => fn,
  requireServerAdmin: (fn: unknown) => fn,
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({ resolveServer: vi.fn() }));

import { recordAdminAction } from "../../src/core/utils/stores/adminAudit.js";
import { handlePagination } from "../../src/bot/utils/embeds/embedUtils.js";
import { auditAdminAction } from "../../src/bot/commands/shared/audit.js";
import {
  assertMcName,
  playerConsoleCommand,
  requireMcName,
} from "../../src/bot/commands/shared/mcName.js";
import { pageBy, replyPaged } from "../../src/bot/commands/shared/paged.js";
import { loadOrFail } from "../../src/bot/commands/shared/loadOrFail.js";
import { buildLeaderboardData } from "../../src/bot/commands/shared/leaderboard.js";
import { CommandError } from "../../src/core/utils/error.js";

beforeEach(() => vi.clearAllMocks());

describe("auditAdminAction", () => {
  const user = { tag: "admin#1", id: "u1" };

  it("fills in who acted and where, and omits an unset server", async () => {
    await auditAdminAction({ user, guild: { id: "g1" }, guildId: "g1" } as never, {
      action: "note add",
      detail: "Steve: hi",
    });
    expect(recordAdminAction).toHaveBeenCalledWith({
      action: "note add",
      detail: "Steve: hi",
      by: "admin#1",
      byId: "u1",
      guildId: "g1",
    });
  });

  it("passes the server through and uses a null guild outside guilds", async () => {
    await auditAdminAction({ user, guild: null, guildId: null } as never, {
      action: "kick",
      server: "smp",
    });
    expect(recordAdminAction).toHaveBeenCalledWith({
      action: "kick",
      server: "smp",
      by: "admin#1",
      byId: "u1",
      guildId: null,
    });
  });
});

describe("player names", () => {
  it("trims and accepts a valid name", () => {
    expect(assertMcName("  Steve ")).toBe("Steve");
  });

  it("rejects an invalid name with the friendly message", () => {
    expect(() => assertMcName("bad name!")).toThrow(/bad name!/);
  });

  it("reads the option and validates it the same way for every command", () => {
    const interaction = { options: { getString: vi.fn().mockReturnValue(" Alex ") } };
    expect(requireMcName(interaction as never, "player")).toBe("Alex");
    expect(interaction.options.getString).toHaveBeenCalledWith("player", true);
  });

  it("builds a console command and turns a refused argument into the invalid-name error", () => {
    expect(playerConsoleCommand("Steve", "/pardon", { player: "Steve" })).toBe("/pardon Steve");
    expect(() => playerConsoleCommand("a b", "/pardon", { player: "a b" })).toThrow(/a b/);
  });
});

describe("pageBy and replyPaged", () => {
  it("splits into pages of the given size", () => {
    expect(pageBy([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(pageBy([], 3)).toEqual([]);
  });

  it("sends a single page without a pager", async () => {
    const interaction = { editReply: vi.fn().mockResolvedValue({ id: "m" }) };
    const embeds = [new EmbedBuilder().setTitle("a")];
    await replyPaged(interaction as never, embeds);
    expect(interaction.editReply).toHaveBeenCalledWith({ embeds });
    expect(handlePagination).not.toHaveBeenCalled();
  });

  it("sends the first page with buttons and drives the pager for several", async () => {
    const message = { id: "m" };
    const interaction = { editReply: vi.fn().mockResolvedValue(message) };
    const embeds = [new EmbedBuilder().setTitle("a"), new EmbedBuilder().setTitle("b")];
    await replyPaged(interaction as never, embeds);
    const payload = interaction.editReply.mock.calls[0]![0] as {
      embeds: EmbedBuilder[];
      components: unknown[];
    };
    expect(payload.embeds).toEqual([embeds[0]]);
    expect(payload.components).toHaveLength(1);
    expect(handlePagination).toHaveBeenCalledWith(message, interaction, embeds);
  });
});

describe("loadOrFail", () => {
  it("returns the value", async () => {
    await expect(loadOrFail("t", "problem", async () => 7)).resolves.toBe(7);
  });

  it("hides a raw failure behind the friendly problem", async () => {
    const error = loadOrFail("t", "Could not read.", async () => {
      throw new Error("EACCES: permission denied, open '/srv/mc/world/stats'");
    });
    await expect(error).rejects.toBeInstanceOf(CommandError);
    await expect(error).rejects.toMatchObject({ problem: "Could not read." });
  });

  it("leaves a command error alone", async () => {
    const own = new CommandError({ problem: "own" });
    await expect(
      loadOrFail("t", "Could not read.", async () => {
        throw own;
      }),
    ).rejects.toBe(own);
  });

  it("leaves a wrapper failure to the error middleware", async () => {
    const failure = new TypeError("fetch failed");
    await expect(
      loadOrFail("t", "Could not read.", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });
});

describe("buildLeaderboardData", () => {
  it("defines /leaderboard with a stat and a server option", () => {
    const data = buildLeaderboardData();
    expect(data).toBeInstanceOf(SlashCommandBuilder);
    const json = data.toJSON();
    expect(json.name).toBe("leaderboard");
    expect((json.options ?? []).map((o) => o.name)).toEqual(["stat", "server"]);
  });
});

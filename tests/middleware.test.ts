import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────
vi.mock("../src/core/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
}));

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadConfig } from "../src/core/config.js";
import {
  isServerAdmin,
  requireServerAdmin,
  withErrorHandling,
} from "../src/bot/commands/middleware.js";
import type { ChatInputCommandInteraction } from "discord.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeInteraction(
  opts: {
    userId?: string;
    commandName?: string;
    deferred?: boolean;
    replied?: boolean;
  } = {},
): ChatInputCommandInteraction {
  return {
    user: { id: opts.userId ?? "user_default" },
    commandName: opts.commandName ?? "cmd",
    deferred: opts.deferred ?? false,
    replied: opts.replied ?? false,
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isServerAdmin ──────────────────────────────────────────────────────────

describe("isServerAdmin", () => {
  it("returns true when the user ID is in adminUsers", () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["admin1", "admin2"],
    } as ReturnType<typeof loadConfig>);
    expect(isServerAdmin("admin1")).toBe(true);
  });

  it("returns true for the second admin in the list", () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["admin1", "admin2"],
    } as ReturnType<typeof loadConfig>);
    expect(isServerAdmin("admin2")).toBe(true);
  });

  it("returns false when the user ID is not in adminUsers", () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["admin1"],
    } as ReturnType<typeof loadConfig>);
    expect(isServerAdmin("notanadmin")).toBe(false);
  });

  it("returns false when adminUsers is an empty array", () => {
    vi.mocked(loadConfig).mockReturnValue({ adminUsers: [] } as ReturnType<
      typeof loadConfig
    >);
    expect(isServerAdmin("anyone")).toBe(false);
  });

  it("accepts a user carrying an admin role ID", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["admin1", "role-mod-123"],
    } as never);
    const { isServerAdmin } = await import("../src/bot/commands/middleware.js");
    expect(isServerAdmin("someuser", ["role-other", "role-mod-123"])).toBe(
      true,
    );
    expect(isServerAdmin("someuser", ["role-other"])).toBe(false);
  });

  // ── Per-guild admin scoping ──────────────────────────────────────

  it("accepts a per-guild admin only within their own guild", () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: [],
      guilds: {
        guildA: { adminUsers: ["alice"] },
        guildB: { adminUsers: ["bob"] },
      },
    } as never);
    expect(isServerAdmin("alice", [], "guildA")).toBe(true);
    expect(isServerAdmin("alice", [], "guildB")).toBe(false);
    expect(isServerAdmin("alice", [])).toBe(false); // DM: no guild scope
  });

  it("matches per-guild admin role IDs", () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: [],
      guilds: { guildA: { adminUsers: ["role-guildA-mod"] } },
    } as never);
    expect(isServerAdmin("member", ["role-guildA-mod"], "guildA")).toBe(true);
    expect(isServerAdmin("member", ["role-guildA-mod"], "guildB")).toBe(false);
  });

  it("global adminUsers remain valid in every guild", () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["operator"],
      guilds: { guildA: { adminUsers: ["alice"] } },
    } as never);
    expect(isServerAdmin("operator", [], "guildA")).toBe(true);
    expect(isServerAdmin("operator", [], "guildB")).toBe(true);
    expect(isServerAdmin("operator", [])).toBe(true);
  });

  it("getMemberRoleIds handles cached and raw member shapes", async () => {
    const { getMemberRoleIds } = await import("../src/bot/commands/middleware.js");
    // Raw API shape: roles is a string array
    expect(
      getMemberRoleIds({ member: { roles: ["r1", "r2"] } } as never),
    ).toEqual(["r1", "r2"]);
    // Cached shape: roles.cache is a Map
    expect(
      getMemberRoleIds({
        member: { roles: { cache: new Map([["r3", {}]]) } },
      } as never),
    ).toEqual(["r3"]);
    // No member (DM)
    expect(getMemberRoleIds({} as never)).toEqual([]);
  });
});

// ── requireServerAdmin ─────────────────────────────────────────────────────

describe("requireServerAdmin", () => {
  it("calls execute when the user is an admin", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["admin1"],
    } as ReturnType<typeof loadConfig>);
    const execute = vi.fn().mockResolvedValue(undefined);
    const wrapped = requireServerAdmin(execute);
    const interaction = makeInteraction({ userId: "admin1" });

    await wrapped(interaction);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(interaction);
  });

  it("throws when the user is not an admin", async () => {
    vi.mocked(loadConfig).mockReturnValue({ adminUsers: [] } as ReturnType<
      typeof loadConfig
    >);
    const execute = vi.fn();
    const wrapped = requireServerAdmin(execute);
    const interaction = makeInteraction({ userId: "nobody" });

    await expect(wrapped(interaction)).rejects.toThrow(
      "You do not have permission to use this command.",
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

// ── withErrorHandling ──────────────────────────────────────────────────────

describe("withErrorHandling", () => {
  it("calls deferReply with empty opts by default", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(execute);
    const interaction = makeInteraction();

    await wrapped(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({});
    expect(execute).toHaveBeenCalledWith(interaction);
  });

  it("defers with Ephemeral flag when ephemeral=true", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(execute, { ephemeral: true });
    const interaction = makeInteraction();

    await wrapped(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: expect.anything() }),
    );
  });

  it("does not defer when defer=false", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(execute, { defer: false });
    const interaction = makeInteraction();

    await wrapped(interaction);

    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
  });

  it("calls editReply with error embed when execute throws (deferred=true)", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling(execute);
    const interaction = makeInteraction({ deferred: true });

    await wrapped(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ type: "error-embed" }],
    });
  });

  it("calls editReply when already replied", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling(execute);
    const interaction = makeInteraction({ deferred: false, replied: true });

    await wrapped(interaction);

    expect(interaction.editReply).toHaveBeenCalled();
  });

  it("calls reply with ephemeral embed when execute throws (not deferred, not replied)", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling(execute, { defer: false });
    const interaction = makeInteraction({ deferred: false, replied: false });

    await wrapped(interaction);

    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("handles non-Error thrown objects gracefully", async () => {
    const execute = vi.fn().mockRejectedValue("just a string error");
    const wrapped = withErrorHandling(execute, { defer: false });
    const interaction = makeInteraction({ deferred: true });

    // Should not throw — error is caught and turned into an embed
    await expect(wrapped(interaction)).resolves.toBeUndefined();
  });
});

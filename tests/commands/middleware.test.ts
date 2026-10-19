import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
  createEmbed: vi.fn().mockReturnValue({ type: "denied-embed" }),
}));
vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadConfig } from "../../src/core/config.js";
import {
  requireServerAdmin,
  withErrorHandling,
} from "../../src/bot/commands/middleware.js";
import type { ChatInputCommandInteraction } from "discord.js";

// ── helpers ────────────────────────────────────────────────────────────────

function makeInteraction(
  opts: {
    userId?: string;
    commandName?: string;
    deferred?: boolean;
    replied?: boolean;
    ephemeral?: boolean;
  } = {},
): ChatInputCommandInteraction {
  return {
    user: { id: opts.userId ?? "user_default" },
    commandName: opts.commandName ?? "cmd",
    deferred: opts.deferred ?? false,
    replied: opts.replied ?? false,
    ephemeral: opts.ephemeral ?? null,
    isChatInputCommand: () => true,
    options: { getSubcommand: () => null, getSubcommandGroup: () => null },
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("answers a non-admin with an ephemeral denial instead of running", async () => {
    vi.mocked(loadConfig).mockReturnValue({ adminUsers: [] } as ReturnType<
      typeof loadConfig
    >);
    const execute = vi.fn();
    const wrapped = requireServerAdmin(execute);
    const interaction = makeInteraction({ userId: "nobody" });

    await wrapped(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: [{ type: "denied-embed" }], flags: 64 }),
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("is checked once, not again, when wrapped by withErrorHandling", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      adminUsers: ["admin1"],
    } as ReturnType<typeof loadConfig>);
    const run = vi.fn().mockResolvedValue(undefined);
    const wrapped = withErrorHandling(requireServerAdmin(run));

    await wrapped(makeInteraction({ userId: "admin1" }));

    expect(run).toHaveBeenCalledOnce();
    expect(loadConfig).toHaveBeenCalledOnce();
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

  it("calls editReply with error embed when execute throws (deferred ephemerally)", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling(execute);
    const interaction = makeInteraction({ deferred: true, ephemeral: true });

    await wrapped(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      embeds: [{ type: "error-embed" }],
    });
  });

  it("follows up ephemerally when already replied", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = withErrorHandling(execute);
    const interaction = makeInteraction({ deferred: false, replied: true });

    await wrapped(interaction);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
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

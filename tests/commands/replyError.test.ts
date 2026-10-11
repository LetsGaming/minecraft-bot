import { describe, it, expect, vi } from "vitest";
import { MessageFlags } from "discord.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({ language: "en", adminUsers: ["admin"], guilds: { g1: { language: "de" } } }),
}));
vi.mock("../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));

import {
  replyError,
  replyDenied,
  requireServerAdmin,
  withErrorHandling,
  errorContentOf,
} from "../../src/bot/commands/middleware.js";
import { CommandError } from "../../src/core/utils/error.js";
import { ApiError } from "../../src/core/utils/server/access/apiClient.js";
import { runWithGuildLocale } from "../../src/core/utils/i18n.js";

function interaction(state: { deferred: boolean; replied: boolean; ephemeral?: boolean }) {
  return {
    ephemeral: null as boolean | null,
    ...state,
    user: { id: "u1" },
    member: null,
    guild: null as { id: string } | null,
    commandName: "server",
    isChatInputCommand: () => true,
    options: { getSubcommand: () => "stop", getSubcommandGroup: () => null },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deleteReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

type Payload = { embeds: { toJSON(): { title?: string; description?: string } }[] };
const firstEmbed = (mock: ReturnType<typeof vi.fn>) =>
  (mock.mock.calls[0]![0] as Payload).embeds[0]!.toJSON();

describe("replyError", () => {
  it("replies ephemerally when nothing was sent yet", async () => {
    const i = interaction({ deferred: false, replied: false });
    await replyError(i as never, "boom");
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("edits a pending ephemeral deferred reply", async () => {
    const i = interaction({ deferred: true, replied: false, ephemeral: true });
    await replyError(i as never, "boom");
    expect(i.editReply).toHaveBeenCalledTimes(1);
    expect(i.followUp).not.toHaveBeenCalled();
  });

  it("replaces a public placeholder with an ephemeral follow-up", async () => {
    const i = interaction({ deferred: true, replied: false, ephemeral: false });
    await replyError(i as never, "boom");
    expect(i.deleteReply).toHaveBeenCalledTimes(1);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("follows up ephemerally once the reply was already used", async () => {
    const i = interaction({ deferred: true, replied: true });
    await replyError(i as never, "boom");
    expect(i.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it("renders problem and recovery", async () => {
    const i = interaction({ deferred: false, replied: false });
    await replyError(i as never, { title: "Could not reach smp", problem: "No answer.", recovery: "Try later." });
    const json = firstEmbed(i.reply);
    expect(json.title).toBe("Could not reach smp");
    expect(json.description).toBe("No answer.\nTry later.");
  });

  it("swallows failures of an expired interaction", async () => {
    const i = interaction({ deferred: false, replied: false });
    i.reply.mockRejectedValue(new Error("Unknown interaction"));
    await expect(replyError(i as never, "boom")).resolves.toBeUndefined();
  });
});

describe("replyDenied", () => {
  it("names the command and subcommand and stays ephemeral", async () => {
    const i = interaction({ deferred: false, replied: false });
    await replyDenied(i as never);
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    const json = firstEmbed(i.reply);
    expect(json.title).toBe("Bot admins only");
    expect(json.description).toContain("/server stop is for bot admins");
  });

  it("uses the guild's language", async () => {
    const i = { ...interaction({ deferred: false, replied: false }), guild: { id: "g1" } };
    await replyDenied(i as never);
    expect(firstEmbed(i.reply).title).toBe("Nur für Bot-Admins");
  });
});

describe("withErrorHandling", () => {
  it("denies a non-admin before deferring, so the denial is never public", async () => {
    const run = vi.fn();
    const execute = withErrorHandling(requireServerAdmin(run));
    const i = interaction({ deferred: false, replied: false });
    await execute(i as never);
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("lets an admin through and defers", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const execute = withErrorHandling(requireServerAdmin(run));
    const i = { ...interaction({ deferred: false, replied: false }), user: { id: "admin" } };
    await execute(i as never);
    expect(i.deferReply).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("renders a CommandError as problem plus recovery", async () => {
    const execute = withErrorHandling(
      async () => {
        throw new CommandError({ problem: "No stats yet.", recovery: "Play a session first." });
      },
      { defer: false },
    );
    const i = interaction({ deferred: false, replied: false });
    await execute(i as never);
    expect(firstEmbed(i.reply).description).toBe("No stats yet.\nPlay a session first.");
  });
});

describe("errorContentOf", () => {
  const failure = new ApiError("POST /backups/restore", 500, "/home/mc/scripts/restore.sh: Permission denied");

  it("turns a 5xx from the wrapper into a localised problem without the raw body", () => {
    const content = errorContentOf(failure, "smp");
    expect(content).toEqual({
      title: "smp had a problem",
      problem: "smp answered with an error, so this did not work.",
      recovery: "Try again in a minute. If it keeps failing, tell a bot admin.",
    });
    expect(JSON.stringify(errorContentOf(failure))).not.toContain("/home/mc");
  });

  it("speaks the guild's language", () => {
    const content = runWithGuildLocale("g1", () => errorContentOf(failure, "smp"));
    expect(content.title).toBe("smp hatte ein Problem");
  });
});

import { describe, it, expect, vi } from "vitest";
import { MessageFlags } from "discord.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => ({ language: "en", guilds: {} }),
}));

import { replyError } from "../../src/bot/commands/middleware.js";

function interaction(state: { deferred: boolean; replied: boolean }) {
  return {
    ...state,
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("replyError", () => {
  it("replies ephemerally when nothing was sent yet", async () => {
    const i = interaction({ deferred: false, replied: false });
    await replyError(i as never, "boom");
    expect(i.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
  });

  it("resolves a pending deferred reply by editing it", async () => {
    const i = interaction({ deferred: true, replied: false });
    await replyError(i as never, "boom");
    expect(i.editReply).toHaveBeenCalledTimes(1);
    expect(i.followUp).not.toHaveBeenCalled();
  });

  it("follows up ephemerally once the reply was already used", async () => {
    const i = interaction({ deferred: true, replied: true });
    await replyError(i as never, "boom");
    expect(i.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it("swallows failures of an expired interaction", async () => {
    const i = interaction({ deferred: false, replied: false });
    i.reply.mockRejectedValue(new Error("Unknown interaction"));
    await expect(replyError(i as never, "boom")).resolves.toBeUndefined();
  });
});

/**
 * /help lists subcommands as "/cmd sub" with their options, and plain
 * commands with theirs.
 */
import { describe, it, expect, vi } from "vitest";
import { SlashCommandBuilder } from "discord.js";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/commands/middleware.js", () => ({
  withErrorHandling: (fn: unknown) => fn,
}));
vi.mock("../../src/core/utils/commands/commandPolicy.js", () => ({
  resolveCommandPolicy: vi.fn().mockReturnValue({ enabled: true, adminOnly: false }),
}));
vi.mock("../../src/core/utils/commands/commandUsage.js", () => ({
  commandsUsedBy: vi.fn().mockReturnValue(new Set()),
}));

import { execute } from "../../src/bot/commands/general/help.js";

function fieldsOf(editReply: ReturnType<typeof vi.fn>): { name: string; value: string }[] {
  const payload = editReply.mock.calls[0]![0] as { embeds: { toJSON(): { fields?: { name: string; value: string }[] } }[] };
  return payload.embeds[0]!.toJSON().fields ?? [];
}

describe("/help", () => {
  it("renders subcommands as '/cmd sub' with their options instead of a bare '(optional)'", async () => {
    const stats = new SlashCommandBuilder()
      .setName("stats")
      .setDescription("Show stats")
      .addSubcommand((sub) =>
        sub
          .setName("player")
          .setDescription("All-time stats")
          .addStringOption((o) => o.setName("player").setDescription("Name").setRequired(true))
          .addStringOption((o) => o.setName("stat").setDescription("Filter")),
      );
    const ping = new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Ping")
      .addStringOption((o) => o.setName("server").setDescription("Server instance"));

    const interaction = {
      user: { id: "u1" },
      guild: { id: "g1" },
      guildId: "g1",
      client: {
        commands: new Map([
          ["stats", { data: stats }],
          ["ping", { data: ping }],
        ]),
      },
      editReply: vi.fn().mockResolvedValue({ id: "m" }),
    };
    await (execute as (i: never) => Promise<void>)(interaction as never);

    const fields = fieldsOf(interaction.editReply);
    const statsDetail = fields.find((f) => f.value.includes("/stats player"))!;
    expect(statsDetail.value).toContain("`player`");
    expect(statsDetail.value).toContain("`stat`");
    const pingDetail = fields.find((f) => f.value.includes("`server`"))!;
    expect(pingDetail.value).toContain("Server instance");
  });

  it("keeps a long subcommand list inside the field limit", async () => {
    const big = new SlashCommandBuilder().setName("big").setDescription("Big");
    for (let i = 0; i < 25; i++) {
      big.addSubcommand((sub) =>
        sub.setName(`sub${i}`).setDescription("x".repeat(90)).addStringOption((o) => o.setName("a").setDescription("A")),
      );
    }
    const interaction = {
      user: { id: "u1" },
      guild: { id: "g1" },
      guildId: "g1",
      client: { commands: new Map([["big", { data: big }]]) },
      editReply: vi.fn().mockResolvedValue({ id: "m" }),
    };
    await (execute as (i: never) => Promise<void>)(interaction as never);
    for (const field of fieldsOf(interaction.editReply)) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
    }
  });
});

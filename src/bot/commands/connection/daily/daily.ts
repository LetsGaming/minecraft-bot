import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { claimDaily, type ClaimOutcome } from "@mcbot/core/utils/minecraft/dailyClaim.js";
import { createInfoEmbed } from "../../../utils/embeds/embedUtils.js";
import { buildClaimEmbed, buildCooldownEmbed, buildQueuedEmbed } from "./dailyEmbeds.js";
import { replyPrivate, withErrorHandling } from "../../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";

const claimLock = new Set<string>();

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward | Link required")
  .addStringOption((o) =>
    o
      .setName("server")
      .setDescription("Server to claim on (default: this guild's server)")
      .setAutocomplete(true),
  );

/**
 * A successful claim is public: showing off (or getting laughed at for) the
 * reward is the point of the command. Refusals and errors go to the invoker
 * only. The reply is deferred first because the online lookup and RCON
 * delivery can outlast Discord's 3 s window.
 */
export const execute = withErrorHandling(async (interaction) => {
  const userId = interaction.user.id;

  if (claimLock.has(userId)) {
    await replyPrivate(interaction, createInfoEmbed(t("daily.processing")));
    return;
  }
  claimLock.add(userId);

  try {
    const server = resolveServer(interaction);
    await respond(interaction, server.id, await claimDaily(server, userId));
  } finally {
    claimLock.delete(userId);
  }
});

async function respond(
  interaction: ChatInputCommandInteraction,
  serverId: string,
  outcome: ClaimOutcome,
): Promise<void> {
  switch (outcome.kind) {
    case "not-linked":
      throw new CommandError({
        title: t("daily.linkRequiredTitle"),
        problem: t("daily.linkRequired"),
        recovery: t("daily.linkRequiredRecovery"),
      });
    case "no-rewards":
      throw new CommandError({
        problem: t("daily.dataError"),
        recovery: t("daily.dataErrorRecovery"),
      });
    case "queue-full":
      throw new CommandError({
        title: t("daily.queueFullTitle"),
        problem: t("daily.queueFull", { max: outcome.max }),
      });
    case "cooldown":
      await replyPrivate(interaction, buildCooldownEmbed(outcome));
      return;
    case "already-claimed":
      await replyPrivate(
        interaction,
        buildCooldownEmbed({
          lastClaim: outcome.now,
          now: outcome.now,
          currentStreak: outcome.currentStreak,
        }),
      );
      return;
    case "queued":
      await interaction.editReply({
        embeds: [
          buildQueuedEmbed({
            ...outcome,
            server: serverId,
            ...(outcome.partial ? { notice: t("daily.partlyQueued", { server: serverId }) } : {}),
          }),
        ],
      });
      return;
    case "claimed":
      await interaction.editReply({ embeds: [buildClaimEmbed(outcome)] });
      return;
  }
}

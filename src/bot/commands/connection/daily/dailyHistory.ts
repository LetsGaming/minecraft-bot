/**
 * /daily-history — your recent daily claims on a server.
 *
 * The claim path has stored the last 30 rewards per user all along
 * (UserClaimData.rewards); this is the read side that finally shows
 * them: date, streak at the time, and what dropped.
 */
import { SlashCommandBuilder } from "discord.js";
import {
  loadClaimedStore,
  getServerClaims,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import { withErrorHandling } from "../../middleware.js";
import { t } from "@mcbot/core/utils/i18n.js";

const MAX_SHOWN = 15;

export const data = new SlashCommandBuilder()
  .setName("daily-history")
  .setDescription("Show your recent daily claims on a server")
  .addStringOption((o) =>
    o
      .setName("server")
      .setDescription("Server to show claims for")
      .setAutocomplete(true),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const server = resolveServer(interaction);
    const store = await loadClaimedStore();
    const record = getServerClaims(store, server.id)[interaction.user.id];

    if (!record || record.rewards.length === 0) {
      throw new Error(t("dailyHistory.none", { server: server.id }));
    }

    const recent = [...record.rewards].reverse().slice(0, MAX_SHOWN);
    const lines = recent.map((claim) => {
      const when = `<t:${Math.floor(claim.date / 1000)}:d>`;
      const items = claim.items
        .map((i) => `${i.amount}× ${i.item.replace(/_/g, " ")}`)
        .join(", ");
      return t("dailyHistory.line", {
        when,
        streak: claim.streak,
        items,
      });
    });

    const embed = createEmbed({
      title: t("dailyHistory.title", { server: server.id }),
      description: lines.join("\n"),
      color: EmbedColor.Info,
      footer: {
        text: t("dailyHistory.footer", {
          shown: recent.length,
          total: record.rewards.length,
        }),
      },
    });

    await interaction.editReply({ embeds: [embed] });
  },
  { ephemeral: true },
);

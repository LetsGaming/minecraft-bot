/**
 * /bridge: choose whether your chat is forwarded to other Discord servers.
 *
 *   /bridge optout   my messages in this server stay here (they still reach Minecraft)
 *   /bridge optin    forward my messages again
 *
 * The choice is per Discord server: opting out here does not change anything in
 * another server (relayOptOutStore). It only matters in a channel that belongs
 * to a relay group; elsewhere nothing is forwarded either way.
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling } from "../middleware.js";
import { createSuccessEmbed } from "../../utils/embeds/embedUtils.js";
import { setRelayOptOut } from "@mcbot/core/utils/stores/relayOptOutStore.js";
import { t } from "@mcbot/core/utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("bridge")
  .setDescription("Choose whether your chat is forwarded to other Discord servers")
  .addSubcommand((sc) =>
    sc.setName("optout").setDescription("Keep my messages in this server out of the cross-server relay"),
  )
  .addSubcommand((sc) =>
    sc.setName("optin").setDescription("Forward my messages in this server to the relay again"),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const guildId = interaction.guild?.id;
    if (!guildId) throw new Error(t("bridge.guildOnly"));

    const optOut = interaction.options.getSubcommand() === "optout";
    const changed = setRelayOptOut(guildId, interaction.user.id, optOut);
    const key = optOut
      ? changed ? "bridge.optedOut" : "bridge.alreadyOptedOut"
      : changed ? "bridge.optedIn" : "bridge.alreadyOptedIn";
    await interaction.editReply({
      embeds: [createSuccessEmbed(t(key), { title: t("bridge.title") })],
    });
  },
  { ephemeral: true },
);

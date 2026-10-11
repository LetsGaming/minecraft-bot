import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";

import { withErrorHandling } from "../middleware.js";
import { queryFailureText } from "../../logWatcher/queryMessages.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("seed")
  .setDescription("Get the server's world seed")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const seed = await server.getSeed();
  if (!seed.ok) throw new Error(queryFailureText(seed.reason, "seed.unavailable"));

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: t("seed.title", { server: server.id }),
        description: `\`${seed.value}\``,
      }),
    ],
  });
});

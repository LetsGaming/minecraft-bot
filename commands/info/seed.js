import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { getServerInstance } from "../../utils/server.js";
import { getGuildServer } from "../../config.js";
import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("seed")
  .setDescription("Get the server's world seed")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const serverId = interaction.options.getString("server");
  const server = serverId
    ? getServerInstance(serverId)
    : getGuildServer(interaction.guild?.id);
  if (!server) throw new Error("Server not found.");

  const seed = await server.getSeed();
  if (!seed) throw new Error("Could not retrieve the world seed.");

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: `World Seed — ${server.id}`,
        description: `\`${seed}\``,
        footer: { text: `Requested by ${interaction.user.tag}` },
      }),
    ],
  });
});

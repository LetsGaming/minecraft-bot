import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";

import { getLinkedAccount } from "@mcbot/core/utils/stores/linkUtils.js";
import { buildChunkbaseUrl } from "@mcbot/core/utils/minecraft/chunkbaseUrl.js";
import { withErrorHandling } from "../middleware.js";
import { queryFailureText } from "../../logWatcher/queryMessages.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("chunkbase")
  .setDescription("Get a Chunkbase link for the server's world seed")
  .addStringOption((o) =>
    o
      .setName("dimension")
      .setDescription("Dimension")
      .addChoices(
        { name: "Overworld", value: "overworld" },
        { name: "Nether", value: "nether" },
        { name: "End", value: "end" },
      ),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const seed = await server.getSeed();
  if (!seed.ok) throw new Error(queryFailureText(seed.reason, "seed.unavailable"));

  const dimension = interaction.options.getString("dimension") ?? "overworld";
  const linked = await getLinkedAccount(interaction.user.id);

  let coords: { x: number; z: number } | undefined;
  if (linked) {
    // The link still works without a position.
    const position = await server.getPlayerCoords(linked);
    if (position.ok) coords = position.value;
  }

  const url = buildChunkbaseUrl(seed.value, dimension, coords?.x, coords?.z);
  await interaction.editReply({
    embeds: [
      createEmbed({
        title: t("chunkbase.title", { server: server.id }),
        description: t("chunkbase.open", { url }),
      }),
    ],
  });
});

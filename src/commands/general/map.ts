import path from "path";
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getRootDir, loadJson } from "../../utils/utils.js";
import type { RawBotConfig } from "../../types/index.js";

export const data = new SlashCommandBuilder()
  .setName("map")
  .setDescription("Shows the link to the live Minecraft map (Dynmap)");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const url = await getUrl();
  if (!url) {
    const errorEmbed = createErrorEmbed(
      "The map URL is not configured. Please contact the server administrator.",
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const embed = createEmbed({
    title: "Live Minecraft Map",
    description: `You can view the live Minecraft map [here](${url}).`,
    footer: { text: `Requested by ${interaction.user.tag}` },
  });

  await interaction.editReply({ embeds: [embed] });
}

async function getUrl(): Promise<string | null> {
  const root = getRootDir();
  const configPath = path.join(root, "config.json");
  const config = (await loadJson(configPath)) as Partial<RawBotConfig>;
  return config?.commands?.map?.url ?? null;
}

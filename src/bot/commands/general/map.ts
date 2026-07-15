import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embeds/embedUtils.js";
import { loadConfig } from "@mcbot/core/config.js";

export const data = new SlashCommandBuilder()
  .setName("map")
  .setDescription("Shows the link to the live Minecraft map (Dynmap)");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const url = getUrl();
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

// Read through loadConfig() so env overrides, validation, and config
// hot-reload apply — instead of re-reading config.json from disk directly.
function getUrl(): string | null {
  const cmd = loadConfig().commands["map"];
  const opt = cmd?.options?.url;
  if (typeof opt === "string" && opt) return opt;
  // Back-compat: older configs stored the URL directly as `url`.
  const legacy = (cmd as { url?: unknown } | undefined)?.url;
  return typeof legacy === "string" && legacy ? legacy : null;
}

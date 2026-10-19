import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import { loadConfig } from "@mcbot/core/config.js";
import { isRecord } from "@mcbot/core/utils/objects.js";
import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("map")
  .setDescription("Shows the link to the live Minecraft map (Dynmap)");

export const execute = withErrorHandling(async (interaction) => {
  const url = getUrl();
  if (!url) {
    throw new CommandError({
      problem: t("map.notConfigured"),
      recovery: t("map.notConfiguredRecovery"),
    });
  }

  await interaction.editReply({
    embeds: [
      createEmbed({
        title: t("map.title"),
        description: t("map.description", { url }),
      }),
    ],
  });
});

function getUrl(): string | null {
  const cmd = loadConfig().commands["map"];
  const opt = cmd?.options?.url;
  if (typeof opt === "string" && opt) return opt;
  // Back-compat: older configs stored the URL directly as `url`.
  const legacy = isRecord(cmd) ? cmd["url"] : undefined;
  return typeof legacy === "string" && legacy ? legacy : null;
}

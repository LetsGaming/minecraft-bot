import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import { loadConfig } from "@mcbot/core/config.js";

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

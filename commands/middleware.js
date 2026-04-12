import { MessageFlags } from "discord.js";
import { createErrorEmbed } from "../utils/embedUtils.js";
import { log } from "../utils/logger.js";

/**
 * Wraps a slash command execute function with:
 * - Auto deferReply
 * - Standardized error handling with error embed
 * - Logging
 */
export function withErrorHandling(execute, { defer = true, ephemeral = false } = {}) {
  return async (interaction) => {
    try {
      if (defer) {
        await interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      }
      await execute(interaction);
    } catch (err) {
      log.error("command", `/${interaction.commandName}: ${err.message}`);
      const embed = createErrorEmbed(err.message || "An unexpected error occurred.");
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
      } catch { /* interaction expired */ }
    }
  };
}

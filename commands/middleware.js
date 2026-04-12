import { MessageFlags } from "discord.js";
import { createErrorEmbed } from "../utils/embedUtils.js";
import { log } from "../utils/logger.js";
import { loadConfig } from "../config.js";

/**
 * Checks whether a Discord user ID is listed in config.adminUsers.
 */
export function isServerAdmin(discordUserId) {
  const cfg = loadConfig();
  const admins = cfg.adminUsers || [];
  return admins.includes(discordUserId);
}

/**
 * Middleware that gates a command behind server admin status.
 * Must be used AFTER deferReply (i.e. inside withErrorHandling).
 * Throws an error if the user's Discord ID is not in config.adminUsers.
 */
export function requireServerAdmin(execute) {
  return async (interaction) => {
    if (!isServerAdmin(interaction.user.id)) {
      throw new Error("You do not have permission to use this command.");
    }
    return execute(interaction);
  };
}

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

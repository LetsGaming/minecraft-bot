import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { createErrorEmbed } from "../utils/embedUtils.js";
import { log } from "../utils/logger.js";
import { loadConfig } from "../config.js";

/**
 * Checks whether a Discord user ID is listed in config.adminUsers.
 */
export function isServerAdmin(discordUserId: string): boolean {
  const cfg = loadConfig();
  const admins = cfg.adminUsers;
  return admins.includes(discordUserId);
}

type CommandExecutor = (
  interaction: ChatInputCommandInteraction,
) => Promise<void>;

/**
 * Middleware that gates a command behind server admin status.
 * Must be used AFTER deferReply (i.e. inside withErrorHandling).
 */
export function requireServerAdmin(execute: CommandExecutor): CommandExecutor {
  return async (interaction) => {
    if (!isServerAdmin(interaction.user.id)) {
      throw new Error("You do not have permission to use this command.");
    }
    return execute(interaction);
  };
}

interface ErrorHandlingOptions {
  defer?: boolean;
  ephemeral?: boolean;
}

/**
 * Wraps a slash command execute function with:
 * - Auto deferReply
 * - Standardized error handling with error embed
 * - Logging
 */
export function withErrorHandling(
  execute: CommandExecutor,
  { defer = true, ephemeral = false }: ErrorHandlingOptions = {},
): CommandExecutor {
  return async (interaction) => {
    try {
      if (defer) {
        await interaction.deferReply(
          ephemeral ? { flags: MessageFlags.Ephemeral } : {},
        );
      }
      await execute(interaction);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      log.error("command", `/${interaction.commandName}: ${message}`);
      const embed = createErrorEmbed(message);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [embed] });
        } else {
          await interaction.reply({
            embeds: [embed],
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch {
        /* interaction expired */
      }
    }
  };
}

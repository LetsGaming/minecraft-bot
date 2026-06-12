import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { createErrorEmbed } from "../utils/embedUtils.js";
import { log } from "../utils/logger.js";
import { loadConfig } from "../config.js";

/**
 * Checks whether a Discord user is an admin.
 *
 * F-02: `config.adminUsers` may contain user IDs *and* role IDs (both are
 * snowflakes, so no config format change is needed). A user is an admin if
 * their own ID is listed or if they carry any listed role. Pure-ID callers
 * (no roles available) keep working — role matching is simply skipped.
 */
export function isServerAdmin(
  discordUserId: string,
  memberRoleIds: readonly string[] = [],
): boolean {
  const cfg = loadConfig();
  const admins = cfg.adminUsers;
  return (
    admins.includes(discordUserId) ||
    memberRoleIds.some((roleId) => admins.includes(roleId))
  );
}

/**
 * Extract the role IDs from an interaction's member, handling both the
 * cached GuildMember shape (roles.cache Map) and the raw API shape
 * (roles as a string array).
 */
export function getMemberRoleIds(
  interaction: ChatInputCommandInteraction,
): string[] {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  return [...roles.cache.keys()];
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
    // F-02: pass the member's roles so role-based admin entries match.
    if (!isServerAdmin(interaction.user.id, getMemberRoleIds(interaction))) {
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

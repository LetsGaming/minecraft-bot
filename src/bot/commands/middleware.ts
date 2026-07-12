import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { createErrorEmbed } from "../utils/embedUtils.js";
import { log } from "@mcbot/core/utils/logger.js";
import { loadConfig } from "@mcbot/core/config.js";
import { runWithGuildLocale } from "@mcbot/core/utils/i18n.js";

/**
 * Checks whether a Discord user is an admin.
 *
 * Admin lists may contain user IDs and role IDs (both are snowflakes): a
 * user qualifies if their ID is listed or they carry a listed role.
 *
 * Two scopes exist: `config.adminUsers` is operator level and valid
 * everywhere; `config.guilds[guildId].adminUsers` only counts for commands
 * issued from that guild (and, via resolveServer, only against servers the
 * guild may target). In DMs only the global list applies.
 */
export function isServerAdmin(
  discordUserId: string,
  memberRoleIds: readonly string[] = [],
  guildId?: string,
): boolean {
  const cfg = loadConfig();
  const matches = (list: readonly string[] | undefined): boolean =>
    !!list &&
    (list.includes(discordUserId) ||
      memberRoleIds.some((roleId) => list.includes(roleId)));

  if (matches(cfg.adminUsers)) return true;
  if (guildId && matches(cfg.guilds?.[guildId]?.adminUsers)) return true;
  return false;
}

/**
 * Extract the role IDs from an interaction's member, handling both the
 * cached GuildMember shape (roles.cache Map) and the raw API shape
 * (roles as a string array).
 *
 * Typed by the only field it reads — `member` — so any interaction that
 * carries one (chat command, button, autocomplete) can be passed directly,
 * with no force-cast between discord.js's separate interaction classes.
 */
export function getMemberRoleIds(
  interaction: Pick<ChatInputCommandInteraction, "member">,
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
    // Roles make role-based admin entries match; the guild ID scopes
    // per-guild admin lists to their own guild.
    if (
      !isServerAdmin(
        interaction.user.id,
        getMemberRoleIds(interaction),
        interaction.guild?.id,
      )
    ) {
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
      // Every t() call inside the command resolves this guild's language
      // (guilds.<id>.language, falling back to the global setting).
      await runWithGuildLocale(interaction.guild?.id, () =>
        execute(interaction),
      );
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

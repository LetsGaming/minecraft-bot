import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type RepliableInteraction,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds/embedUtils.js";
import { EmbedColor } from "../utils/embeds/embedColors.js";
import { log } from "@mcbot/core/utils/logger.js";
import { loadConfig } from "@mcbot/core/config.js";
import { runWithGuildLocale, t } from "@mcbot/core/utils/i18n.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import type { ErrorContent } from "@mcbot/core/types/index.js";
import { attachFollowUpHint } from "../utils/hints/followUps.js";

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
 * Typed by the only field it reads, `member`, so any interaction that
 * carries one (chat command, button, autocomplete) can be passed directly.
 */
export function getMemberRoleIds(
  interaction: Pick<ChatInputCommandInteraction, "member">,
): string[] {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  return [...roles.cache.keys()];
}

function invokerIsAdmin(interaction: RepliableInteraction): boolean {
  return isServerAdmin(
    interaction.user.id,
    getMemberRoleIds(interaction),
    interaction.guild?.id,
  );
}

type CommandExecutor = (
  interaction: ChatInputCommandInteraction,
) => Promise<void>;

// Commands call withErrorHandling while this module may still be loading
// (import cycle through the hint registry), so the marker comes from a
// hoisted function rather than a module-level const.
function adminGate(): symbol {
  return Symbol.for("mcbot.adminGate");
}

type GatedExecutor = CommandExecutor & Record<symbol, true | undefined>;

/**
 * Gates a command behind bot-admin status. Inside `withErrorHandling` the
 * check runs before the reply is deferred, so a denial is never public.
 */
export function requireServerAdmin(execute: CommandExecutor): CommandExecutor {
  const gated = (async (interaction: ChatInputCommandInteraction) => {
    if (!invokerIsAdmin(interaction)) {
      await replyDenied(interaction);
      return;
    }
    return execute(interaction);
  }) as GatedExecutor;
  gated[adminGate()] = true;
  return gated;
}

async function send(
  interaction: RepliableInteraction,
  payload: { embeds: ReturnType<typeof createEmbed>[] },
): Promise<void> {
  try {
    if (interaction.deferred && !interaction.replied) {
      if (interaction.ephemeral) {
        await interaction.editReply(payload);
        return;
      }
      // A public "thinking..." placeholder cannot turn ephemeral, so it is
      // removed and the message goes out as an ephemeral follow-up instead.
      await interaction.deleteReply().catch(() => undefined);
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  } catch {
    /* interaction expired */
  }
}

/**
 * Shows an error to the invoker only: problem, then recovery. A pending
 * deferred reply is resolved, so no "thinking..." placeholder is left behind.
 */
export async function replyError(
  interaction: RepliableInteraction,
  content: string | ErrorContent,
): Promise<void> {
  await send(interaction, { embeds: [createErrorEmbed(content)] });
}

/** The one denial shape: who may use the command and what to do instead. */
export async function replyDenied(interaction: RepliableInteraction): Promise<void> {
  const command = interaction.isChatInputCommand() ? interaction.commandName : undefined;
  const guildId = interaction.guild?.id;
  const embed = createEmbed({
    title: t("denied.title", {}, guildId),
    description: command
      ? t("denied.command", { command }, guildId)
      : t("denied.action", {}, guildId),
    color: EmbedColor.Error,
  });
  await send(interaction, { embeds: [embed] });
}

/** What a thrown value should say to the user. */
export function errorContentOf(err: unknown): ErrorContent {
  if (err instanceof CommandError) {
    return { title: err.title, problem: err.problem, recovery: err.recovery };
  }
  if (err instanceof Error && err.message) return { problem: err.message };
  return {
    problem: t("common.unexpectedError"),
    recovery: t("common.unexpectedErrorRecovery"),
  };
}

interface ErrorHandlingOptions {
  defer?: boolean;
  ephemeral?: boolean;
}

/**
 * Wraps a slash command execute function with:
 * - the admin check of `requireServerAdmin`, before anything is sent
 * - auto deferReply
 * - per-guild language for every t() call inside the command
 * - standardized, ephemeral error replies and logging
 */
export function withErrorHandling(
  execute: CommandExecutor,
  { defer = true, ephemeral = false }: ErrorHandlingOptions = {},
): CommandExecutor {
  const gated = (execute as GatedExecutor)[adminGate()] === true;
  return async (interaction) => {
    const guildId = interaction.guild?.id;
    try {
      if (gated && !invokerIsAdmin(interaction)) {
        await runWithGuildLocale(guildId, () => replyDenied(interaction));
        return;
      }
      if (defer) {
        await interaction.deferReply(
          ephemeral ? { flags: MessageFlags.Ephemeral } : {},
        );
      }
      // Every t() call inside the command resolves this guild's language
      // (guilds.<id>.language, falling back to the global setting).
      await runWithGuildLocale(guildId, () => execute(interaction));

      // Only a command that answered without throwing may carry a hint;
      // an errored command never advertises anything.
      await runWithGuildLocale(guildId, () => attachFollowUpHint(interaction));
    } catch (err) {
      await runWithGuildLocale(guildId, async () => {
        const content = errorContentOf(err);
        log.error("command", `/${interaction.commandName}: ${content.problem}`);
        await replyError(interaction, content);
      });
    }
  };
}

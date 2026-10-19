import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type RepliableInteraction,
} from "discord.js";
import { createEmbed, createErrorEmbed } from "../utils/embeds/embedUtils.js";
import { EmbedColor } from "../utils/embeds/embedColors.js";
import { log } from "@mcbot/core/utils/logger.js";
import { runWithGuildLocale, t } from "@mcbot/core/utils/i18n.js";
import { CommandError, errMsg } from "@mcbot/core/utils/error.js";
import {
  classifyTransportError,
  classifyWrapperRejection,
  type WrapperRejection,
} from "@mcbot/core/utils/server/transportError.js";
import type { ErrorContent } from "@mcbot/core/types/index.js";
import { attachFollowUpHint } from "../utils/hints/followUps.js";
import { resolveServer } from "../utils/guild/guildRouter.js";
import { isInvokerAdmin } from "../utils/guild/permissions.js";

type CommandExecutor = (
  interaction: ChatInputCommandInteraction,
) => Promise<void>;

/** Gated executor to the one it wraps, so `withErrorHandling` checks the gate once. */
const adminGated = new WeakMap<CommandExecutor, CommandExecutor>();

/**
 * Gates a command behind bot-admin status. Inside `withErrorHandling` the
 * check runs before the reply is deferred, so a denial is never public.
 */
export function requireServerAdmin(execute: CommandExecutor): CommandExecutor {
  const gated: CommandExecutor = async (interaction) => {
    if (!isInvokerAdmin(interaction)) {
      await replyDenied(interaction);
      return;
    }
    return execute(interaction);
  };
  adminGated.set(gated, execute);
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

/** Shows a non-error notice to the invoker only, resolving a pending deferred reply. */
export async function replyPrivate(
  interaction: RepliableInteraction,
  embed: ReturnType<typeof createEmbed>,
): Promise<void> {
  await send(interaction, { embeds: [embed] });
}

/** The one denial shape: who may use the command and what to do instead. */
export async function replyDenied(interaction: RepliableInteraction): Promise<void> {
  const command = interaction.isChatInputCommand()
    ? [
        interaction.commandName,
        interaction.options.getSubcommandGroup(false),
        interaction.options.getSubcommand(false),
      ]
        .filter(Boolean)
        .join(" ")
    : undefined;
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

const REJECTION_PREFIX: Record<WrapperRejection, string> = {
  denied: "transport.denied",
  "not-found": "transport.notFound",
  refused: "transport.refused",
};

/** Title and problem from `<prefix>Title`/`<prefix>Problem`, or their NoServer forms. */
function wrapperContent(prefix: string, serverId: string | undefined, recovery: string): ErrorContent {
  return serverId
    ? {
        title: t(`${prefix}Title`, { server: serverId }),
        problem: t(`${prefix}Problem`, { server: serverId }),
        recovery,
      }
    : {
        title: t(`${prefix}TitleNoServer`),
        problem: t(`${prefix}ProblemNoServer`),
        recovery,
      };
}

/**
 * What a thrown value should say to the user. `serverId` names the server in
 * a transport failure; without it the reply says "the server".
 */
export function errorContentOf(err: unknown, serverId?: string): ErrorContent {
  if (err instanceof CommandError) {
    return { title: err.title, problem: err.problem, recovery: err.recovery };
  }
  const transport = classifyTransportError(err);
  if (transport === "wrapper-error") {
    return wrapperContent("transport.wrapperError", serverId, t("transport.recovery"));
  }
  if (transport) {
    const recovery =
      transport === "rate-limited" ? t("transport.recoveryRateLimited") : t("transport.recovery");
    return serverId
      ? {
          title: t("transport.title", { server: serverId }),
          problem: t("transport.problem", { server: serverId }),
          recovery,
        }
      : {
          title: t("transport.titleNoServer"),
          problem: t("transport.problemNoServer"),
          recovery,
        };
  }
  const rejection = classifyWrapperRejection(err);
  if (rejection) {
    const prefix = REJECTION_PREFIX[rejection];
    return wrapperContent(prefix, serverId, t(`${prefix}Recovery`));
  }
  if (err instanceof Error && err.message) return { problem: err.message };
  return {
    problem: t("common.unexpectedError"),
    recovery: t("common.unexpectedErrorRecovery"),
  };
}

/** The server a failed command targeted, when the failure was reaching it. */
function serverIdOf(interaction: ChatInputCommandInteraction, err: unknown): string | undefined {
  if (!classifyTransportError(err) && !classifyWrapperRejection(err)) return undefined;
  try {
    return resolveServer(interaction).id;
  } catch {
    return undefined;
  }
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
  const inner = adminGated.get(execute);
  const run = inner ?? execute;
  return async (interaction) => {
    const guildId = interaction.guild?.id;
    try {
      if (inner && !isInvokerAdmin(interaction)) {
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
      await runWithGuildLocale(guildId, () => run(interaction));

      // Only a command that answered without throwing may carry a hint;
      // an errored command never advertises anything.
      await runWithGuildLocale(guildId, () => attachFollowUpHint(interaction));
    } catch (err) {
      await runWithGuildLocale(guildId, async () => {
        const content = errorContentOf(err, serverIdOf(interaction, err));
        log.error("command", `/${interaction.commandName}: ${errMsg(err)}`);
        await replyError(interaction, content);
      });
    }
  };
}

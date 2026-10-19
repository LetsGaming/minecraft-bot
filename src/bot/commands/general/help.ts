import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
} from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import type { BotClient } from "@mcbot/core/types/index.js";
import { isRecord } from "@mcbot/core/utils/objects.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import { commandsUsedBy } from "@mcbot/core/utils/commands/commandUsage.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { withErrorHandling } from "../middleware.js";
import { pageBy, replyPaged } from "../shared/paged.js";

const COMMANDS_PER_PAGE = 5;
/** Discord's limit for one embed field value. */
const FIELD_VALUE_MAX = 1024;

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all available commands with descriptions and options");

interface HelpOption {
  name: string;
  description: string;
  required: boolean;
}

interface HelpEntry {
  /** What the user types, without the slash: "stats player". */
  path: string;
  description: string;
  options: HelpOption[];
}

/** Reads one option builder by narrowing its fields; `required` only exists on basic options. */
function readOption(opt: unknown): HelpOption[] {
  if (!isRecord(opt)) return [];
  const { name, description, required } = opt;
  if (typeof name !== "string" || typeof description !== "string") return [];
  return [{ name, description, required: required === true }];
}

function readOptions(opts: readonly unknown[]): HelpOption[] {
  return opts.flatMap(readOption);
}

/** The command itself, followed by one entry per subcommand when it has any. */
function helpEntries(name: string, description: string, rawOptions: readonly unknown[]): HelpEntry[] {
  const subcommands: HelpEntry[] = [];
  const plain: unknown[] = [];
  for (const opt of rawOptions) {
    if (opt instanceof SlashCommandSubcommandGroupBuilder) {
      for (const sub of opt.options) {
        subcommands.push({
          path: `${name} ${opt.name} ${sub.name}`,
          description: sub.description,
          options: readOptions(sub.options),
        });
      }
    } else if (opt instanceof SlashCommandSubcommandBuilder) {
      subcommands.push({
        path: `${name} ${opt.name}`,
        description: opt.description,
        options: readOptions(opt.options),
      });
    } else {
      plain.push(opt);
    }
  }
  return subcommands.length > 0
    ? subcommands
    : [{ path: name, description, options: readOptions(plain) }];
}

function clampField(text: string): string {
  return text.length <= FIELD_VALUE_MAX ? text : `${text.slice(0, FIELD_VALUE_MAX - 1)}…`;
}

function describeEntry(entry: HelpEntry, subcommand: boolean, guildId: string | undefined): string {
  const marker = (opt: HelpOption) =>
    opt.required ? t("help.required", {}, guildId) : t("help.optional", {}, guildId);
  if (subcommand) {
    const options = entry.options.map((opt) => `\`${opt.name}\` ${marker(opt)}`).join(", ");
    return `• \`/${entry.path}\`: ${entry.description}${options ? `\n  ${options}` : ""}`;
  }
  return entry.options
    .map((opt) => `• \`${opt.name}\`: ${opt.description} ${marker(opt)}`)
    .join("\n");
}

export const execute = withErrorHandling(
  async (interaction) => {
    // Hide commands that are disabled for THIS guild: /help should match
    // what the guild can actually run (registration is enabled-anywhere).
    const commands = [
      // The running client is always the BotClient branded at startup; this
      // reads the `commands` map discord.js doesn't type on the base Client.
      ...(interaction.client as BotClient).commands.values(),
    ].filter(
      (cmd) =>
        resolveCommandPolicy(cmd.data.name, { guildId: interaction.guild?.id })
          .enabled,
    );
    // Commands the user has never run come first; ties keep their order.
    const guildId = interaction.guildId ?? undefined;
    const used = commandsUsedBy(interaction.user.id);
    const unseen = commands.filter((cmd) => !used.has(cmd.data.name));
    const seen = commands.filter((cmd) => used.has(cmd.data.name));

    const embeds = pageBy([...unseen, ...seen], COMMANDS_PER_PAGE).map((pageCommands, pageIndex) => {
      const embed = createEmbed({
        title: t("help.title", {}, guildId),
        ...(pageIndex === 0 && unseen.length > 0
          ? { description: t("help.newToYou", { count: unseen.length }, guildId) }
          : {}),
      });

      for (const command of pageCommands) {
        const { name, description } = command.data;
        const rawOptions: readonly unknown[] = "options" in command.data ? command.data.options : [];
        const entries = helpEntries(name, description, rawOptions);
        const hasSubcommands = entries[0]?.path !== name;

        embed.addFields({
          name: used.has(name) ? `/${name}` : `/${name} ✨`,
          value: description,
          inline: false,
        });
        const detail = entries
          .map((entry) => describeEntry(entry, hasSubcommands, guildId))
          .filter(Boolean)
          .join("\n");
        if (detail) {
          embed.addFields({
            name: t("help.options", {}, guildId),
            value: clampField(detail),
            inline: false,
          });
        }
      }
      return embed;
    });

    await replyPaged(interaction, embeds);
  },
  { ephemeral: true },
);

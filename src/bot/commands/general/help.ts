import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";
import type { BotClient } from "@mcbot/core/types/index.js";
import { log } from "@mcbot/core/utils/logger.js";
import { isRecord } from "@mcbot/core/utils/objects.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import { commandsUsedBy } from "@mcbot/core/utils/commands/commandUsage.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { errMsg } from "@mcbot/core/utils/error.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all available commands with descriptions and options");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Hide commands that are disabled for THIS guild — /help should match
  // what the guild can actually run (registration is enabled-anywhere).
  const commands = [
    // The running client is always the BotClient we branded at startup; this
    // reads the `commands` map discord.js doesn't type on the base Client.
    ...(interaction.client as BotClient).commands.values(),
  ].filter(
    (cmd) =>
      resolveCommandPolicy(cmd.data.name, { guildId: interaction.guild?.id })
        .enabled,
  );
  // Sort what the user has never run to the front.
  //
  // /help was a reference list: every command, alphabetical, and the
  // interesting ones buried on page 4 where nobody looked. Leading with
  // the unfamiliar turns it into a recommendation without hiding anything
  // — the full list is still here, just ordered by what is new to *this*
  // reader. Ties keep their original order, so the listing stays stable.
  const used = commandsUsedBy(interaction.user.id);
  const unseen = commands.filter((cmd) => !used.has(cmd.data.name));
  const seen = commands.filter((cmd) => used.has(cmd.data.name));
  const ordered = [...unseen, ...seen];

  const pageSize = 5;
  const totalPages = Math.ceil(ordered.length / pageSize);

  const embeds = [];

  for (let i = 0; i < totalPages; i++) {
    const embed = createEmbed({
      title: `📖 Command Help (Page ${i + 1}/${totalPages})`,
      ...(i === 0 && unseen.length > 0
        ? { description: t("help.newToYou", { count: unseen.length }) }
        : {}),
    });

    const pageCommands = ordered.slice(i * pageSize, (i + 1) * pageSize);
    for (const command of pageCommands) {
      const cmdData = command.data;
      const { name, description } = cmdData;
      // Read option metadata by narrowing each entry rather than casting the
      // whole list: builder option objects expose name/description/required at
      // runtime, and `required` only exists on basic option types.
      const rawOptions: unknown[] = "options" in cmdData ? cmdData.options : [];
      const options = rawOptions.flatMap((opt) => {
        if (!isRecord(opt)) return [];
        const { name: optName, description: optDescription, required } = opt;
        if (typeof optName !== "string" || typeof optDescription !== "string") {
          return [];
        }
        return [
          {
            name: optName,
            description: optDescription,
            required: typeof required === "boolean" ? required : undefined,
          },
        ];
      });

      embed.addFields({
        name: used.has(name) ? `/${name}` : `/${name} ✨`,
        value: `**Description:**\n${description}`,
        inline: false,
      });

      if (options.length > 0) {
        const optionList = options
          .map((opt) => {
            const required = opt.required ? "**(required)**" : "(optional)";
            return `• \`${opt.name}\`: ${opt.description} ${required}`;
          })
          .join("\n");

        embed.addFields({
          name: "Options",
          value: optionList,
          inline: false,
        });
      }
    }

    embeds.push(embed);
  }

  await interaction.reply({
    embeds: [embeds[0]!],
    components: totalPages > 1 ? [createPaginationButtons(0, totalPages)] : [],
    flags: MessageFlags.Ephemeral,
  });

  let message;
  try {
    message = await interaction.fetchReply();
  } catch (err) {
    log.warn("help", `Could not fetch interaction reply: ${errMsg(err)}`);
    return;
  }

  if (totalPages > 1 && message) {
    await handlePagination(message, interaction, embeds);
  }
}

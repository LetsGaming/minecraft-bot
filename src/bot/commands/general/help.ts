import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embedUtils.js";
import type { BotClient } from "@mcbot/core/types/index.js";
import { log } from "@mcbot/core/utils/logger.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commandPolicy.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all available commands with descriptions and options");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  // Hide commands that are disabled for THIS guild — /help should match
  // what the guild can actually run (registration is enabled-anywhere).
  const commands = [
    ...(interaction.client as BotClient).commands.values(),
  ].filter(
    (cmd) =>
      resolveCommandPolicy(cmd.data.name, { guildId: interaction.guild?.id })
        .enabled,
  );
  const pageSize = 5;
  const totalPages = Math.ceil(commands.length / pageSize);

  const embeds = [];

  for (let i = 0; i < totalPages; i++) {
    const embed = createEmbed({
      title: `📖 Command Help (Page ${i + 1}/${totalPages})`,
    });

    const pageCommands = commands.slice(i * pageSize, (i + 1) * pageSize);
    for (const command of pageCommands) {
      const cmdData = command.data;
      const { name, description } = cmdData;
      const options =
        "options" in cmdData
          ? (cmdData.options as unknown as Array<{
              name: string;
              description: string;
              required?: boolean;
            }>)
          : [];

      embed.addFields({
        name: `/${name}`,
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
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("help", `Could not fetch interaction reply: ${msg}`);
    return;
  }

  if (totalPages > 1 && message) {
    await handlePagination(message, interaction, embeds);
  }
}

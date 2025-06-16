import { SlashCommandBuilder } from "discord.js";
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embed.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show all available commands with descriptions and options");

export async function execute(interaction) {
  const commands = [...interaction.client.commands.values()];
  const pageSize = 5;
  const totalPages = Math.ceil(commands.length / pageSize);

  const embeds = [];

  for (let i = 0; i < totalPages; i++) {
    const embed = createEmbed({
      title: `📖 Command Help (Page ${i + 1}/${totalPages})`,
    });

    const pageCommands = commands.slice(i * pageSize, (i + 1) * pageSize);
    for (const command of pageCommands) {
      const { name, description, options } = command.data;

      embed.addFields({
        name: `/${name}`,
        value: `**Description:**\n${description}`,
        inline: false,
      });

      if (options?.length > 0) {
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

  // Send the reply without deprecated fetchReply
  await interaction.reply({
    embeds: [embeds[0]],
    components: totalPages > 1 ? [createPaginationButtons(0, totalPages)] : [],
    ephemeral: true,
  });

  // Fetch the reply manually
  let message;
  try {
    message = await interaction.fetchReply();
  } catch (err) {
    console.warn("Could not fetch interaction reply:", err.message);
    return;
  }

  // Handle pagination only if multiple pages and reply fetched
  if (totalPages > 1 && message) {
    await handlePagination(message, interaction, embeds);
  }
}

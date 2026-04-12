import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { createEmbed, createErrorEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { getServerInstance } from "../../utils/server.js";
import { getServerChoices, getGuildServer } from "../../config.js";
import { withErrorHandling } from "../middleware.js";
import { execCommand } from "../../shell/execCommand.js";
import { log } from "../../utils/logger.js";

export const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Server control commands")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => sub.setName("start").setDescription("Start the server")
    .addStringOption(o => o.setName("server").setDescription("Server instance").setAutocomplete(true)))
  .addSubcommand(sub => sub.setName("stop").setDescription("Stop the server")
    .addStringOption(o => o.setName("server").setDescription("Server instance").setAutocomplete(true)))
  .addSubcommand(sub => sub.setName("restart").setDescription("Restart the server")
    .addStringOption(o => o.setName("server").setDescription("Server instance").setAutocomplete(true)));

export const execute = withErrorHandling(async (interaction) => {
  const sub = interaction.options.getSubcommand();
  const serverId = interaction.options.getString("server");
  const server = serverId
    ? getServerInstance(serverId)
    : getGuildServer(interaction.guild?.id);

  if (!server) throw new Error("Server not found.");

  const scriptMap = {
    start: "start.sh",
    stop: "shutdown.sh",
    restart: "smart_restart.sh",
  };

  const scriptDir = server.config.scriptDir || server.config.serverDir;
  const script = `${scriptDir}/${scriptMap[sub]}`;

  log.info("control", `${interaction.user.tag} → ${sub} on ${server.id}`);
  await interaction.editReply({ embeds: [createEmbed({ title: `⏳ ${sub}...`, description: `Executing ${sub} on **${server.id}**...` })] });

  try {
    await execCommand(`bash "${script}"`);
    await interaction.editReply({ embeds: [createSuccessEmbed(`Server **${server.id}** — ${sub} complete.`)] });
  } catch (err) {
    await interaction.editReply({ embeds: [createErrorEmbed(`${sub} failed: ${err}`)] });
  }
});

import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getLinkedAccount } from "../../utils/linkUtils.js";
import { getPlayerCoords } from "../../utils/playerUtils.js";

export const data = new SlashCommandBuilder()
  .setName("netherportal")
  .setDescription("Get Nether coordinates for your current Overworld position");

export async function execute(interaction) {
    await interaction.deferReply();

    const userId = interaction.user.id;
    const linkedUsername = await getLinkedAccount(userId);
    
    if (!linkedUsername) {
        const errorEmbed = createErrorEmbed("Your Discord account is not linked to any Minecraft account. Please link your account first.");
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
    }

    let playerCoords;
    try {
        playerCoords = await getPlayerCoords(linkedUsername);
    } catch (err) {
        const errorEmbed = createErrorEmbed(`Could not retrieve coordinates for linked Minecraft account \`${linkedUsername}\`. Make sure the player is online.`);
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
    }

    if (!playerCoords) {
        const errorEmbed = createErrorEmbed(`Could not retrieve coordinates for linked Minecraft account \`${linkedUsername}\`. Make sure the player is online.`);
        await interaction.editReply({ embeds: [errorEmbed] });
        return;
    }

    const overworldX = Math.floor(playerCoords.x);
    const overworldZ = Math.floor(playerCoords.z);
    const netherX = Math.floor(overworldX / 8);
    const netherZ = Math.floor(overworldZ / 8);

    const embed = createEmbed({
        title: "Nether Portal Coordinates",
        description: `To create a Nether portal at your current location, go to the following coordinates in the Nether:\n\nX: ${netherX}\nZ: ${netherZ}`,
        footer: { text: `Requested by ${interaction.user.tag}` },
    });

    await interaction.editReply({ embeds: [embed] });
}


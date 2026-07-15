import { SlashCommandBuilder } from "discord.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";

import { withErrorHandling } from "../middleware.js";
import { sanitizeForConsole } from "@mcbot/core/utils/sanitize.js";

export const data = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Send a message to the Minecraft server chat")
  .addStringOption((o) =>
    o.setName("message").setDescription("Message to send").setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const message = interaction.options.getString("message", true);
    const server = resolveServer(interaction);
    if (!server) throw new Error("Server not found.");

    // /say is open to every user and its input ends up on the server
    // console — a \r/\n in the display name or message could inject a second
    // command via the screen `stuff` path. Route through the same
    // sanitization the chat bridge uses.
    const { name, message: safeMessage } = sanitizeForConsole(
      interaction.user.displayName,
      message,
    );

    const mcMessage = `[${name}] ${safeMessage}`;
    await server.sendCommand(`/say ${mcMessage}`);
    await interaction.editReply(`✅ Sent to **${server.id}**: "${mcMessage}"`);
  },
  { ephemeral: true },
);

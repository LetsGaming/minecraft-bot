import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";

// Regex: [time] [Server thread/INFO]: <Player> message
const CHAT_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)>\s+(.+)/;

export function registerChatBridge(logWatcher, client, guildConfigs) {
  logWatcher.register(CHAT_REGEX, async (match) => {
    const [, player, message] = match;
    if (message.startsWith("!")) return; // Don't bridge commands

    const serverId = logWatcher.server.id;

    for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
      const bridge = gcfg.chatBridge;
      if (!bridge?.channelId) continue;
      if (bridge.server && bridge.server !== serverId) continue;

      try {
        const channel = await client.channels.fetch(bridge.channelId);
        if (!channel) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const embed = new EmbedBuilder()
          .setAuthor({ name: player, iconURL: head })
          .setDescription(message)
          .setColor(0x55ff55)
          .setTimestamp();

        if (Object.keys(guildConfigs).length > 1 || Object.keys(logWatcher.server.config).length > 1) {
          embed.setFooter({ text: serverId });
        }

        await channel.send({ embeds: [embed] });
      } catch (err) {
        log.error("chatBridge", `Failed to send to guild ${guildId}: ${err.message}`);
      }
    }
  });
}

/**
 * Set up Discord → Minecraft bridge for a channel.
 * Call this once per guild during initialization.
 */
export function setupDiscordToMc(client, guildConfigs, getServerInstance) {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const guildId = msg.guild?.id;
    if (!guildId) return;

    const gcfg = guildConfigs[guildId];
    if (!gcfg?.chatBridge?.channelId) return;
    if (msg.channel.id !== gcfg.chatBridge.channelId) return;

    const serverId = gcfg.chatBridge.server || "default";
    const server = getServerInstance(serverId);
    if (!server) return;

    const content = msg.content.replace(/"/g, '\\"').slice(0, 200);
    await server.sendCommand(`/say [${msg.author.displayName}] ${content}`);
  });
}

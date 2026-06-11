import { type Client } from "discord.js";
import { log } from "../../utils/logger.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { ServerInstance } from "../../utils/server.js";
import type { GuildConfig } from "../../types/index.js";
import { sanitizeForConsole } from "../../utils/sanitize.js";

const CHAT_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)>\s+(.+)/;

export function registerChatBridge(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  logWatcher.register(CHAT_REGEX, async (match) => {
    const [, player, message] = match;
    if (!player || !message) return;
    if (message.startsWith("!")) return;

    const serverId = logWatcher.server.id;

    for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
      const bridge = gcfg.chatBridge;
      if (!bridge?.channelId) continue;
      if (bridge.server && bridge.server !== serverId) continue;

      try {
        const channel = await client.channels.fetch(bridge.channelId);
        if (!channel || !("send" in channel)) continue;

        const embed = createPlayerEmbed(player, {
          description: message,
          color: 0x00bfff,
          ...(Object.keys(guildConfigs).length > 1
            ? { footer: { text: serverId } }
            : {}),
        });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("chatBridge", `Failed to send to guild ${guildId}: ${msg}`);
      }
    }
  });
}

/**
 * Set up Discord → Minecraft bridge for a channel.
 */
export function setupDiscordToMc(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  getServerInstance: (id: string | undefined) => ServerInstance | null,
): void {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const guildId = msg.guild?.id;
    if (!guildId) return;

    const gcfg = guildConfigs[guildId];
    if (!gcfg?.chatBridge?.channelId) return;
    if (msg.channel.id !== gcfg.chatBridge.channelId) return;

    // M-06: fall back to the guild's configured default server, not the
    // literal ID "default" (no instance is ever named that in multi-server
    // configs). If neither is set, the resolver picks the first instance.
    const serverId = gcfg.chatBridge.server ?? gcfg.defaultServer;
    const server = getServerInstance(serverId);
    if (!server) return;

    // B-08 / H-02 / M-07: strip control characters (incl. \r\n which could
    // inject extra commands via the screen fallback path) and cap lengths,
    // while keeping printable Unicode so umlauts/emoji survive the bridge.
    const { name: safeName, message: safeContent } = sanitizeForConsole(
      msg.author.displayName,
      msg.content,
    );
    await server.sendCommand(`/say [${safeName}] ${safeContent}`);
  });
}

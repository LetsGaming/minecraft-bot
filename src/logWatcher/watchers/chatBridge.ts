import { type Client } from "discord.js";
import { log } from "../../utils/logger.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { ServerInstance } from "../../utils/server.js";
import type { GuildConfig, GuildChatBridgeConfig } from "../../types/index.js";
import { sanitizeForConsole } from "../../utils/sanitize.js";
import { createRateLimiter } from "../../utils/rateLimiter.js";

const CHAT_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)>\s+(.+)/;

// The bridge listens on messageCreate, so the slash-command limiter never
// sees it — it needs its own bucket or any member could flood the game
// console at Discord message speed. Burst of 8, ~0.8 msg/s sustained:
// fine for lively chat, stops floods.
const bridgeLimiter = createRateLimiter({ capacity: 8, windowMs: 10_000 });

/** A bridge after normalization: one channel ↔ exactly one server. */
export interface ResolvedBridge {
  channelId: string;
  serverId: string;
}

/**
 * Normalize a guild's chatBridge config (single object or array) into
 * unambiguous channel↔server pairs.
 *
 * Deliberately strict: one channel ↔ exactly one server, both directions,
 * so conversations from different servers can never mix in one channel.
 * `server` may only be omitted when it's unambiguous (guild defaultServer,
 * or a single configured server); anything else is a problem — skipped,
 * logged at setup, and rejected by config validation.
 */
export function resolveGuildBridges(
  gcfg: GuildConfig,
  allServerIds: string[],
): { bridges: ResolvedBridge[]; problems: string[] } {
  const raw = gcfg.chatBridge;
  const list: GuildChatBridgeConfig[] = !raw
    ? []
    : Array.isArray(raw)
      ? raw
      : [raw];

  const bridges: ResolvedBridge[] = [];
  const problems: string[] = [];
  const channelBinding = new Map<string, string>();

  for (const bridge of list) {
    if (!bridge?.channelId) continue;

    const serverId =
      bridge.server ??
      gcfg.defaultServer ??
      (allServerIds.length === 1 ? allServerIds[0] : undefined);

    if (!serverId) {
      problems.push(
        `chatBridge channel ${bridge.channelId}: multiple servers are ` +
          `configured but the bridge has no "server" and the guild has no ` +
          `"defaultServer" — set "server" so the channel is bound to ` +
          `exactly one server.`,
      );
      continue;
    }

    const existing = channelBinding.get(bridge.channelId);
    if (existing && existing !== serverId) {
      problems.push(
        `chatBridge channel ${bridge.channelId} is bound to both ` +
          `"${existing}" and "${serverId}" — one channel bridges exactly ` +
          `one server. Use a separate channel per server.`,
      );
      continue;
    }
    if (!existing) {
      channelBinding.set(bridge.channelId, serverId);
      bridges.push({ channelId: bridge.channelId, serverId });
    }
  }

  return { bridges, problems };
}

/** Log bridge misconfigurations once at setup time. */
function reportBridgeProblems(
  guildConfigs: Record<string, GuildConfig>,
  allServerIds: string[],
  tag: string,
): void {
  for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
    const { problems } = resolveGuildBridges(gcfg, allServerIds);
    for (const problem of problems) {
      log.error(tag, `Guild ${guildId}: ${problem}`);
    }
  }
}

export function registerChatBridge(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  allServerIds: string[] = [],
): void {
  reportBridgeProblems(guildConfigs, allServerIds, "chatBridge");

  logWatcher.register(CHAT_REGEX, async (match) => {
    const [, player, message] = match;
    if (!player || !message) return;
    if (message.startsWith("!")) return;

    const serverId = logWatcher.server.id;

    for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
      const { bridges } = resolveGuildBridges(gcfg, allServerIds);

      // Only channels bound to THIS server receive its chat.
      for (const bridge of bridges) {
        if (bridge.serverId !== serverId) continue;

        try {
          const channel = await client.channels.fetch(bridge.channelId);
          if (!channel || !("send" in channel)) continue;

          const embed = createPlayerEmbed(player, {
            description: message,
            color: 0x00bfff,
          });

          await channel.send({ embeds: [embed] });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(
            "chatBridge",
            `Failed to send to guild ${guildId}: ${msg}`,
          );
        }
      }
    }
  });
}

/**
 * Set up Discord → Minecraft bridges. The message's channel identifies the
 * one server it is bound to — replies always land where the conversation
 * is happening.
 */
export function setupDiscordToMc(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  getServerInstance: (id: string | undefined) => ServerInstance | null,
  allServerIds: string[] = [],
): void {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const guildId = msg.guild?.id;
    if (!guildId) return;

    const gcfg = guildConfigs[guildId];
    if (!gcfg?.chatBridge) return;

    const { bridges } = resolveGuildBridges(gcfg, allServerIds);
    const bridge = bridges.find((b) => b.channelId === msg.channel.id);
    if (!bridge) return;

    const server = getServerInstance(bridge.serverId);
    if (!server) return;

    // React instead of silently dropping so the author knows the message
    // did not reach the game.
    if (!bridgeLimiter.consumeToken(msg.author.id)) {
      msg.react("⏳").catch(() => {});
      return;
    }

    // Strip control characters (incl. \r\n, which could inject extra
    // commands via the screen fallback) and cap lengths — printable
    // Unicode stays so umlauts and emoji survive the bridge.
    const { name: safeName, message: safeContent } = sanitizeForConsole(
      msg.author.displayName,
      msg.content,
    );
    await server.sendCommand(`/say [${safeName}] ${safeContent}`);
  });
}

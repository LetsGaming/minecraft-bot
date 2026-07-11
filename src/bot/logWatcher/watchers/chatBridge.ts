import { type Client, type Webhook } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { ServerInstance } from "@mcbot/core/utils/server.js";
import type { GuildConfig, GuildChatBridgeConfig } from "@mcbot/core/types/index.js";
import { sanitizeForConsole } from "@mcbot/core/utils/sanitize.js";
import {
  createRateLimiter,
  bridgeLimiterSettings,
} from "@mcbot/core/utils/rateLimiter.js";

const CHAT_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)>\s+(.+)/;

// The bridge listens on messageCreate, so the slash-command limiter never
// sees it — it needs its own bucket or any member could flood the game
// console at Discord message speed. Burst of 8, ~0.8 msg/s sustained:
// fine for lively chat, stops floods.
// Capacity/window come from the `limits` config block (defaults 8/10s);
// the limiter shape is fixed at module load — changing limits needs a
// restart, same as the slash limiter.
const bridgeLimiter = createRateLimiter(bridgeLimiterSettings());

/** A bridge after normalization: one channel ↔ exactly one server. */
export interface ResolvedBridge {
  channelId: string;
  serverId: string;
  useWebhook?: boolean;
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
      bridges.push({
      channelId: bridge.channelId,
      serverId,
      ...(bridge.useWebhook === true ? { useWebhook: true } : {}),
    });
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

const WEBHOOK_NAME = "minecraft-bot bridge";

// channelId → webhook (null = tried and failed; retry on next reload
// only, not per message, so a missing permission can't spam the API).
const webhookCache = new Map<string, Webhook | null>();

/** Exposed for tests / reconcile. */
export function invalidateWebhookCache(): void {
  webhookCache.clear();
}

/**
 * The bridge webhook for a channel: reuse ours if it exists, create it
 * once otherwise. Returns null (cached) when the channel doesn't support
 * webhooks or the bot lacks Manage Webhooks — callers fall back to the
 * embed form.
 */
async function bridgeWebhook(
  client: Client,
  channelId: string,
): Promise<Webhook | null> {
  if (webhookCache.has(channelId)) return webhookCache.get(channelId)!;
  try {
    const channel = await client.channels.fetch(channelId);
    if (
      !channel ||
      !("fetchWebhooks" in channel) ||
      !("createWebhook" in channel)
    ) {
      webhookCache.set(channelId, null);
      return null;
    }
    const hooks = await channel.fetchWebhooks();
    const existing = hooks.find(
      (h) => h.name === WEBHOOK_NAME && h.token !== null,
    );
    const hook =
      existing ??
      (await channel.createWebhook({
        name: WEBHOOK_NAME,
        reason: "chatBridge useWebhook: player-authored bridge messages",
      }));
    webhookCache.set(channelId, hook);
    return hook;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      "chatBridge",
      `Webhook unavailable for channel ${channelId} (falling back to embeds): ${msg}`,
    );
    webhookCache.set(channelId, null);
    return null;
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
          // Webhook form: the player IS the message author (name +
          // head), which reads like a real conversation. Any webhook
          // problem degrades to the embed form instead of losing chat.
          if (bridge.useWebhook) {
            const hook = await bridgeWebhook(client, bridge.channelId);
            if (hook) {
              await hook.send({
                username: player.slice(0, 80),
                avatarURL: `https://mc-heads.net/avatar/${encodeURIComponent(player)}/64`,
                content: message.slice(0, 2000),
                allowedMentions: { parse: [] },
              });
              continue;
            }
          }

          const channel = await client.channels.fetch(bridge.channelId);
          if (!channel || !("send" in channel)) continue;

          const embed = createPlayerEmbed(player, {
            description: message,
            color: EmbedColor.Info,
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

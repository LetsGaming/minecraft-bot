/**
 * The notice that tells a bridged channel its messages are forwarded to other
 * Discord servers, and the button that opts a member out.
 *
 * One message per relayed channel, pinned when the bot is allowed to, edited
 * when the group's members change and removed when the channel stops relaying.
 * The button's customId is stable (`relay:optout:<guildId>`) so it survives
 * restarts, like the whitelist-application and hint buttons.
 */
import { createHash } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type Interaction,
} from "discord.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { setRelayOptOut } from "@mcbot/core/utils/stores/relayOptOutStore.js";
import { loadRelayNotices, setRelayNotice } from "@mcbot/core/utils/stores/relayNoticeStore.js";
import { createEmbed } from "../utils/embeds/embedUtils.js";
import { resolveGuildConfigs, type GuildConfigSource } from "../utils/guild/guildConfigs.js";
import { cleanLabel } from "../logWatcher/watchers/log/relay/identity.js";
import { resolveAllBridges, type ServerIdSource } from "../logWatcher/watchers/log/chatBridge.js";

export const RELAY_PREFIX = "relay";

export function optOutCustomId(guildId: string): string {
  return `${RELAY_PREFIX}:optout:${guildId}`;
}

/** `relay:optout:<guildId>` → the guild id, or null if the id is not ours. */
export function parseOptOutCustomId(customId: string): string | null {
  const parts = customId.split(":");
  return parts.length === 3 && parts[0] === RELAY_PREFIX && parts[1] === "optout" && parts[2]
    ? parts[2]
    : null;
}

interface NoticeTarget {
  guildId: string;
  /** Labels of the other servers the channel forwards to. */
  others: string[];
}

function noticeTargets(
  client: Client,
  guildConfigs: GuildConfigSource,
  serverIds: ServerIdSource,
): Map<string, NoticeTarget> {
  const configs = resolveGuildConfigs(guildConfigs);
  const labelOf = (guildId: string): string =>
    cleanLabel(configs[guildId]?.bridgeLabel || client.guilds?.cache?.get(guildId)?.name || "?");
  const bridges = resolveAllBridges(guildConfigs, serverIds);

  const targets = new Map<string, NoticeTarget>();
  for (const [guildId, list] of Object.entries(bridges)) {
    for (const bridge of list) {
      if (!bridge.relayGroup) continue;
      const others = new Set<string>();
      for (const [otherId, otherList] of Object.entries(bridges)) {
        if (otherId === guildId) continue;
        if (otherList.some((b) => b.relayGroup === bridge.relayGroup && b.serverId === bridge.serverId)) {
          others.add(labelOf(otherId));
        }
      }
      if (others.size > 0) targets.set(bridge.channelId, { guildId, others: [...others].sort() });
    }
  }
  return targets;
}

/** Post, refresh or remove the notices so they match the current config. Never throws. */
export async function ensureRelayNotices(
  client: Client,
  guildConfigs: GuildConfigSource,
  serverIds: ServerIdSource,
): Promise<void> {
  const targets = noticeTargets(client, guildConfigs, serverIds);
  const known = loadRelayNotices();

  for (const [channelId, record] of Object.entries(known)) {
    if (targets.has(channelId)) continue;
    await removeNotice(client, channelId, record.messageId);
    setRelayNotice(channelId, null);
  }

  for (const [channelId, target] of targets) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !("send" in channel)) continue;

      const content = await runWithGuildLocale(target.guildId, async () => ({
        embeds: [
          createEmbed({
            title: t("bridge.noticeTitle"),
            description: t("bridge.noticeBody", { servers: target.others.join(", ") }),
            category: EmbedCategory.Info,
          }),
        ],
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(optOutCustomId(target.guildId))
              .setLabel(t("bridge.optOutButton"))
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      }));
      const key = createHash("sha256")
        .update(JSON.stringify([target.guildId, target.others, content.embeds[0]!.data]))
        .digest("hex")
        .slice(0, 16);

      const existing = known[channelId];
      const message = existing
        ? await channel.messages.fetch(existing.messageId).catch(() => null)
        : null;
      if (message && existing?.key === key) continue;
      if (message) {
        await message.edit(content);
        setRelayNotice(channelId, { messageId: message.id, key });
        continue;
      }
      const sent = await channel.send(content);
      await sent.pin().catch(() => {
        log.warn("relay", `Could not pin the relay notice in channel ${channelId} (needs Manage Messages)`);
      });
      setRelayNotice(channelId, { messageId: sent.id, key });
    } catch (err) {
      log.warn("relay", `Relay notice failed in channel ${channelId}: ${errMsg(err)}`);
    }
  }
}

async function removeNotice(client: Client, channelId: string, messageId: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && "messages" in channel) await channel.messages.delete(messageId);
  } catch {
    /* the channel or message is already gone */
  }
}

/** The opt-out button on the notice. Returns true when the interaction was ours. */
export async function handleRelayInteraction(interaction: Interaction): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const guildId = parseOptOutCustomId(interaction.customId);
  if (!guildId) return false;

  await runWithGuildLocale(guildId, async () => {
    if (interaction.guildId !== guildId) {
      await interaction.reply({ content: t("bridge.guildOnly"), ephemeral: true });
      return;
    }
    const changed = setRelayOptOut(guildId, interaction.user.id, true);
    await interaction.reply({
      content: t(changed ? "bridge.optedOut" : "bridge.alreadyOptedOut"),
      ephemeral: true,
    });
  });
  return true;
}

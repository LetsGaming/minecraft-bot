/**
 * Reusable helpers for provisioning bot-managed Discord channels.
 *
 * The bot creates and owns a private category containing whatever channels
 * it needs. Users never have to configure channel IDs manually — the bot
 * finds or recreates its category and child channels on every startup.
 *
 * Permissions model:
 *   - @everyone  →  deny all (View, Connect, Send, etc.)
 *   - bot itself →  allow all
 *
 * Voice channels are used for display-only counters because their names
 * accept unicode, spaces, and emoji — unlike text channels which only allow
 * lowercase letters, numbers, and hyphens.
 */

import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type OverwriteResolvable,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ManagedCategory {
  category: CategoryChannel;
  guild: Guild;
}

export interface EnsuredTextChannel {
  channel: TextChannel;
  categoryId: string;
}

export interface EnsuredVoiceChannel {
  channel: VoiceChannel;
  categoryId: string;
}

// ─── Permissions ──────────────────────────────────────────────────────────────

/**
 * Build permission overwrites that lock a channel to the bot only.
 * @everyone is denied View/Send/Connect; the bot member is explicitly allowed.
 */
function buildBotOnlyPermissions(botUserId: string, guildId: string): OverwriteResolvable[] {
  return [
    {
      id: guildId, // @everyone role shares the guild ID
      type: OverwriteType.Role,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.Connect,
      ],
    },
    {
      id: botUserId,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
      ],
    },
  ];
}

// ─── Category ─────────────────────────────────────────────────────────────────

/**
 * Find an existing category the bot owns, or create a new one.
 * Matched by exact name — call with a consistent, unique name per feature.
 */
export async function ensureManagedCategory(
  guild: Guild,
  categoryName: string,
): Promise<ManagedCategory> {
  const botUserId = guild.client.user!.id;

  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName,
  ) as CategoryChannel | undefined;

  if (existing) return { category: existing, guild };

  const category = await guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory,
    permissionOverwrites: buildBotOnlyPermissions(botUserId, guild.id),
  });

  return { category, guild };
}

// ─── Text channel ─────────────────────────────────────────────────────────────

/**
 * Find an existing text channel by name inside a category, or create it.
 * The channel inherits the category's permission overwrites automatically.
 */
export async function ensureTextChannel(
  guild: Guild,
  categoryId: string,
  channelName: string,
  topic?: string,
): Promise<EnsuredTextChannel> {
  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildText &&
      ch.parentId === categoryId &&
      ch.name === channelName,
  ) as TextChannel | undefined;

  if (existing) return { channel: existing, categoryId };

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: categoryId,
    topic,
    // Inherit category permissions — Discord does this by default when
    // parent is set, but we set it explicitly to be certain.
    permissionOverwrites: [],
  });

  return { channel: channel as TextChannel, categoryId };
}

// ─── Voice channel ────────────────────────────────────────────────────────────

/**
 * Find an existing voice channel by name inside a category, or create it.
 *
 * Voice channels are used for display counters because they accept unicode,
 * spaces, and emoji in their names — unlike text channels.
 */
export async function ensureVoiceChannel(
  guild: Guild,
  categoryId: string,
  channelName: string,
): Promise<EnsuredVoiceChannel> {
  const existing = guild.channels.cache.find(
    (ch) =>
      ch.type === ChannelType.GuildVoice &&
      ch.parentId === categoryId &&
      ch.name === channelName,
  ) as VoiceChannel | undefined;

  if (existing) return { channel: existing, categoryId };

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: categoryId,
    permissionOverwrites: [],
  });

  return { channel: channel as VoiceChannel, categoryId };
}

// ─── Voice channel rename ─────────────────────────────────────────────────────

/**
 * Rename a voice channel only when the name has actually changed.
 * Avoids burning Discord's rate limit (2 renames/10 min per channel).
 *
 * @returns true if a rename API call was issued, false if skipped.
 */
export async function renameVoiceChannelIfChanged(
  channel: VoiceChannel,
  newName: string,
): Promise<boolean> {
  if (channel.name === newName) return false;
  await channel.setName(newName);
  return true;
}

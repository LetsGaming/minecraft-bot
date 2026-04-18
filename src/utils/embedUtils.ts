import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
  type APIEmbedField,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import type {
  EmbedOptions,
  EmbedWithThumbnailOptions,
  EmbedStyleOptions,
} from "../types/index.js";
import { log } from "./logger.js";

/**
 * Creates a customizable embed.
 */
export function createEmbed({
  title,
  description,
  color = 0x00bfff,
  footer,
  timestamp = true,
  author,
}: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color);

  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (footer?.text) embed.setFooter(footer);
  if (author) embed.setAuthor(author);
  if (timestamp === true) {
    embed.setTimestamp();
  } else if (
    timestamp instanceof Date ||
    typeof timestamp === "number" ||
    typeof timestamp === "string"
  ) {
    embed.setTimestamp(
      timestamp instanceof Date ? timestamp : new Date(timestamp),
    );
  }

  return embed;
}

/**
 * Adds multiple fields to an embed from a plain array.
 */
export function addFieldsBulk(
  embed: EmbedBuilder,
  fields: APIEmbedField[] = [],
): EmbedBuilder {
  if (!Array.isArray(fields)) return embed;
  return embed.addFields(fields);
}

/**
 * Shortcut for a standardized error embed.
 */
export function createErrorEmbed(
  message: string,
  { footer, timestamp = true }: EmbedStyleOptions = {},
): EmbedBuilder {
  return createEmbed({
    title: "❌ Error",
    description: message,
    color: 0xff5555,
    footer,
    timestamp,
  });
}

/**
 * Shortcut for a standardized success embed.
 */
export function createSuccessEmbed(
  message: string,
  { footer, timestamp = true }: EmbedStyleOptions = {},
): EmbedBuilder {
  return createEmbed({
    title: "✅ Success",
    description: message,
    color: 0x55ff55,
    footer,
    timestamp,
  });
}

/**
 * Shortcut for a standardized info embed.
 */
export function createInfoEmbed(
  message: string,
  { footer, timestamp = true }: EmbedStyleOptions = {},
): EmbedBuilder {
  return createEmbed({
    title: "ℹ️ Info",
    description: message,
    color: 0x3498db,
    footer,
    timestamp,
  });
}

/**
 * Embed with thumbnail image.
 */
export function createEmbedWithThumbnail({
  title,
  description,
  thumbnail,
  color = 0x00bfff,
  footer,
  timestamp = true,
}: EmbedWithThumbnailOptions): EmbedBuilder {
  const embed = createEmbed({ title, description, color, footer, timestamp });
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

/**
 * Generates pagination buttons based on current page state.
 */
export function createPaginationButtons(
  page: number,
  totalPages: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("first")
      .setLabel("⏮️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("◀️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1),

    new ButtonBuilder()
      .setCustomId("last")
      .setLabel("⏭️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

/**
 * Handles pagination interaction for a message using embed pages.
 */
export async function handlePagination(
  message: Message,
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  let page = 0;
  const totalPages = embeds.length;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000,
  });

  collector.on("collect", async (i: ButtonInteraction) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({
        content: "These buttons aren't for you.",
        ephemeral: true,
      });
      return;
    }

    switch (i.customId) {
      case "first":
        page = 0;
        break;
      case "prev":
        if (page > 0) page--;
        break;
      case "next":
        if (page < totalPages - 1) page++;
        break;
      case "last":
        page = totalPages - 1;
        break;
    }

    try {
      await i.update({
        embeds: [embeds[page]!],
        components: [createPaginationButtons(page, totalPages)],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("pagination", `Failed to update page: ${msg}`);
    }
  });

  collector.on("end", async () => {
    if (interaction.ephemeral) return;
    try {
      await message.edit({ components: [] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("pagination", `Failed to remove buttons after timeout: ${msg}`);
    }
  });
}

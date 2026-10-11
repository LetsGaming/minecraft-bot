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
  ErrorContent,
} from "@mcbot/core/types/index.js";
import { log } from "@mcbot/core/utils/logger.js";
import { playerAvatarUrl } from "../mcHeads.js";
import { EmbedColor } from "./embedColors.js";
import { statusCircle } from "./serverStateDisplay.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { statusEmbedColor } from "@mcbot/schema/status.js";
import { t } from "@mcbot/core/utils/i18n.js";

/** Discord's hard limits; a message over any of them is rejected outright. */
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  total: 6000,
} as const;

const ELLIPSIS = "…";

/** Cuts `text` to at most `max` characters, marking the cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - ELLIPSIS.length)) + ELLIPSIS;
}

/**
 * Creates an embed. Titles and descriptions are cut to Discord's limits so a
 * long server name or list can never make the whole reply fail. A `state`
 * puts the server-state circle in front of the title and colours the embed.
 */
export function createEmbed({
  title,
  description,
  color,
  footer,
  timestamp = false,
  author,
  state,
}: EmbedOptions): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(
    color ?? (state ? statusEmbedColor(state) : EmbedColor.Info),
  );

  if (title) {
    const full = state ? `${statusCircle(state)} ${title}` : title;
    embed.setTitle(truncate(full, EMBED_LIMITS.title));
  }
  if (description) embed.setDescription(truncate(description, EMBED_LIMITS.description));
  if (footer?.text) embed.setFooter({ ...footer, text: truncate(footer.text, EMBED_LIMITS.footer) });
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

/** Problem, then recovery, as one or two lines. */
export function errorText(content: string | ErrorContent): string {
  if (typeof content === "string") return content;
  return content.recovery ? `${content.problem}\n${content.recovery}` : content.problem;
}

/**
 * Red embed for a failure: the problem, then what to do about it. Send it
 * through `replyError`, which keeps it visible only to the invoker.
 */
export function createErrorEmbed(
  content: string | ErrorContent,
  { footer, timestamp = false }: EmbedStyleOptions = {},
): EmbedBuilder {
  const title = typeof content === "string" ? undefined : content.title;
  return createEmbed({
    title: title ?? t("embed.errorTitle"),
    description: errorText(content),
    color: EmbedColor.Error,
    footer,
    timestamp,
  });
}

/** Green embed for something that is done. No title unless one is given. */
export function createSuccessEmbed(
  message: string,
  { title, footer, timestamp = false }: EmbedStyleOptions = {},
): EmbedBuilder {
  return createEmbed({
    title,
    description: message,
    color: EmbedColor.Success,
    footer,
    timestamp,
  });
}

/** Blue embed for a neutral answer. No title unless one is given. */
export function createInfoEmbed(
  message: string,
  { title, footer, timestamp = false }: EmbedStyleOptions = {},
): EmbedBuilder {
  return createEmbed({
    title,
    description: message,
    color: EmbedColor.Info,
    footer,
    timestamp,
  });
}

/**
 * Blue embed for a job that is still running. The start time is a Discord
 * timestamp, so the elapsed time keeps counting in every client without edits.
 */
export function createProgressEmbed({
  title,
  description,
  startedAt = Date.now(),
}: {
  title: string;
  description?: string;
  startedAt?: number;
}): EmbedBuilder {
  const started = t("progress.started", {
    time: `<t:${Math.floor(startedAt / 1000)}:R>`,
  });
  return createEmbed({
    title,
    description: description ? `${description}\n${started}` : started,
    color: EmbedColor.Info,
  });
}

/**
 * Embed with thumbnail image.
 */
export function createEmbedWithThumbnail({
  thumbnail,
  ...options
}: EmbedWithThumbnailOptions): EmbedBuilder {
  const embed = createEmbed(options);
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}

export function createPlayerEmbed(
  player: string,
  options: Omit<EmbedOptions, "author">,
  asThumbnail: boolean = false,
): EmbedBuilder {
  const head = playerAvatarUrl(player);
  if (asThumbnail) {
    return createEmbedWithThumbnail({
      ...options,
      thumbnail: head,
    });
  }
  return createEmbed({
    ...options,
    author: {
      name: player,
      iconURL: head,
    },
  });
}

// ── Limit-aware paging ───────────────────────────────────────────────────────

/**
 * Packs lines into chunks of at most `maxChars` characters (joined with a
 * newline), for field values or descriptions. A single line longer than
 * the limit is cut rather than dropped.
 */
export function chunkLines(
  lines: readonly string[],
  maxChars: number = EMBED_LIMITS.fieldValue,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const raw of lines) {
    const line = truncate(raw, maxChars);
    const next = current === "" ? line : `${current}\n${line}`;
    if (next.length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

/**
 * Splits lines into description pages: at most `maxLines` lines and
 * `maxChars` characters per page. Always returns at least one page.
 */
export function paginateLines(
  lines: readonly string[],
  maxLines: number,
  maxChars: number = EMBED_LIMITS.description,
): string[] {
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    pages.push(...chunkLines(lines.slice(i, i + maxLines), maxChars));
  }
  return pages.length > 0 ? pages : [""];
}

/**
 * Splits fields into pages that each fit one embed: at most `maxFields`
 * (and never more than 25) fields, and a character total that stays under
 * 6000 together with the embed's own title, description and footer
 * (`reserved`). Names and values are cut to their limits first. Always
 * returns at least one page.
 */
export function paginateFields(
  fields: readonly APIEmbedField[],
  { maxFields = EMBED_LIMITS.fields, reserved = 0 }: { maxFields?: number; reserved?: number } = {},
): APIEmbedField[][] {
  const perPage = Math.min(maxFields, EMBED_LIMITS.fields);
  const budget = EMBED_LIMITS.total - reserved;
  const pages: APIEmbedField[][] = [];
  let page: APIEmbedField[] = [];
  let used = 0;

  for (const field of fields) {
    const safe: APIEmbedField = {
      ...field,
      name: truncate(field.name, EMBED_LIMITS.fieldName),
      value: truncate(field.value, EMBED_LIMITS.fieldValue),
    };
    const size = safe.name.length + safe.value.length;
    if (page.length > 0 && (page.length >= perPage || used + size > budget)) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(safe);
    used += size;
  }
  if (page.length > 0 || pages.length === 0) pages.push(page);
  return pages;
}

/** Characters an embed spends outside its fields, for `paginateFields`. */
export function reservedLength(parts: {
  title?: string;
  description?: string;
  footer?: string;
}): number {
  return (parts.title?.length ?? 0) + (parts.description?.length ?? 0) + (parts.footer?.length ?? 0);
}

// ── Pager ────────────────────────────────────────────────────────────────────

/** How long pager buttons answer before they are switched off. */
export const PAGINATION_TIMEOUT_MS = 3 * 60_000;

/** The page indicator: a disabled button between Previous and Next. */
export function pageFooter(page: number, totalPages: number, guildId?: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId("page")
    .setLabel(t("pagination.page", { page: page + 1, total: totalPages }, guildId))
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
}

/**
 * Previous, a disabled "Page n/m", Next. `disabled` switches the whole row
 * off, which is what happens when the pager times out: the message keeps its
 * shape instead of losing the row. Button events arrive outside the command's
 * locale context, so callers there pass the guild id.
 */
export function createPaginationButtons(
  page: number,
  totalPages: number,
  { disabled = false, guildId }: { disabled?: boolean; guildId?: string } = {},
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel(t("pagination.previous", {}, guildId))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 0),
    pageFooter(page, totalPages, guildId),
    new ButtonBuilder()
      .setCustomId("next")
      .setLabel(t("pagination.next", {}, guildId))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages - 1),
  );
}

/**
 * Drives a paged reply. `message` must be the command's own reply; when the
 * pager times out it is edited through the interaction, which also works for
 * ephemeral replies (a plain message edit does not).
 */
export async function handlePagination(
  message: Message,
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  let page = 0;
  const totalPages = embeds.length;
  const guildId = interaction.guildId ?? undefined;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: PAGINATION_TIMEOUT_MS,
  });

  collector.on("collect", async (i: ButtonInteraction) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({
        content: t("pagination.notForYou", {}, guildId),
        ephemeral: true,
      });
      return;
    }

    if (i.customId === "prev" && page > 0) page--;
    if (i.customId === "next" && page < totalPages - 1) page++;

    try {
      await i.update({
        embeds: [embeds[page]!],
        components: [createPaginationButtons(page, totalPages, { guildId })],
      });
    } catch (err) {
      log.warn("pagination", `Failed to update page: ${errMsg(err)}`);
    }
  });

  collector.on("end", async () => {
    const components = [createPaginationButtons(page, totalPages, { disabled: true, guildId })];
    try {
      await interaction.editReply({ components });
    } catch (err) {
      log.warn("pagination", `Failed to switch off buttons after timeout: ${errMsg(err)}`);
    }
  });
}

/**
 * The button half of confirmation rows (see `utils/embeds/confirm.ts`).
 *
 * Commands register what a confirmed action does; the buttons themselves
 * carry the action, server, user and expiry, so nothing is kept in memory
 * between the question and the answer and a restart in between is harmless.
 */
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
} from "discord.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import {
  CONFIRM_TTL_MS,
  createConfirmRow,
  parseConfirmCustomId,
  type ConfirmTarget,
  type ParsedConfirmId,
} from "../utils/embeds/confirm.js";
import { createInfoEmbed } from "../utils/embeds/embedUtils.js";
import {
  errorContentOf,
  replyDenied,
  replyError,
} from "../commands/middleware.js";
import { isInvokerAdmin } from "../utils/guild/permissions.js";

export type ConfirmHandler = (
  interaction: ButtonInteraction,
  target: ParsedConfirmId,
) => Promise<void>;

interface Registration {
  handler: ConfirmHandler;
  adminOnly: boolean;
  confirmLabelKey: string;
}

const registry = new Map<string, Registration>();

/**
 * Registers what pressing the danger button does. `adminOnly` re-checks the
 * presser at press time, since admin lists can change within the minute.
 */
export function registerConfirmAction(
  action: string,
  handler: ConfirmHandler,
  { adminOnly = true, confirmLabelKey }: { adminOnly?: boolean; confirmLabelKey: string },
): void {
  registry.set(action, { handler, adminOnly, confirmLabelKey });
}

function disabledRow(target: ConfirmTarget, guildId: string | undefined) {
  const label = t(registry.get(target.action)?.confirmLabelKey ?? "confirm.confirm", { server: target.serverId }, guildId);
  return createConfirmRow(target, label, { disabled: true, guildId });
}

/**
 * Switches the buttons off once they expire, so an old confirmation does not
 * look pressable. A row that was already answered is left alone.
 */
export function scheduleConfirmExpiry(
  interaction: ChatInputCommandInteraction,
  target: ConfirmTarget,
): void {
  const timer = setTimeout(async () => {
    try {
      const reply = await interaction.fetchReply();
      if (reply.components.length === 0) return;
      await interaction.editReply({
        components: [disabledRow(target, interaction.guild?.id)],
      });
    } catch {
      /* reply gone or interaction expired */
    }
  }, Math.max(0, target.expiresAt - Date.now()));
  timer.unref?.();
}

/** A new confirmation target that expires CONFIRM_TTL_MS from now. */
export function confirmTarget(
  action: string,
  serverId: string,
  userId: string,
  now: number = Date.now(),
): ConfirmTarget {
  return { action, serverId, userId, expiresAt: now + CONFIRM_TTL_MS };
}

/**
 * Returns true when the interaction was ours and has been answered, so the
 * caller stops routing it.
 */
export async function handleConfirmInteraction(
  interaction: Interaction,
  now: number = Date.now(),
): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const parsed = parseConfirmCustomId(interaction.customId);
  if (!parsed) return false;
  const guildId = interaction.guild?.id;

  await runWithGuildLocale(guildId, async () => {
    if (interaction.user.id !== parsed.userId) {
      await interaction.reply({ content: t("confirm.notYours"), ephemeral: true });
      return;
    }

    if (now > parsed.expiresAt) {
      await interaction.update({ components: [disabledRow(parsed, guildId)] });
      await interaction.followUp({ content: t("confirm.expired"), ephemeral: true });
      return;
    }

    if (parsed.answer === "no") {
      await interaction.update({
        embeds: [createInfoEmbed(t("confirm.cancelled"))],
        components: [],
      });
      return;
    }

    const entry = registry.get(parsed.action);
    if (!entry) {
      await interaction.update({ components: [] });
      return;
    }
    if (entry.adminOnly && !isInvokerAdmin(interaction)) {
      await replyDenied(interaction);
      return;
    }

    try {
      await entry.handler(interaction, parsed);
    } catch (err) {
      log.error("confirm", `${parsed.action} on ${parsed.serverId}: ${errMsg(err)}`);
      await replyError(interaction, errorContentOf(err, parsed.serverId));
    }
  });
  return true;
}

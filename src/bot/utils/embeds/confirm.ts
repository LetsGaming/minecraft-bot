/**
 * Confirmation step for destructive actions: one embed and one button row
 * (a danger action and Cancel) that expire after 60 seconds.
 *
 * customIds carry everything needed to act (`confirm:<yes|no>:<action>:
 * <serverId>:<userId>:<expiresAt>`), like the `wlapp:` and `hint:` buttons,
 * so a press is still understood after a restart and an expired press is
 * refused by the id alone. The handler lives in
 * `interactions/confirmActions.ts`.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
} from "discord.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { createEmbed } from "./embedUtils.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { MS } from "@mcbot/schema/time.js";
import { joinCustomId } from "./customId.js";

export const CONFIRM_PREFIX = "confirm";
export const CONFIRM_TTL_MS = MS.minute;

export interface ConfirmTarget {
  /** Registered action name, without ":" (e.g. "server-stop"). */
  action: string;
  serverId: string;
  /** The only user allowed to press the buttons. */
  userId: string;
  /** Epoch ms after which the buttons are refused. */
  expiresAt: number;
}

export interface ParsedConfirmId extends ConfirmTarget {
  answer: "yes" | "no";
}

export function confirmCustomId(answer: "yes" | "no", target: ConfirmTarget): string {
  const expires = Math.floor(target.expiresAt / MS.second).toString(36);
  return joinCustomId(CONFIRM_PREFIX, answer, target.action, target.serverId, target.userId, expires);
}

/** `confirm:yes:server-stop:smp:123:abc` to parts, or null if not ours. */
export function parseConfirmCustomId(customId: string): ParsedConfirmId | null {
  const parts = customId.split(":");
  if (parts.length !== 6 || parts[0] !== CONFIRM_PREFIX) return null;
  const [, answer, action, serverId, userId, expires] = parts;
  if (answer !== "yes" && answer !== "no") return null;
  if (!action || !serverId || !userId || !expires) return null;
  const seconds = parseInt(expires, 36);
  if (!Number.isFinite(seconds)) return null;
  return { answer, action, serverId, userId, expiresAt: seconds * MS.second };
}

/** Pending (violet) embed asking the question, with the expiry in the footer. */
export function createConfirmEmbed({
  title,
  description,
}: {
  title: string;
  description: string;
}): EmbedBuilder {
  return createEmbed({
    title,
    description,
    category: EmbedCategory.Confirm,
    footer: { text: t("confirm.expires", { seconds: CONFIRM_TTL_MS / MS.second }) },
  });
}

/**
 * The danger button and Cancel. `disabled` renders the row switched off,
 * for an expired or answered confirmation.
 */
export function createConfirmRow(
  target: ConfirmTarget,
  confirmLabel: string,
  { disabled = false, guildId }: { disabled?: boolean; guildId?: string } = {},
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmCustomId("yes", target))
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(confirmCustomId("no", target))
      .setLabel(t("confirm.cancel", {}, guildId))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

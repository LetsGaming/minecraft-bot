/**
 * The button half of the follow-up hints.
 *
 * customIds are stable (`hint:<yes|no>:<hintId>:<serverId>:<userId>`) rather
 * than collector-backed, so a hint offered before a restart still works
 * afterwards — the same reason the whitelist-application buttons are built
 * this way. A dead button is worse than no button: it teaches people the
 * bot's offers do not work.
 */
import type { Interaction } from "discord.js";
import {
  findHint,
  HINT_PREFIX,
} from "../utils/hints/followUps.js";
import {
  dismissSuggestion,
  discordSubject,
} from "@mcbot/core/utils/stores/suggestionLedger.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

interface ParsedHintId {
  answer: "yes" | "no";
  hintId: string;
  serverId: string;
  userId: string;
}

/** `hint:yes:daily-reminder:survival:123` → parts, or null if not ours. */
export function parseHintCustomId(customId: string): ParsedHintId | null {
  const parts = customId.split(":");
  if (parts.length !== 5 || parts[0] !== HINT_PREFIX) return null;
  const [, answer, hintId, serverId, userId] = parts;
  if (answer !== "yes" && answer !== "no") return null;
  if (!hintId || !serverId || !userId) return null;
  return { answer, hintId, serverId, userId };
}

/**
 * Returns true when the interaction was ours and has been answered, so the
 * caller stops routing it.
 */
export async function handleFollowUpHintInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (!interaction.isButton()) return false;
  const parsed = parseHintCustomId(interaction.customId);
  if (!parsed) return false;

  // The reply may be public, so anyone can see the button. Only the person
  // it was offered to may press it — the action writes to their record.
  if (interaction.user.id !== parsed.userId) {
    await interaction.reply({
      content: t("hint.notYours"),
      ephemeral: true,
    });
    return true;
  }

  const hint = findHint(parsed.hintId);
  // Either removed from the registry between offer and press, or turned
  // into a mention — neither has anything to apply, so retire the buttons.
  if (!hint || hint.kind !== "action") {
    await interaction.update({ components: [] });
    return true;
  }

  try {
    if (parsed.answer === "no") {
      await dismissSuggestion(discordSubject(parsed.userId), parsed.hintId);
      // Clear the buttons rather than leaving a dead row behind.
      await interaction.update({ components: [] });
      return true;
    }

    await hint.apply({ userId: parsed.userId, serverId: parsed.serverId });
    await interaction.update({ components: [] });
    await interaction.followUp({
      content: t(hint.confirmKey),
      ephemeral: true,
    });
  } catch (err) {
    log.error("hint", `Applying ${parsed.hintId} failed: ${errMsg(err)}`);
    await interaction
      .followUp({ content: t("hint.failed"), ephemeral: true })
      .catch(() => {
        /* the interaction may already be gone */
      });
  }
  return true;
}

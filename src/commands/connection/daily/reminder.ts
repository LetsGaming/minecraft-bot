/**
 * F-04: /daily-reminder — opt-in DM when the /daily cooldown expires.
 * The flag lives on the user's claim record in claimedDaily.json; the
 * actual DMs are sent by the dailyReminderScheduler watcher.
 */
import { SlashCommandBuilder } from "discord.js";
import {
  loadClaimedDaily,
  saveClaimedDaily,
} from "../../../utils/dailyStore.js";
import { withErrorHandling } from "../../middleware.js";
import { t } from "../../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("daily-reminder")
  .setDescription("Get a DM when your next /daily reward is ready")
  .addBooleanOption((o) =>
    o
      .setName("enabled")
      .setDescription("Turn reminders on or off")
      .setRequired(true),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const enabled = interaction.options.getBoolean("enabled", true);
    const userId = interaction.user.id;

    const claimed = await loadClaimedDaily();
    const existing = claimed[userId];

    claimed[userId] = {
      // Users who never claimed get a zeroed record carrying just the
      // flag; the scheduler only DMs once a real claim exists.
      lastClaim: existing?.lastClaim ?? 0,
      currentStreak: existing?.currentStreak ?? 0,
      bonusStreak: existing?.bonusStreak ?? 0,
      longestStreak: existing?.longestStreak ?? 0,
      rewards: existing?.rewards ?? [],
      ...existing,
      remind: enabled,
    };
    await saveClaimedDaily(claimed);

    await interaction.editReply(
      enabled ? t("dailyReminder.enabled") : t("dailyReminder.disabled"),
    );
  },
  { ephemeral: true },
);

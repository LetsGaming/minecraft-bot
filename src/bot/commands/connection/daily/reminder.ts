/**
 * /daily-reminder: opt-in DM when the /daily cooldown expires. The flag lives
 * on the user's claim record; the DMs are sent by the dailyReminderScheduler watcher.
 */
import { SlashCommandBuilder } from "discord.js";
import {
  getServerClaims,
  updateClaimedStore,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { withErrorHandling } from "../../middleware.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";
import { getAllInstances } from "@mcbot/core/utils/server/server.js";
import { emptyClaim } from "@mcbot/core/utils/minecraft/dailyClaim.js";
import { t } from "@mcbot/core/utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("daily-reminder")
  .setDescription("Get a DM when your next /daily reward is ready")
  .addBooleanOption((o) =>
    o
      .setName("enabled")
      .setDescription("Turn reminders on or off")
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName("server")
      .setDescription("Server the reminder applies to")
      .setAutocomplete(true),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const enabled = interaction.options.getBoolean("enabled", true);
    const userId = interaction.user.id;

    // Reminders are per server, like the claims they announce.
    const server = resolveServer(interaction);
    await updateClaimedStore((store) => {
      const claimed = getServerClaims(store, server.id);
      const existing = claimed[userId];

      claimed[userId] = {
        // Users who never claimed get a zeroed record carrying just the
        // flag; the scheduler only DMs once a real claim exists.
        ...(existing ?? emptyClaim()),
        remind: enabled,
      };
    });

    const suffix =
      getAllInstances().length > 1
        ? t("dailyReminder.serverSuffix", { server: server.id })
        : "";
    await interaction.editReply(
      (enabled ? t("dailyReminder.enabled") : t("dailyReminder.disabled")) +
        suffix,
    );
  },
  { ephemeral: true },
);

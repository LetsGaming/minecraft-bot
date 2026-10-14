/**
 * Daily-reward claim reminders.
 *
 * Every CHECK_INTERVAL_MS the scheduler scans claimedDaily.json for users
 * who opted in (/daily-reminder enabled:true) whose 24h cooldown has
 * expired, and sends each one a single DM per claim cycle.
 *
 * Dedupe: a reminder is only sent when lastReminderAt predates the current
 * lastClaim — claiming resets the cycle, so the next expiry triggers
 * exactly one new DM. DM failures (closed DMs) still advance
 * lastReminderAt so the bot never hammers a user who blocks DMs.
 */
import { DAILY_COOLDOWN_MS } from "@mcbot/core/utils/minecraft/rewards.js";
import type { Client } from "discord.js";
import {
  loadClaimedStore,
  updateClaimedStore,
} from "@mcbot/core/utils/stores/dailyStore.js";
import type { UserClaimData } from "@mcbot/core/types/index.js";
import { log } from "@mcbot/core/utils/logger.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * One reminder pass. Exported for tests; the scheduler calls it on an
 * interval. Returns the number of reminders sent.
 */
function isDue(data: UserClaimData, now: number): boolean {
  if (data.remind !== true) return false;
  if (!data.lastClaim || data.lastClaim <= 0) return false; // never claimed yet
  if (now - data.lastClaim < DAILY_COOLDOWN_MS) return false; // still cooling down
  return (data.lastReminderAt ?? 0) < data.lastClaim; // not yet reminded this cycle
}

export async function processDailyReminders(
  client: Client,
  now = Date.now(),
): Promise<number> {
  // Most passes find nothing due: a plain read keeps them off the write lock.
  const peek = await loadClaimedStore();
  const anyDue = Object.values(peek.servers).some((claimed) =>
    Object.values(claimed).some((data) => isDue(data, now)),
  );
  if (!anyDue) return 0;

  // AUD-005: pick the due reminders and mark them sent in one transaction,
  // then DM. Marking a loaded copy and saving it after the DMs wrote that
  // copy back over every claim made while the DMs went out.
  const { due, multiServer } = await updateClaimedStore((store) => {
    // Claims are per server, so reminders are too — one DM per due server,
    // naming the server when there's more than one.
    const serverEntries = Object.entries(store.servers);
    const picked: Array<{ serverId: string; userId: string }> = [];
    for (const [serverId, claimed] of serverEntries) {
      for (const [userId, data] of Object.entries(claimed)) {
        if (!isDue(data, now)) continue;
        data.lastReminderAt = now;
        picked.push({ serverId, userId });
      }
    }
    return { due: picked, multiServer: serverEntries.length > 1 };
  });

  let sent = 0;
  for (const { serverId, userId } of due) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({
        embeds: [
          createEmbed({
            title: t("dailyReminder.title"),
            description: multiServer
              ? t("dailyReminder.dmServer", { server: serverId })
              : t("dailyReminder.dm"),
            category: EmbedCategory.Reward,
          }),
        ],
      });
      sent++;
    } catch (err) {
      // Closed DMs or unknown user — lastReminderAt is already advanced,
      // so this user is skipped until their next claim.
      log.debug("dailyReminder", `DM to ${userId} failed: ${errMsg(err)}`);
    }
  }
  return sent;
}

export function startDailyReminderScheduler(
  client: Client,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    processDailyReminders(client).catch((err) => {
      log.error("dailyReminder", `Reminder pass failed: ${errMsg(err)}`);
    });
  }, CHECK_INTERVAL_MS);

  log.info("dailyReminder", "Daily reminder scheduler active (5 min interval)");
  return timer;
}

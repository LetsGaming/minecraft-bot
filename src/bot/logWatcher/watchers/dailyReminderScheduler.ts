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
import type { Client } from "discord.js";
import {
  loadClaimedStore,
  saveClaimedStore,
} from "../../../common/utils/dailyStore.js";
import { log } from "../../../common/utils/logger.js";
import { t } from "../../../common/utils/i18n.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * One reminder pass. Exported for tests; the scheduler calls it on an
 * interval. Returns the number of reminders sent.
 */
export async function processDailyReminders(
  client: Client,
  now = Date.now(),
): Promise<number> {
  const store = await loadClaimedStore();
  let sent = 0;
  let dirty = false;

  // Claims are per server, so reminders are too — one DM per due server,
  // naming the server when there's more than one.
  const serverEntries = Object.entries(store.servers);
  const multiServer = serverEntries.length > 1;

  for (const [serverId, claimed] of serverEntries) {
    for (const [userId, data] of Object.entries(claimed)) {
      if (data.remind !== true) continue;
      if (!data.lastClaim || data.lastClaim <= 0) continue; // never claimed yet
      if (now - data.lastClaim < DAILY_COOLDOWN_MS) continue; // still cooling down
      if ((data.lastReminderAt ?? 0) >= data.lastClaim) continue; // already reminded this cycle

      data.lastReminderAt = now;
      dirty = true;

      try {
        const user = await client.users.fetch(userId);
        await user.send(
          multiServer
            ? t("dailyReminder.dmServer", { server: serverId })
            : t("dailyReminder.dm"),
        );
        sent++;
      } catch (err) {
        // Closed DMs or unknown user — lastReminderAt is already advanced,
        // so this user is skipped until their next claim.
        const msg = err instanceof Error ? err.message : String(err);
        log.debug("dailyReminder", `DM to ${userId} failed: ${msg}`);
      }
    }
  }

  if (dirty) await saveClaimedStore(store);
  return sent;
}

export function startDailyReminderScheduler(
  client: Client,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    processDailyReminders(client).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("dailyReminder", `Reminder pass failed: ${msg}`);
    });
  }, CHECK_INTERVAL_MS);

  log.info("dailyReminder", "Daily reminder scheduler active (5 min interval)");
  return timer;
}

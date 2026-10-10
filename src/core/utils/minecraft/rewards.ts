/**
 * Daily-reward domain rules: streaks, the weighted pool draw, and getting
 * items into a player's inventory.
 *
 * These lived inside the `/daily` slash command, which meant two log
 * watchers (advancements, joinLeave) imported `give` and
 * `deliverPendingRewards` *from a Discord interaction handler* — a
 * watcher depending on a command, and the reward rules sitting on the
 * presentation side of the seam. Nothing here knows about Discord: the
 * command formats the embed, the watchers fire on log lines, and both
 * call these.
 */
import {
  loadPendingRewards,
  savePendingRewards,
  getServerPending,
} from "../stores/dailyStore.js";
import type { ServerInstance } from "../server/server.js";
import { tellraw } from "./serverMessages.js";
import type {
  DailyRewardsConfig,
  DailyRewardItem,
  UserClaimData,
} from "../../types/index.js";
import { t } from "../i18n.js";
import { log } from "../logger.js";

/** One claim per 24h; a gap of more than two cooldowns breaks the streak. */
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Streak cycle length when the config defines no streakBonuses. */
export const DEFAULT_MAX_STREAK = 35;

interface StreakResult {
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
}

export function calcStreak(
  {
    currentStreak,
    bonusStreak,
    longestStreak,
  }: Pick<UserClaimData, "currentStreak" | "bonusStreak" | "longestStreak">,
  delta: number,
  cycleMax: number = DEFAULT_MAX_STREAK,
): StreakResult {
  const broken = delta > 2 * DAILY_COOLDOWN_MS;
  const cs = broken ? 1 : currentStreak + 1;

  let bs: number;
  if (broken) {
    bs = 1;
  } else if (bonusStreak >= cycleMax) {
    bs = 1;
  } else {
    bs = bonusStreak + 1;
  }

  return {
    currentStreak: cs,
    bonusStreak: bs,
    longestStreak: Math.max(longestStreak, cs),
  };
}

export function deriveMaxStreak(
  streakBonuses: DailyRewardsConfig["streakBonuses"],
): number {
  if (!streakBonuses) return DEFAULT_MAX_STREAK;
  const keys = Object.keys(streakBonuses)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n) && n > 0);
  return keys.length > 0 ? Math.max(...keys) : DEFAULT_MAX_STREAK;
}

export function pick(pool: DailyRewardItem[]): DailyRewardItem {
  const total = pool.reduce((sum, { weight = 1 }) => sum + weight, 0);
  let r = Math.random() * total;
  for (const item of pool) {
    r -= item.weight ?? 1;
    if (r < 0) return item;
  }
  return pool[0]!;
}

/**
 * Give a reward item to a player. IDs get a "minecraft:" prefix only when
 * they have no namespace, so modded IDs like "create:brass_ingot" pass
 * through unchanged.
 *
 * Returns false when delivery could not be confirmed: the command did not
 * reach the server, or the RCON reply lacks the "Gave ..." confirmation
 * (logged raw so bad item IDs surface). Servers with no reply channel give
 * no signal and are assumed successful.
 */
export async function give(
  server: ServerInstance,
  player: string,
  { item, amount = 1 }: DailyRewardItem,
): Promise<boolean> {
  if (!player || !item) {
    log.error(
      "daily",
      `Invalid reward params for player=${player} item=${item}`,
    );
    return false;
  }
  const name = item.includes(":") ? item : `minecraft:${item}`;

  const outcome = await server.send(`give ${player} ${name} ${amount}`);

  // The command may never have reached the server. Report failure so the
  // reward stays queued and is retried, rather than being marked delivered.
  if (outcome.kind === "unreachable") {
    log.error(
      "daily",
      `Give failed for ${player} (item=${name}): ${outcome.reason}: ${outcome.detail}`,
    );
    return false;
  }

  // Sent over a channel with no reply: the command reached the server but its
  // outcome cannot be read. Reporting failure here would re-queue a reward
  // the player already holds and re-give it on every join.
  if (outcome.kind === "sent") return true;

  if (!/\bGave\b/i.test(outcome.output)) {
    log.error(
      "daily",
      `Give not confirmed for ${player} (item=${name}): ${outcome.output}`,
    );
    return false;
  }
  return true;
}

/**
 * Deliver queued offline claims for a player who just joined — called by
 * the joinLeave watcher. Entries are removed once ALL their items are
 * confirmed delivered; on partial failure the entry stays with only the
 * undelivered items, so the next join retries exactly what's missing
 * (give() already parses the RCON response for errors).
 *
 * Returns the number of items delivered.
 */
export async function deliverPendingRewards(
  server: ServerInstance,
  player: string,
): Promise<number> {
  const store = await loadPendingRewards();
  const queue = getServerPending(store, server.id);
  const key = player.toLowerCase();
  const list = queue[key];
  if (!list || list.length === 0) return 0;

  let delivered = 0;
  const remaining: typeof list = [];

  for (const entry of list) {
    const undelivered: DailyRewardItem[] = [];
    for (const item of entry.items) {
      if (await give(server, player, item)) delivered++;
      else undelivered.push(item);
    }
    if (undelivered.length > 0) {
      remaining.push({ ...entry, items: undelivered });
    }
  }

  if (remaining.length > 0) queue[key] = remaining;
  else delete queue[key];
  await savePendingRewards(store);

  if (delivered > 0) {
    await tellraw(server, player, {
      text: t("daily.delivered", { count: delivered }),
      color: "green",
    });
  }
  return delivered;
}

/**
 * Daily-reward domain rules: streaks, the weighted pool draw, and getting
 * items into a player's inventory. Nothing here knows about Discord.
 */
import {
  hasPending,
  takePending,
  requeuePending,
} from "../stores/dailyStore.js";
import type { ServerInstance } from "../server/server.js";
import { consoleCommand, tellraw } from "./serverMessages.js";
import { errMsg } from "../error.js";
import { formatItemList } from "./itemNames.js";
import type {
  DailyRewardsConfig,
  DailyRewardItem,
  RewardPool,
  UserClaimData,
} from "../../types/index.js";
import { t } from "../i18n.js";
import { RewardRarity, REWARD_RARITIES } from "@mcbot/schema/embedCategories.js";
import { rarityOf, milestoneDays, splitItem } from "@mcbot/schema/dailyRewards.js";
import { log } from "../logger.js";
import { MS } from "@mcbot/schema/time.js";

/** One claim per 24h. */
export const DAILY_COOLDOWN_MS = MS.day;

/** A gap of more than this since the last claim (two cooldowns) breaks the streak. */
export const STREAK_GRACE_MS = 2 * DAILY_COOLDOWN_MS;

/** Streak cycle length when the config defines no streakBonuses. */
export const DEFAULT_MAX_STREAK = 35;

interface StreakResult {
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
}

/**
 * The streak as it stands now. The stored `currentStreak` only changes on a
 * claim, so someone who stopped claiming kept showing their old streak on
 * `/streak` and the leaderboard until they claimed again. Past the grace
 * window (two cooldowns, the same rule calcStreak breaks it by) it is 0.
 */
export function liveStreak(
  data: Pick<UserClaimData, "currentStreak" | "lastClaim">,
  now = Date.now(),
): number {
  if (!data.lastClaim || now - data.lastClaim > STREAK_GRACE_MS) return 0;
  return data.currentStreak ?? 0;
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
  const broken = delta > STREAK_GRACE_MS;
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
  const { id, suffix } = splitItem(item);
  const name = `${id.includes(":") ? id : `minecraft:${id}`}${suffix}`;

  let command: string;
  try {
    command = consoleCommand("give", { player }, { item: name }, { count: amount });
  } catch (err) {
    log.error("daily", `Refused to give ${item} x${amount} to ${player}: ${errMsg(err)}`);
    return false;
  }
  const outcome = await server.send(command);

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
  // Taken in one transaction before giving anything, so two joins close
  // together cannot both deliver them; only what failed is put back.
  // Most joins have nothing queued: the plain read keeps them off the write lock.
  if (!(await hasPending(server.id, player))) return 0;

  const list = await takePending(server.id, player);
  if (list.length === 0) return 0;

  const delivered: DailyRewardItem[] = [];
  const work = list.map((entry) => ({
    entry,
    todo: [...entry.items],
    failed: [] as DailyRewardItem[],
  }));

  try {
    for (const w of work) {
      while (w.todo.length > 0) {
        const item = w.todo[0]!;
        if (await give(server, player, item)) delivered.push(item);
        else w.failed.push(item);
        w.todo.shift();
      }
    }
  } finally {
    // If give throws, the item in flight and everything not yet attempted
    // stay in `todo` and are re-queued with the failed ones.
    const remaining = work
      .map((w) => ({ ...w.entry, items: [...w.failed, ...w.todo] }))
      .filter((e) => e.items.length > 0);
    await requeuePending(server.id, player, remaining);
  }

  if (delivered.length > 0) {
    await tellraw(server, player, {
      text: t("daily.delivered", {
        count: delivered.length,
        items: formatItemList(delivered),
      }),
      color: "green",
    });
  }
  return delivered.length;
}

// Rarity and the milestone list are shared with the dashboard's editor.
export { rarityOf, milestoneDays };

/** The rarest of a set of tiers, in the order common < ... < legendary. */
export function rarest(tiers: readonly RewardRarity[]): RewardRarity {
  return tiers.reduce<RewardRarity>(
    (best, tier) => (REWARD_RARITIES.indexOf(tier) > REWARD_RARITIES.indexOf(best) ? tier : best),
    RewardRarity.Common,
  );
}

/** The first bonus after `bonusStreak`, or null when none is left in this cycle. */
export function nextMilestone(
  bonusStreak: number,
  streakBonuses: RewardPool["streakBonuses"],
): { day: number; items: DailyRewardItem[] } | null {
  const day = milestoneDays(streakBonuses).find((d) => d > bonusStreak);
  if (day === undefined) return null;
  return { day, items: streakBonuses?.[String(day)] ?? [] };
}

/**
 * The bonus streak as `/streak` should show it: past the same grace window
 * `liveStreak` uses (two cooldowns), the stored value is stale and reads as 0.
 */
export function liveBonusStreak(
  data: Pick<UserClaimData, "bonusStreak" | "lastClaim">,
  now = Date.now(),
): number {
  if (!data.lastClaim || now - data.lastClaim > STREAK_GRACE_MS) return 0;
  return data.bonusStreak ?? 0;
}
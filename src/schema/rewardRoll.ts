/**
 * The daily draw, shared by the bot's claim and the dashboard's "preview a
 * claim" so both roll the same way. Pure apart from the random source, which
 * defaults to `Math.random` and can be replaced to make a roll repeatable.
 */
import type { DailyRewardItem, RewardPool } from "./dailyRewards.js";

/** Streak cycle length when the config defines no streakBonuses. */
export const DEFAULT_MAX_STREAK = 35;

export type Rng = () => number;

export function deriveMaxStreak(streakBonuses: RewardPool["streakBonuses"]): number {
  if (!streakBonuses) return DEFAULT_MAX_STREAK;
  const keys = Object.keys(streakBonuses)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n) && n > 0);
  return keys.length > 0 ? Math.max(...keys) : DEFAULT_MAX_STREAK;
}

export function pick(pool: DailyRewardItem[], rng: Rng = Math.random): DailyRewardItem {
  const total = pool.reduce((sum, { weight = 1 }) => sum + weight, 0);
  let r = rng() * total;
  for (const item of pool) {
    r -= item.weight ?? 1;
    if (r < 0) return item;
  }
  return pool[0]!;
}

/** What a claim hands out, as plain item stacks (no editor ids). */
export interface RolledRewards {
  main: DailyRewardItem;
  randomBonus: DailyRewardItem | null;
  streakBonus: DailyRewardItem[];
}

/** A copy without the editor-only fields; the weight stays, rarity is read from it. */
function stack(entry: DailyRewardItem): DailyRewardItem {
  const out: DailyRewardItem = { item: entry.item, amount: entry.amount };
  if (entry.weight !== undefined) out.weight = entry.weight;
  return out;
}

/**
 * Draw the main reward, the optional bonus-chance draw (`bonusChance` is a
 * percentage) and the milestone bonus of `bonusStreak`. The random source is
 * used in this order: main pick, bonus-chance roll (only when `bonusChance`
 * is above 0), bonus pick.
 */
export function rollRewards(
  pool: RewardPool & { default: DailyRewardItem[] },
  bonusStreak: number,
  rng: Rng = Math.random,
): RolledRewards {
  const main = pick(pool.default, rng);
  const randomBonus = pool.bonusChance && rng() * 100 < pool.bonusChance ? pick(pool.default, rng) : null;
  const streakBonus = pool.streakBonuses?.[String(bonusStreak)] ?? [];
  return {
    main: stack(main),
    randomBonus: randomBonus ? stack(randomBonus) : null,
    streakBonus: streakBonus.map(stack),
  };
}

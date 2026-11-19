/**
 * The daily draw, shared by the bot's claim and the dashboard's "preview a
 * claim" so both roll the same way. Pure apart from the random source, which
 * defaults to `Math.random` and can be replaced to make a roll repeatable.
 *
 * A draw is tier first: the claim rolls a tier by the pool's tier chances, then
 * picks an entry of that tier by weight. Adding entries to one tier therefore
 * never changes the odds of another tier.
 */
import { REWARD_RARITIES, type RewardRarity } from "./embedCategories.js";
import { rarityOf, tierChancesOf, type DailyRewardItem, type RewardPool } from "./dailyRewards.js";

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

// ── Versions ─────────────────────────────────────────────────────────────────

/**
 * Order two release numbers part by part, so 1.21.10 is above 1.21.9 and the
 * year-based 26.1 is above every 1.x.
 */
export function compareMcVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether an entry exists on a server running `version`. An unknown version has every entry. */
export function isAvailableOn(item: Pick<DailyRewardItem, "since">, version: string | null | undefined): boolean {
  if (!item.since || !version) return true;
  return compareMcVersions(version, item.since) >= 0;
}

export interface DrawOptions {
  /** The server's Minecraft version, when it could be read. */
  version?: string | null;
}

/** The entries this server can roll. A pool the version leaves empty is used whole instead of drawing nothing. */
function rollable(list: readonly DailyRewardItem[], version: string | null | undefined): DailyRewardItem[] {
  const available = list.filter((item) => isAvailableOn(item, version));
  return available.length > 0 ? available : [...list];
}

function groupByTier(list: readonly DailyRewardItem[]): Map<RewardRarity, DailyRewardItem[]> {
  const groups = new Map<RewardRarity, DailyRewardItem[]>();
  for (const item of list) {
    const tier = rarityOf(item);
    groups.set(tier, [...(groups.get(tier) ?? []), item]);
  }
  return groups;
}

const weightTotal = (list: readonly DailyRewardItem[]): number =>
  list.reduce((sum, { weight = 1 }) => sum + weight, 0);

/**
 * The chance (percent) of each tier on a server. A tier without entries gives
 * its chance to the others in proportion, so the filled tiers add up to 100.
 * When every filled tier has no chance configured, the entries' own weights
 * decide, as they did before tiers existed.
 */
export function tierOdds(
  pool: Pick<RewardPool, "tierChances"> & { default: readonly DailyRewardItem[] },
  { version }: DrawOptions = {},
): Record<RewardRarity, number> {
  const groups = groupByTier(rollable(pool.default, version));
  const chances = tierChancesOf(pool);
  const odds = Object.fromEntries(REWARD_RARITIES.map((tier) => [tier, 0])) as Record<RewardRarity, number>;

  let configured = 0;
  for (const tier of groups.keys()) configured += chances[tier];
  if (configured > 0) {
    for (const tier of groups.keys()) odds[tier] = (chances[tier] / configured) * 100;
    return odds;
  }

  const all = [...groups.values()].flat();
  const total = weightTotal(all);
  for (const [tier, items] of groups) odds[tier] = total > 0 ? (weightTotal(items) / total) * 100 : 0;
  return odds;
}

/**
 * The chance (percent) of every entry of `pool.default`, in list order: its
 * tier's chance times its share of the tier's weight. An entry this version
 * does not have is 0.
 */
export function itemChances(
  pool: Pick<RewardPool, "tierChances"> & { default: readonly DailyRewardItem[] },
  options: DrawOptions = {},
): number[] {
  const odds = tierOdds(pool, options);
  const usable = new Set(rollable(pool.default, options.version));
  const tierWeight = new Map<RewardRarity, number>();
  for (const item of usable) tierWeight.set(rarityOf(item), (tierWeight.get(rarityOf(item)) ?? 0) + (item.weight ?? 1));
  return pool.default.map((item) => {
    if (!usable.has(item)) return 0;
    const total = tierWeight.get(rarityOf(item)) ?? 0;
    return total > 0 ? (odds[rarityOf(item)] * (item.weight ?? 1)) / total : 0;
  });
}

/** Roll the tier, then an entry of that tier. Uses the random source twice. */
export function drawFromPool(
  pool: Pick<RewardPool, "tierChances"> & { default: readonly DailyRewardItem[] },
  rng: Rng = Math.random,
  options: DrawOptions = {},
): DailyRewardItem {
  const groups = groupByTier(rollable(pool.default, options.version));
  const odds = tierOdds(pool, options);
  const tiers = REWARD_RARITIES.filter((tier) => groups.has(tier));
  const total = tiers.reduce((sum, tier) => sum + odds[tier], 0);
  let r = rng() * total;
  let chosen = tiers[tiers.length - 1]!;
  for (const tier of tiers) {
    r -= odds[tier];
    if (r < 0) {
      chosen = tier;
      break;
    }
  }
  return pick(groups.get(chosen)!, rng);
}

// ── A claim ──────────────────────────────────────────────────────────────────

/** What a claim hands out, as plain item stacks (no editor ids). */
export interface RolledRewards {
  main: DailyRewardItem;
  randomBonus: DailyRewardItem | null;
  streakBonus: DailyRewardItem[];
}

/** A copy without the editor-only fields; weight and tier stay, the reply reads the tier from them. */
function stack(entry: DailyRewardItem): DailyRewardItem {
  const out: DailyRewardItem = { item: entry.item, amount: entry.amount };
  if (entry.weight !== undefined) out.weight = entry.weight;
  if (entry.tier !== undefined) out.tier = entry.tier;
  return out;
}

/**
 * Draw the main reward, the optional bonus-chance draw (`bonusChance` is a
 * percentage) and the milestone bonus of `bonusStreak`. The random source is
 * used in this order: main draw (tier, then entry), bonus-chance roll (only
 * when `bonusChance` is above 0), bonus draw.
 */
export function rollRewards(
  pool: RewardPool & { default: DailyRewardItem[] },
  bonusStreak: number,
  rng: Rng = Math.random,
  options: DrawOptions = {},
): RolledRewards {
  const main = drawFromPool(pool, rng, options);
  const randomBonus =
    pool.bonusChance && rng() * 100 < pool.bonusChance ? drawFromPool(pool, rng, options) : null;
  const streakBonus = pool.streakBonuses?.[String(bonusStreak)] ?? [];
  return {
    main: stack(main),
    randomBonus: randomBonus ? stack(randomBonus) : null,
    streakBonus: streakBonus.map(stack),
  };
}

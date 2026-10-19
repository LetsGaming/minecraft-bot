/**
 * The daily-reward pool contract: its shape, the one validator the bot's
 * loader and the dashboard's save route both run, and the weight maths the
 * editor shows as percentages.
 *
 * Weights stay the stored truth. A percentage is only a view of them (an
 * item's weight over the pool's total), so a file written by hand with
 * weights like 10 and 1 and a file written by the dashboard read the same
 * way, and the draw in `pick()` never has to know which one it got.
 */
import { RewardRarity } from "./embedCategories.js";

export interface DailyRewardItem {
  /** Item id, `minecraft:` optional. May carry an item-components or NBT suffix. */
  item: string;
  amount: number;
  /** Relative draw weight in the main pool. Ignored in streak bonuses. */
  weight?: number;
}

/**
 * One reward document: the shared `dailyRewards.json`, or a server's
 * `dailyRewards_<serverId>.json` override. In an override every field is
 * optional; a field it leaves out is inherited from the shared document.
 */
export interface RewardPool {
  default?: DailyRewardItem[];
  /** Streak day ("3", "14") to the items granted on that day. */
  streakBonuses?: Record<string, DailyRewardItem[]>;
  /** Chance (0-100) of a second draw from the pool on any claim. */
  bonusChance?: number;
}

/** The fields an override can take over from the shared document, one by one. */
export const REWARD_POOL_FIELDS = ["default", "streakBonuses", "bonusChance"] as const;
export type RewardPoolField = (typeof REWARD_POOL_FIELDS)[number];

/** `/give` refuses more than this many of one item in a single command. */
export const MAX_REWARD_AMOUNT = 6400;
export const MAX_POOL_ITEMS = 2000;
export const MAX_STREAK_DAYS = 1000;
export const MAX_BONUS_ITEMS = 50;
export const MAX_ITEM_LENGTH = 1000;

/**
 * `namespace:path` (namespace optional), then optionally one components
 * (`[...]`) or NBT (`{...}`) block. The id is interpolated into a console
 * `give` command, so whitespace and control characters are refused outright.
 */
const ITEM_ID_RE = /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/;
const SUFFIX_RE = /^(?:\[[^\u0000-\u001f]*\]|\{[^\u0000-\u001f]*\})$/;

/** Split an item string into its id and its components/NBT suffix ("" when none). */
export function splitItem(item: string): { id: string; suffix: string } {
  const at = item.search(/[[{]/);
  return at < 0 ? { id: item, suffix: "" } : { id: item.slice(0, at), suffix: item.slice(at) };
}

/** Why `item` is not a usable item string, or null when it is. */
export function itemProblem(item: unknown): string | null {
  if (typeof item !== "string" || item.trim() === "") return "an item id is required";
  if (item.length > MAX_ITEM_LENGTH) return `the item string is longer than ${MAX_ITEM_LENGTH} characters`;
  const { id, suffix } = splitItem(item);
  if (!ITEM_ID_RE.test(id)) {
    return `"${id}" is not an item id (lowercase letters, digits, _ . - /, optionally namespace:)`;
  }
  if (suffix && !SUFFIX_RE.test(suffix)) return `the components after "${id}" are malformed`;
  return null;
}

export interface RewardPoolParse {
  /** The pool with every invalid entry dropped. */
  pool: RewardPool;
  /** One line per problem, naming where it is ("default[3].amount: ..."). */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItems(
  raw: unknown,
  where: string,
  max: number,
  weighted: boolean,
  errors: string[],
): DailyRewardItem[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`${where}: must be a list of items`);
    return undefined;
  }
  if (raw.length === 0) {
    errors.push(`${where}: must hold at least one item`);
    return undefined;
  }
  if (raw.length > max) errors.push(`${where}: holds more than ${max} items`);
  const out: DailyRewardItem[] = [];
  raw.slice(0, max).forEach((entry, i) => {
    const at = `${where}[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${at}: must be an object with "item"`);
      return;
    }
    const problem = itemProblem(entry.item);
    if (problem) {
      errors.push(`${at}.item: ${problem}`);
      return;
    }
    const amount = entry.amount ?? 1;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_REWARD_AMOUNT) {
      errors.push(`${at}.amount: must be a whole number from 1 to ${MAX_REWARD_AMOUNT}`);
      return;
    }
    const item: DailyRewardItem = { item: entry.item as string, amount };
    if (weighted) {
      const weight = entry.weight ?? 1;
      if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) {
        errors.push(`${at}.weight: must be a number above 0`);
        return;
      }
      if (entry.weight !== undefined) item.weight = weight;
    }
    out.push(item);
  });
  return out.length > 0 ? out : undefined;
}

/**
 * Check a reward document. `shared` requires the item pool (every server
 * falls back to it); an override may leave any field out.
 *
 * The result is usable either way: the loader keeps what is valid and logs
 * the rest, the save route refuses the document when `errors` is not empty.
 */
export function parseRewardPool(raw: unknown, kind: "shared" | "override"): RewardPoolParse {
  const errors: string[] = [];
  const pool: RewardPool = {};
  if (!isRecord(raw)) {
    return { pool, errors: ["the document must be a JSON object"] };
  }

  for (const key of Object.keys(raw)) {
    if ((REWARD_POOL_FIELDS as readonly string[]).includes(key)) continue;
    errors.push(
      key === "servers"
        ? `servers: per-server pools inside dailyRewards.json are no longer read; move each one to data/dailyRewards_<serverId>.json`
        : `${key}: unknown field`,
    );
  }

  if (raw.default !== undefined) {
    const items = parseItems(raw.default, "default", MAX_POOL_ITEMS, true, errors);
    if (items) pool.default = items;
  } else if (kind === "shared") {
    errors.push("default: the shared item pool is required");
  }

  if (raw.streakBonuses !== undefined) {
    if (!isRecord(raw.streakBonuses)) {
      errors.push("streakBonuses: must map streak days to item lists");
    } else {
      const entries = Object.entries(raw.streakBonuses);
      if (entries.length > MAX_STREAK_DAYS) errors.push(`streakBonuses: more than ${MAX_STREAK_DAYS} days`);
      const bonuses: Record<string, DailyRewardItem[]> = {};
      for (const [day, list] of entries.slice(0, MAX_STREAK_DAYS)) {
        if (!/^[1-9]\d{0,5}$/.test(day)) {
          errors.push(`streakBonuses.${day}: the day must be a whole number from 1`);
          continue;
        }
        const items = parseItems(list, `streakBonuses.${day}`, MAX_BONUS_ITEMS, false, errors);
        if (items) bonuses[day] = items;
      }
      pool.streakBonuses = bonuses;
    }
  }

  if (raw.bonusChance !== undefined) {
    const chance = raw.bonusChance;
    if (typeof chance !== "number" || !Number.isFinite(chance) || chance < 0 || chance > 100) {
      errors.push("bonusChance: must be a number from 0 to 100");
    } else {
      pool.bonusChance = chance;
    }
  }

  return { pool, errors };
}

// ── Dashboard API ────────────────────────────────────────────────────────────

/** One reward document as the dashboard reads it. */
export interface RewardsDocumentDto {
  pool: RewardPool;
  /** Problems in the file as stored (entries dropped from `pool`). */
  problems: string[];
  /** Concurrency token for the save. */
  hash: string;
  exists: boolean;
}

/** GET /api/rewards */
export interface SharedRewardsResponse {
  shared: RewardsDocumentDto;
  /** The pool shipped with the bot, for "start over from the defaults". */
  shipped: RewardPool | null;
}

/** GET /api/servers/:id/rewards */
export interface ServerRewardsResponse {
  override: RewardsDocumentDto;
  /** The shared pool, what every field the override leaves out falls back to. */
  shared: Pick<RewardsDocumentDto, "pool" | "problems">;
}

/** PUT body for both routes. */
export interface RewardsWriteBody {
  baseHash: string;
  pool: RewardPool;
}

// ── Weights and percentages ──────────────────────────────────────────────────

export function weightOf(item: Pick<DailyRewardItem, "weight">): number {
  return item.weight ?? 1;
}

export function totalWeight(items: readonly Pick<DailyRewardItem, "weight">[]): number {
  return items.reduce((sum, item) => sum + weightOf(item), 0);
}

/** An item's chance per draw, 0-100. */
export function sharePercent(weight: number, total: number): number {
  return total > 0 ? (weight / total) * 100 : 0;
}

/** Highest percentage the editor lets one item take while others share the rest. */
export const MAX_SHARE_PERCENT = 99.99;

/**
 * The weight that gives one item `percent` of the draws while every other
 * item keeps its weight. The others keep their proportions to each other;
 * only their combined share moves to make room. Null when there is nothing
 * to share with (a pool of one item is always 100 %).
 */
export function weightForPercent(percent: number, othersTotal: number): number | null {
  if (othersTotal <= 0 || !Number.isFinite(percent)) return null;
  const p = Math.min(Math.max(percent, 0.0001), MAX_SHARE_PERCENT);
  return roundWeight((p * othersTotal) / (100 - p));
}

/** Weights the editor writes: six significant digits, never 0. */
export function roundWeight(weight: number): number {
  const rounded = Number(weight.toPrecision(6));
  return rounded > 0 ? rounded : 0.0001;
}

/**
 * Rescale every weight so they add up to 100, keeping each item's chance.
 * Handy after many percentage edits: each weight then reads as its percent.
 */
export function normalizedWeights(items: readonly Pick<DailyRewardItem, "weight">[]): number[] {
  const total = totalWeight(items);
  return items.map((item) => (total > 0 ? roundWeight((weightOf(item) / total) * 100) : 1));
}

// ── Rarity ───────────────────────────────────────────────────────────────────

/**
 * Share of the pool's total weight at or below which an item counts as that
 * rarity. Checked from rarest to most common.
 */
const RARITY_MAX_SHARE: ReadonlyArray<readonly [RewardRarity, number]> = [
  [RewardRarity.Legendary, 0.02],
  [RewardRarity.Epic, 0.07],
  [RewardRarity.Rare, 0.2],
  [RewardRarity.Uncommon, 0.45],
];

/** Pools with fewer distinct weights than this carry no rarity signal. */
const MIN_DISTINCT_WEIGHTS_FOR_RARITY = 4;

/**
 * How rare an item is within its pool, from its share of the total weight.
 * A pool whose weights barely differ (for example all equal) has no real
 * rarity ladder, so every item in it is common.
 */
export function rarityOf(
  item: Pick<DailyRewardItem, "weight">,
  pool: readonly Pick<DailyRewardItem, "weight">[],
): RewardRarity {
  const weights = pool.map(weightOf);
  if (new Set(weights).size < MIN_DISTINCT_WEIGHTS_FOR_RARITY) return RewardRarity.Common;
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return RewardRarity.Common;
  const share = weightOf(item) / total;
  for (const [rarity, max] of RARITY_MAX_SHARE) {
    if (share <= max) return rarity;
  }
  return RewardRarity.Common;
}

/** The streak days that carry a bonus, ascending. */
export function milestoneDays(streakBonuses: RewardPool["streakBonuses"]): number[] {
  return Object.keys(streakBonuses ?? {})
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);
}

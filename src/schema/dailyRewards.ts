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
  /**
   * Stable identity inside its list. The same item may appear several times
   * with different amounts or weights, so the item string cannot name an
   * entry. Without one, `entryIds` derives `item#n` from the file order.
   */
  id?: string;
  /** Set on a server's local copy that replaced the shared entry with this id. */
  detachedFrom?: string;
}

/**
 * A resolved reward document, or the shared `dailyRewards.json` itself. A
 * server's `dailyRewards_<serverId>.json` is an `OverridePool` instead.
 */
export interface RewardPool {
  default?: DailyRewardItem[];
  /** Streak day ("3", "14") to the items granted on that day. */
  streakBonuses?: Record<string, DailyRewardItem[]>;
  /** Chance (0-100) of a second draw from the pool on any claim. */
  bonusChance?: number;
}

/** New values for one inherited entry. Only the fields it names are replaced. */
export interface EntrySet {
  /** The item string, kept so an orphaned patch still says what it was about. */
  item: string;
  amount?: number;
  weight?: number;
}

/** What one list (the pool, or one streak day) changes against its shared list. */
export interface ListPatch {
  /** Entries only this server has. Each carries an `id`. */
  add?: DailyRewardItem[];
  /** Ids of shared entries this server does not use. */
  remove?: string[];
  /** Shared entry id to the values this server uses instead. */
  set?: Record<string, EntrySet>;
}

export interface StreakPatch {
  /** Milestone days patched list by list; a day only listed here is new. */
  days?: Record<string, ListPatch>;
  /** Shared milestone days this server does not have. */
  removeDays?: string[];
}

/**
 * A server's override: exceptions against the shared document. A field it
 * leaves out is inherited; `bonusChance` is a single value, so it is replaced.
 */
export interface OverridePool {
  default?: ListPatch;
  streakBonuses?: StreakPatch;
  bonusChance?: number;
}

/** The fields an override can take over from the shared document, one by one. */
export const REWARD_POOL_FIELDS = ["default", "streakBonuses", "bonusChance"] as const;
export type RewardPoolField = (typeof REWARD_POOL_FIELDS)[number];

/** Where in a document a list lives: the pool, or a streak day. */
export type ListWhere = "default" | `streakBonuses.${string}`;

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

const DAY_RE = /^[1-9]\d{0,5}$/;

/** An entry id: short, and safe to use as a JSON key and in a UI row key. */
export const ENTRY_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:~#-]{0,63}$/;
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
    for (const key of ["id", "detachedFrom"] as const) {
      const value = entry[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !ENTRY_ID_RE.test(value)) {
        errors.push(`${at}.${key}: must be a short id of letters, digits and _ . : ~ # -`);
        return;
      }
      item[key] = value;
    }
    if (item.id !== undefined && out.some((o) => o.id === item.id)) {
      errors.push(`${at}.id: "${item.id}" is used twice in this list`);
      return;
    }
    out.push(item);
  });
  return out.length > 0 ? out : undefined;
}

/**
 * Parse the list shapes of a patch, which may be empty (unlike a pool list).
 * Entries are validated like pool entries; the id is required on `add`.
 */
function parseAdded(raw: unknown, where: string, max: number, weighted: boolean, errors: string[]): DailyRewardItem[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push(`${where}: must be a list of items`);
    return undefined;
  }
  if (raw.length === 0) return [];
  const items = parseItems(raw, where, max, weighted, errors) ?? [];
  items.forEach((entry, i) => {
    if (entry.id === undefined) errors.push(`${where}[${i}].id: an added item needs an id`);
  });
  return items.filter((entry) => entry.id !== undefined);
}

function parseIdList(raw: unknown, where: string, errors: string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push(`${where}: must be a list of ids`);
    return undefined;
  }
  const out: string[] = [];
  raw.forEach((id, i) => {
    if (typeof id !== "string" || !ENTRY_ID_RE.test(id)) errors.push(`${where}[${i}]: not a valid id`);
    else if (!out.includes(id)) out.push(id);
  });
  return out;
}

function parseListPatch(raw: unknown, where: string, max: number, weighted: boolean, errors: string[]): ListPatch | undefined {
  if (!isRecord(raw)) {
    errors.push(`${where}: must be an object with add, remove and set`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (key !== "add" && key !== "remove" && key !== "set") errors.push(`${where}.${key}: unknown field`);
  }
  const patch: ListPatch = {};
  const add = parseAdded(raw.add, `${where}.add`, max, weighted, errors);
  if (add && add.length > 0) patch.add = add;
  const remove = parseIdList(raw.remove, `${where}.remove`, errors);
  if (remove && remove.length > 0) patch.remove = remove;
  if (raw.set !== undefined) {
    if (!isRecord(raw.set)) {
      errors.push(`${where}.set: must map entry ids to new values`);
    } else {
      const set: Record<string, EntrySet> = {};
      for (const [id, value] of Object.entries(raw.set)) {
        const at = `${where}.set.${id}`;
        if (!ENTRY_ID_RE.test(id)) {
          errors.push(`${at}: not a valid id`);
          continue;
        }
        if (!isRecord(value)) {
          errors.push(`${at}: must be an object`);
          continue;
        }
        const problem = itemProblem(value.item);
        if (problem) {
          errors.push(`${at}.item: ${problem}`);
          continue;
        }
        const next: EntrySet = { item: value.item as string };
        if (value.amount !== undefined) {
          const a = value.amount;
          if (typeof a !== "number" || !Number.isInteger(a) || a < 1 || a > MAX_REWARD_AMOUNT) {
            errors.push(`${at}.amount: must be a whole number from 1 to ${MAX_REWARD_AMOUNT}`);
            continue;
          }
          next.amount = a;
        }
        if (weighted && value.weight !== undefined) {
          const w = value.weight;
          if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
            errors.push(`${at}.weight: must be a number above 0`);
            continue;
          }
          next.weight = w;
        }
        set[id] = next;
      }
      if (Object.keys(set).length > 0) patch.set = set;
    }
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
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
        if (!DAY_RE.test(day)) {
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

export interface OverridePoolParse {
  pool: OverridePool;
  errors: string[];
}

/**
 * Whether an override file is in the old form, where a field holds the whole
 * replacement list instead of a patch. `parseRewardPool(raw, "override")`
 * reads that form; `convertLegacyOverride` turns it into an `OverridePool`.
 */
export function isLegacyOverride(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (Array.isArray(raw.default)) return true;
  const streak = raw.streakBonuses;
  return isRecord(streak) && Object.keys(streak).some((k) => k !== "days" && k !== "removeDays");
}

/** Check a server override in its patch form. Usable even when `errors` is not empty. */
export function parseOverridePool(raw: unknown): OverridePoolParse {
  const errors: string[] = [];
  const pool: OverridePool = {};
  if (!isRecord(raw)) return { pool, errors: ["the document must be a JSON object"] };

  for (const key of Object.keys(raw)) {
    if (!(REWARD_POOL_FIELDS as readonly string[]).includes(key)) errors.push(`${key}: unknown field`);
  }

  if (raw.default !== undefined) {
    const patch = parseListPatch(raw.default, "default", MAX_POOL_ITEMS, true, errors);
    if (patch) pool.default = patch;
  }

  if (raw.streakBonuses !== undefined) {
    const streak = raw.streakBonuses;
    if (!isRecord(streak)) {
      errors.push("streakBonuses: must be an object with days and removeDays");
    } else {
      for (const key of Object.keys(streak)) {
        if (key !== "days" && key !== "removeDays") errors.push(`streakBonuses.${key}: unknown field`);
      }
      const out: StreakPatch = {};
      if (streak.days !== undefined) {
        if (!isRecord(streak.days)) {
          errors.push("streakBonuses.days: must map streak days to patches");
        } else {
          const days: Record<string, ListPatch> = {};
          const entries = Object.entries(streak.days);
          if (entries.length > MAX_STREAK_DAYS) errors.push(`streakBonuses.days: more than ${MAX_STREAK_DAYS} days`);
          for (const [day, value] of entries.slice(0, MAX_STREAK_DAYS)) {
            if (!DAY_RE.test(day)) {
              errors.push(`streakBonuses.days.${day}: the day must be a whole number from 1`);
              continue;
            }
            const patch = parseListPatch(value, `streakBonuses.days.${day}`, MAX_BONUS_ITEMS, false, errors);
            if (patch) days[day] = patch;
          }
          if (Object.keys(days).length > 0) out.days = days;
        }
      }
      if (streak.removeDays !== undefined) {
        if (!Array.isArray(streak.removeDays)) {
          errors.push("streakBonuses.removeDays: must be a list of days");
        } else {
          const days: string[] = [];
          for (const day of streak.removeDays) {
            if (typeof day !== "string" || !DAY_RE.test(day)) errors.push(`streakBonuses.removeDays: "${String(day)}" is not a streak day`);
            else if (!days.includes(day)) days.push(day);
          }
          if (days.length > 0) out.removeDays = days;
        }
      }
      if (Object.keys(out).length > 0) pool.streakBonuses = out;
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

// ── Entry identity ───────────────────────────────────────────────────────────

/** A short stable hash (FNV-1a, base 36). Not for security; for naming entries. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * The effective id of every entry in a list: its own `id`, else `<hash>#n`
 * where `n` counts the earlier id-less entries with the same item string.
 * The same list always gives the same ids, so patches written against a
 * derived id stay valid once the dashboard stores it (see `assignIds`).
 */
export function entryIds(list: readonly Pick<DailyRewardItem, "item" | "id">[] | undefined): string[] {
  const taken = new Set((list ?? []).flatMap((entry) => (entry.id !== undefined ? [entry.id] : [])));
  const seen = new Map<string, number>();
  return (list ?? []).map((entry) => {
    if (entry.id !== undefined) return entry.id;
    const base = shortHash(entry.item);
    let n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    let id = `${base}#${n}`;
    while (taken.has(id)) id = `${base}#${++n}`;
    taken.add(id);
    return id;
  });
}

/** The list with every entry carrying the id it already resolves to. */
export function assignIds<T extends Pick<DailyRewardItem, "item" | "id">>(list: readonly T[]): T[] {
  const ids = entryIds(list);
  return list.map((entry, i) => (entry.id === ids[i] ? entry : { ...entry, id: ids[i]! }));
}

/** A fresh random id for an entry made in the editor; unique among `taken`. */
export function newEntryId(taken: ReadonlySet<string>, rng: () => number = Math.random): string {
  for (;;) {
    const id = Math.floor(rng() * 36 ** 6).toString(36).padStart(6, "0");
    if (!taken.has(id)) return id;
  }
}

// ── Dashboard API ────────────────────────────────────────────────────────────

/** One reward document as the dashboard reads it. */
export interface RewardsDocumentDto<P = RewardPool> {
  pool: P;
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
  override: RewardsDocumentDto<OverridePool>;
  /** The shared pool, what everything the override leaves alone is taken from. */
  shared: Pick<RewardsDocumentDto, "pool" | "problems">;
}

/** An entry that differs between the stored shared document and a proposed one. */
export interface SharedChange {
  where: ListWhere;
  kind: "added" | "removed" | "changed";
  /** The entry's effective id (see `entryIds`). */
  id: string;
  /** Present for `removed` and `changed`. */
  before?: DailyRewardItem;
  /** Present for `added` and `changed`. */
  after?: DailyRewardItem;
}

/** A patch that points at a shared entry which no longer exists. */
export interface Orphan {
  where: ListWhere;
  kind: "remove" | "set";
  id: string;
  /** The item string, when the patch recorded it (`set`). */
  item?: string;
}

/** What saving a proposed shared document would do to one server. */
export interface ServerImpact {
  serverId: string;
  /** False when the server inherits everything because it has no override file. */
  hasOverride: boolean;
  /** Whether the viewer may write this server's override. */
  canEdit: boolean;
  /** Changes this server would inherit; ones it already opted out of are left out. */
  changes: SharedChange[];
  /** Patches that would point at nothing after the save. */
  orphans: Orphan[];
}

/** POST /api/rewards/impact */
export interface RewardsImpactRequest {
  pool: RewardPool;
}
export interface RewardsImpactResponse {
  servers: ServerImpact[];
}

/** Entry ids to act on, in the pool and per streak day. */
export interface ListSelection {
  pool?: string[];
  days?: Record<string, string[]>;
}

/**
 * What to write into one server's override alongside a shared save. `keep`
 * names entries of the stored shared document that this server keeps as they
 * are (detach); `exclude` names entries of the proposed one it does not want.
 */
export interface ServerSelection {
  keep?: ListSelection;
  exclude?: ListSelection;
}

/** PUT /api/rewards */
export interface SharedRewardsWriteBody {
  baseHash: string;
  pool: RewardPool;
  servers?: Record<string, ServerSelection>;
}

/** PUT /api/servers/:id/rewards */
export interface ServerRewardsWriteBody {
  baseHash: string;
  pool: OverridePool;
}

export interface RewardsWriteResult {
  hash: string;
  /** The new hash of each server file written alongside the shared one. */
  servers?: Record<string, { hash: string }>;
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

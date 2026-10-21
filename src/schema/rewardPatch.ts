/**
 * Server overrides as exceptions to the shared reward pool.
 *
 * Everything here is pure, so the bot's claim path, the dashboard backend and
 * the editor resolve a pool the same way:
 *
 *  - `resolvePool` applies an override to the shared document,
 *  - `convertLegacyOverride` turns an old whole-field override into a patch
 *    that resolves to the same pool (the upgrade migration and the loader),
 *  - `diffShared` / `serverImpact` say what a shared edit does to a server,
 *  - `detachEntries` / `excludeEntries` / `reattachEntry` are the edits a
 *    server can make to stop following, or keep following, the shared pool.
 */
import {
  entryIds,
  shortHash,
  weightOf,
  type DailyRewardItem,
  type EntrySet,
  type ListPatch,
  type ListWhere,
  type Orphan,
  type OverridePool,
  type RewardPool,
  type SharedChange,
  type StreakPatch,
} from "./dailyRewards.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const clone = <V>(value: V): V => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as V));

function dayKeys(...maps: Array<Record<string, unknown> | undefined>): string[] {
  const keys = new Set<string>();
  for (const map of maps) for (const key of Object.keys(map ?? {})) keys.add(key);
  return [...keys].sort((a, b) => Number(a) - Number(b));
}

function entryKey(entry: DailyRewardItem, weighted: boolean): string {
  return weighted ? `${entry.item}|${entry.amount}|${weightOf(entry)}` : `${entry.item}|${entry.amount}`;
}

/** Whether two lists hold the same entries, ignoring order and ids. */
export function sameEntries(
  a: readonly DailyRewardItem[] | undefined,
  b: readonly DailyRewardItem[] | undefined,
  weighted: boolean,
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const entry of left) counts.set(entryKey(entry, weighted), (counts.get(entryKey(entry, weighted)) ?? 0) + 1);
  for (const entry of right) {
    const key = entryKey(entry, weighted);
    const n = counts.get(key) ?? 0;
    if (n === 0) return false;
    counts.set(key, n - 1);
  }
  return true;
}

/** Whether two pools hand out the same rewards (the migration's proof). */
export function samePool(a: RewardPool, b: RewardPool): boolean {
  if (!sameEntries(a.default, b.default, true)) return false;
  if ((a.bonusChance ?? 0) !== (b.bonusChance ?? 0)) return false;
  const days = dayKeys(a.streakBonuses, b.streakBonuses);
  return days.every((day) => sameEntries(a.streakBonuses?.[day], b.streakBonuses?.[day], false));
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  while (taken.has(id)) id = `${id}~`;
  taken.add(id);
  return id;
}

// ── Resolving ────────────────────────────────────────────────────────────────

export interface ResolvedList {
  items: DailyRewardItem[];
  orphans: Array<{ kind: "remove" | "set"; id: string; item?: string }>;
}

/**
 * One list with its patch applied: shared entries without the removed ones and
 * with `set` values merged, then the added entries. Every entry carries its
 * effective id. Ids in the patch that match no shared entry are reported as
 * orphans and otherwise ignored.
 */
export function resolveList(
  shared: readonly DailyRewardItem[] | undefined,
  patch: ListPatch | undefined,
  weighted: boolean,
): ResolvedList {
  const base = shared ?? [];
  const ids = entryIds(base);
  const known = new Set(ids);
  const taken = new Set(ids);
  const removed = new Set(patch?.remove ?? []);
  const items: DailyRewardItem[] = [];

  base.forEach((entry, i) => {
    const id = ids[i]!;
    if (removed.has(id)) return;
    const next: DailyRewardItem = { ...entry, id };
    const set = patch?.set?.[id];
    if (set) {
      if (set.amount !== undefined) next.amount = set.amount;
      if (weighted && set.weight !== undefined) next.weight = set.weight;
    }
    items.push(next);
  });

  for (const entry of patch?.add ?? []) {
    items.push({ ...clone(entry), id: uniqueId(entry.id ?? `a${shortHash(entry.item)}`, taken) });
  }

  const orphans: ResolvedList["orphans"] = [];
  for (const id of patch?.remove ?? []) if (!known.has(id)) orphans.push({ kind: "remove", id });
  for (const [id, set] of Object.entries(patch?.set ?? {})) {
    if (!known.has(id)) orphans.push({ kind: "set", id, item: set.item });
  }
  return { items, orphans };
}

export interface ResolvedPool {
  pool: RewardPool;
  orphans: Orphan[];
  /** Why the result cannot be saved or used, e.g. an item pool with nothing left. */
  problems: string[];
}

/** The pool a server uses: the shared document with its override applied. */
export function resolvePool(shared: RewardPool, override: OverridePool | undefined): ResolvedPool {
  const pool: RewardPool = {};
  const orphans: Orphan[] = [];
  const problems: string[] = [];

  if (shared.default !== undefined || override?.default !== undefined) {
    const list = resolveList(shared.default, override?.default, true);
    for (const o of list.orphans) orphans.push({ where: "default", ...o });
    if (list.items.length === 0) problems.push("default: the item pool has no items left");
    pool.default = list.items;
  }

  const base = shared.streakBonuses ?? {};
  const streak: StreakPatch | undefined = override?.streakBonuses;
  const removedDays = new Set(streak?.removeDays ?? []);
  if (shared.streakBonuses !== undefined || streak?.days) {
    const days: Record<string, DailyRewardItem[]> = {};
    for (const day of dayKeys(base, streak?.days)) {
      if (removedDays.has(day)) continue;
      const patch = streak?.days?.[day];
      const where: ListWhere = `streakBonuses.${day}`;
      let items: DailyRewardItem[];
      if (patch) {
        const list = resolveList(base[day], patch, false);
        for (const o of list.orphans) orphans.push({ where, ...o });
        items = list.items;
      } else {
        items = base[day] ?? [];
      }
      if (items.length === 0) {
        problems.push(`streakBonuses.${day}: the day has no items left`);
        continue;
      }
      days[day] = items;
    }
    pool.streakBonuses = days;
  }

  const bonusChance = override?.bonusChance ?? shared.bonusChance;
  if (bonusChance !== undefined) pool.bonusChance = bonusChance;
  return { pool, orphans, problems };
}

// ── Old overrides ────────────────────────────────────────────────────────────

function emptyToUndefined<T extends object>(value: T): T | undefined {
  return Object.keys(value).length > 0 ? value : undefined;
}

/** Drop empty parts, so an override with nothing to say is `{}` and can be deleted. */
export function compactListPatch(patch: ListPatch | undefined): ListPatch | undefined {
  if (!patch) return undefined;
  const out: ListPatch = {};
  if (patch.add?.length) out.add = patch.add;
  if (patch.remove?.length) out.remove = patch.remove;
  if (patch.set && Object.keys(patch.set).length > 0) out.set = patch.set;
  return emptyToUndefined(out);
}

export function compactOverride(override: OverridePool): OverridePool {
  const out: OverridePool = {};
  const pool = compactListPatch(override.default);
  if (pool) out.default = pool;
  const streak: StreakPatch = {};
  const days: Record<string, ListPatch> = {};
  for (const day of dayKeys(override.streakBonuses?.days)) {
    const patch = compactListPatch(override.streakBonuses?.days?.[day]);
    if (patch) days[day] = patch;
  }
  if (Object.keys(days).length > 0) streak.days = days;
  if (override.streakBonuses?.removeDays?.length) streak.removeDays = override.streakBonuses.removeDays;
  if (Object.keys(streak).length > 0) out.streakBonuses = streak;
  if (override.bonusChance !== undefined) out.bonusChance = override.bonusChance;
  return out;
}

/**
 * The patch that turns `shared` into `legacy`. Entries identical on both sides
 * stay inherited; a leftover with the same item string becomes a `set`; the
 * rest are `remove`s and `add`s. The result resolves to the same entries as
 * `legacy` (order aside), which is what the migration checks before writing.
 */
function diffList(
  shared: readonly DailyRewardItem[],
  legacy: readonly DailyRewardItem[],
  weighted: boolean,
): ListPatch | undefined {
  const ids = entryIds(shared);
  const unmatchedShared = new Map<string, number[]>();
  shared.forEach((entry, i) => {
    const key = entryKey(entry, weighted);
    unmatchedShared.set(key, [...(unmatchedShared.get(key) ?? []), i]);
  });

  const leftoverLegacy: DailyRewardItem[] = [];
  for (const entry of legacy) {
    const queue = unmatchedShared.get(entryKey(entry, weighted));
    if (queue && queue.length > 0) queue.shift();
    else leftoverLegacy.push(entry);
  }
  const leftoverShared = new Set<number>([...unmatchedShared.values()].flat());

  const patch: ListPatch = {};
  const taken = new Set(ids);
  const counts = new Map<string, number>();

  for (const entry of leftoverLegacy) {
    let target = -1;
    for (const i of leftoverShared) {
      if (shared[i]!.item === entry.item) {
        target = i;
        break;
      }
    }
    if (target >= 0) {
      leftoverShared.delete(target);
      const before = shared[target]!;
      const set: EntrySet = { item: entry.item };
      if (entry.amount !== before.amount) set.amount = entry.amount;
      if (weighted && weightOf(entry) !== weightOf(before)) set.weight = weightOf(entry);
      (patch.set ??= {})[ids[target]!] = set;
      continue;
    }
    const base = `a${shortHash(entry.item)}`;
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const added: DailyRewardItem = { id: uniqueId(`${base}#${n}`, taken), item: entry.item, amount: entry.amount };
    if (weighted && entry.weight !== undefined) added.weight = entry.weight;
    (patch.add ??= []).push(added);
  }
  if (leftoverShared.size > 0) patch.remove = [...leftoverShared].sort((a, b) => a - b).map((i) => ids[i]!);
  return compactListPatch(patch);
}

/**
 * An old override (whole fields) as a patch. A field that is an exact copy of
 * the shared one becomes no patch at all, so that server follows the shared
 * document from then on.
 */
export function convertLegacyOverride(shared: RewardPool, legacy: RewardPool): OverridePool {
  const out: OverridePool = {};

  if (legacy.default) {
    const patch = diffList(shared.default ?? [], legacy.default, true);
    if (patch) out.default = patch;
  }

  if (legacy.streakBonuses) {
    const days: Record<string, ListPatch> = {};
    const removeDays: string[] = [];
    for (const day of dayKeys(shared.streakBonuses, legacy.streakBonuses)) {
      const theirs = legacy.streakBonuses[day];
      if (!theirs) {
        removeDays.push(day);
        continue;
      }
      const patch = diffList(shared.streakBonuses?.[day] ?? [], theirs, false);
      if (patch) days[day] = patch;
    }
    const streak: StreakPatch = {};
    if (Object.keys(days).length > 0) streak.days = days;
    if (removeDays.length > 0) streak.removeDays = removeDays;
    if (Object.keys(streak).length > 0) out.streakBonuses = streak;
  }

  if (legacy.bonusChance !== undefined && legacy.bonusChance !== (shared.bonusChance ?? 0)) {
    out.bonusChance = legacy.bonusChance;
  }
  return out;
}

// ── What a shared edit does to servers ───────────────────────────────────────

function diffLists(
  where: ListWhere,
  before: readonly DailyRewardItem[] | undefined,
  after: readonly DailyRewardItem[] | undefined,
  weighted: boolean,
): SharedChange[] {
  const oldIds = entryIds(before);
  const newIds = entryIds(after);
  const oldMap = new Map((before ?? []).map((e, i) => [oldIds[i]!, e]));
  const newMap = new Map((after ?? []).map((e, i) => [newIds[i]!, e]));
  const out: SharedChange[] = [];
  for (const [id, entry] of oldMap) {
    const next = newMap.get(id);
    if (!next) out.push({ where, kind: "removed", id, before: entry });
    else if (entryKey(entry, weighted) !== entryKey(next, weighted)) {
      out.push({ where, kind: "changed", id, before: entry, after: next });
    }
  }
  for (const [id, entry] of newMap) if (!oldMap.has(id)) out.push({ where, kind: "added", id, after: entry });
  return out;
}

/** Every entry that differs between two shared documents, pool first, then by day. */
export function diffShared(before: RewardPool, after: RewardPool): SharedChange[] {
  const out = diffLists("default", before.default, after.default, true);
  for (const day of dayKeys(before.streakBonuses, after.streakBonuses)) {
    out.push(...diffLists(`streakBonuses.${day}`, before.streakBonuses?.[day], after.streakBonuses?.[day], false));
  }
  return out;
}

function patchFor(override: OverridePool | undefined, where: ListWhere): ListPatch | undefined {
  if (where === "default") return override?.default;
  return override?.streakBonuses?.days?.[where.slice("streakBonuses.".length)];
}

/** Whether the server inherits this change, or has already opted out of it. */
function inherits(change: SharedChange, override: OverridePool | undefined): boolean {
  if (change.where !== "default") {
    const day = change.where.slice("streakBonuses.".length);
    if (override?.streakBonuses?.removeDays?.includes(day)) return false;
  }
  if (change.kind === "added") return true;
  const patch = patchFor(override, change.where);
  if (patch?.remove?.includes(change.id)) return false;
  if (patch?.add?.some((e) => e.detachedFrom === change.id)) return false;
  if (change.kind === "changed") {
    const set = patch?.set?.[change.id];
    const before = change.before!;
    const after = change.after!;
    const weighted = change.where === "default";
    const itemSame = before.item === after.item;
    const amountPinned = before.amount === after.amount || set?.amount !== undefined;
    const weightPinned = !weighted || weightOf(before) === weightOf(after) || set?.weight !== undefined;
    if (set && itemSame && amountPinned && weightPinned) return false;
  }
  return true;
}

function orphanKey(o: Orphan): string {
  return `${o.where}|${o.kind}|${o.id}`;
}

/**
 * What replacing `before` by `after` as the shared document does to one
 * server: the changes it will inherit, and the `set` patches that would point
 * at nothing afterwards (a removed entry the server had customised).
 */
export function serverImpact(
  before: RewardPool,
  after: RewardPool,
  override: OverridePool | undefined,
): { changes: SharedChange[]; orphans: Orphan[] } {
  const changes = diffShared(before, after).filter((change) => inherits(change, override));
  const known = new Set(resolvePool(before, override).orphans.map(orphanKey));
  const orphans = resolvePool(after, override).orphans.filter((o) => o.kind === "set" && !known.has(orphanKey(o)));
  return { changes, orphans };
}

// ── Editing a server's patch ─────────────────────────────────────────────────

function withList(patch: ListPatch | undefined): ListPatch {
  return {
    ...(patch?.add ? { add: clone(patch.add) } : {}),
    ...(patch?.remove ? { remove: [...patch.remove] } : {}),
    ...(patch?.set ? { set: clone(patch.set) } : {}),
  };
}

/** Local id of the copy that takes over a detached shared entry. */
export function detachedId(sharedId: string): string {
  return `k~${sharedId}`;
}

/**
 * Keep these inherited entries exactly as they are for this server: each gets
 * a local copy (with the server's current values) and the shared one is
 * removed. Later edits to, or deletion of, the shared entry no longer reach it.
 */
export function detachEntries(
  shared: readonly DailyRewardItem[] | undefined,
  patch: ListPatch | undefined,
  ids: readonly string[],
  weighted: boolean,
): ListPatch | undefined {
  const next = withList(patch);
  const resolved = resolveList(shared, patch, weighted).items;
  const own = new Set((patch?.add ?? []).map((e) => e.id));
  const taken = new Set(resolved.map((e) => e.id!));
  for (const id of ids) {
    const entry = resolved.find((e) => e.id === id);
    if (!entry || own.has(id)) continue;
    (next.add ??= []).push({ ...entry, id: uniqueId(detachedId(id), taken), detachedFrom: id });
    if (!next.remove?.includes(id)) (next.remove ??= []).push(id);
    if (next.set) delete next.set[id];
  }
  return compactListPatch(next);
}

/** This server does not want these entries of the (proposed) shared list. */
export function excludeEntries(patch: ListPatch | undefined, ids: readonly string[]): ListPatch | undefined {
  const next = withList(patch);
  for (const id of ids) if (!next.remove?.includes(id)) (next.remove ??= []).push(id);
  return compactListPatch(next);
}

/** Undo a detach: drop the local copy and let the shared entry through again. */
export function reattachEntry(patch: ListPatch | undefined, localId: string): ListPatch | undefined {
  const copy = patch?.add?.find((e) => e.id === localId);
  if (!patch || !copy?.detachedFrom) return compactListPatch(patch);
  const next = withList(patch);
  next.add = next.add?.filter((e) => e.id !== localId);
  next.remove = next.remove?.filter((id) => id !== copy.detachedFrom);
  return compactListPatch(next);
}

// ── Summaries ────────────────────────────────────────────────────────────────

export interface ChangeSummary {
  items: { added: number; removed: number; changed: number };
  /** Entries added, removed or changed inside streak days that exist on both sides. */
  dayItems: { added: number; removed: number; changed: number };
  daysAdded: number;
  daysRemoved: number;
  bonusChanged: boolean;
}

/** Counts of what differs between two pools, for the edit bar. */
export function summarizeChanges(before: RewardPool, after: RewardPool): ChangeSummary {
  const summary: ChangeSummary = {
    items: { added: 0, removed: 0, changed: 0 },
    dayItems: { added: 0, removed: 0, changed: 0 },
    daysAdded: 0,
    daysRemoved: 0,
    bonusChanged: (before.bonusChance ?? 0) !== (after.bonusChance ?? 0),
  };
  const oldDays = new Set(Object.keys(before.streakBonuses ?? {}));
  const newDays = new Set(Object.keys(after.streakBonuses ?? {}));
  for (const day of newDays) if (!oldDays.has(day)) summary.daysAdded++;
  for (const day of oldDays) if (!newDays.has(day)) summary.daysRemoved++;
  for (const change of diffShared(before, after)) {
    if (change.where === "default") {
      summary.items[change.kind]++;
      continue;
    }
    const day = change.where.slice("streakBonuses.".length);
    if (oldDays.has(day) && newDays.has(day)) summary.dayItems[change.kind]++;
  }
  return summary;
}

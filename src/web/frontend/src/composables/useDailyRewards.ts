import { computed, ref } from "vue";
import { apiGet, apiSend } from "../api";
import { topLevelUnits, useEditableDocument } from "./useEditableDocument";
import {
  entryIds,
  newEntryId,
  normalizedWeights,
  roundWeight,
  sharePercent,
  totalWeight,
  weightForPercent,
  weightOf,
  type DailyRewardItem,
  type ListPatch,
  type ListWhere,
  type OverridePool,
  type RewardPool,
  type RewardPoolField,
  type RewardsImpactResponse,
  type ServerImpact,
  type ServerRewardsResponse,
  type ServerSelection,
  type SharedRewardsResponse,
} from "@mcbot/schema/dailyRewards.js";
import {
  compactOverride,
  detachEntries,
  reattachEntry,
  resolvePool,
  summarizeChanges,
  type ChangeSummary,
} from "@mcbot/schema/rewardPatch.js";

const roundTo = (value: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const clone = <V>(value: V): V => JSON.parse(JSON.stringify(value)) as V;

const DAY_PREFIX = "streakBonuses.";
const dayOf = (where: ListWhere): string => where.slice(DAY_PREFIX.length);
export const dayWhere = (day: string | number): ListWhere => `${DAY_PREFIX}${day}`;

/** "" is the shared pool, anything else a server id. */
export type RewardsScope = string;

type Doc = RewardPool | OverridePool;

interface RewardsMeta {
  /** Problems in the file as stored; their entries are not in the draft. */
  problems: string[];
  /** Server scope: the shared pool this server's exceptions apply to. */
  shared?: RewardPool;
  sharedProblems?: string[];
  /** Shared scope: the pool shipped with the bot. */
  shipped?: RewardPool | null;
  exists: boolean;
}

/** How a row relates to the shared pool (always "plain" when editing the shared pool). */
export type RowState = "plain" | "inherited" | "changed" | "added" | "detached" | "removed";

export interface ListRow {
  id: string;
  state: RowState;
  /** What the server uses (for a removed row, the shared entry it does not use). */
  entry: DailyRewardItem;
  /** The shared entry, when the row comes from it. */
  shared?: DailyRewardItem;
}

export type DayState = "plain" | "inherited" | "changed" | "added" | "removed";

export interface DayRow {
  day: string;
  state: DayState;
  rows: ListRow[];
}

/**
 * Editing one reward document: the shared pool, or one server's exceptions.
 *
 * The shared draft is the pool itself. A server's draft is a set of patches
 * (`add`, `remove`, `set` per list), so editing a row that comes from the
 * shared pool writes an exception and never copies the pool. Every list
 * operation takes the list (`"default"` or `"streakBonuses.<day>"`) and an
 * entry id, and does the right thing for the scope it is in.
 *
 * Weights are the stored truth. Percent edits go through weightForPercent,
 * which changes the one item's weight and leaves every other weight as it
 * was, so the others keep their proportions to each other.
 */
export function useDailyRewards() {
  const scope = ref<RewardsScope>("");
  const isShared = computed(() => scope.value === "");

  /** Per server: what to keep or exclude when the shared pool is saved. */
  const selections = ref<Record<string, ServerSelection>>({});

  const editor = useEditableDocument<Doc, RewardsMeta>(
    {
      async load() {
        if (scope.value === "") {
          const res = await apiGet<SharedRewardsResponse>("/api/rewards");
          return {
            doc: res.shared.pool,
            token: res.shared.hash,
            meta: { problems: res.shared.problems, shipped: res.shipped, exists: res.shared.exists },
          };
        }
        const res = await apiGet<ServerRewardsResponse>(
          `/api/servers/${encodeURIComponent(scope.value)}/rewards`,
        );
        return {
          doc: res.override.pool,
          token: res.override.hash,
          meta: {
            problems: res.override.problems,
            shared: res.shared.pool,
            sharedProblems: res.shared.problems,
            exists: res.override.exists,
          },
        };
      },
      async save({ token, draft }) {
        if (scope.value === "") {
          const servers = selections.value;
          await apiSend("PUT", "/api/rewards", {
            baseHash: token,
            pool: draft,
            ...(Object.keys(servers).length > 0 ? { servers } : {}),
          });
          selections.value = {};
          return;
        }
        await apiSend("PUT", `/api/servers/${encodeURIComponent(scope.value)}/rewards`, {
          baseHash: token,
          pool: compactOverride(draft as OverridePool),
        });
      },
    },
    {
      // An override's empty containers (a list nobody changed, a day just
      // started) are not part of what is saved, so they must not count as edits.
      units: {
        read: (doc) =>
          scope.value === "" ? { ...(doc as RewardPool) } : { ...compactOverride(doc as OverridePool) },
        write: topLevelUnits<Doc>().write,
      },
    },
  );

  const draft = computed(() => editor.draft.value);
  const sharedDraft = (): RewardPool | null => (isShared.value ? (editor.draft.value as RewardPool | null) : null);
  const patchDraft = (): OverridePool | null => (isShared.value ? null : (editor.draft.value as OverridePool | null));

  /** The shared pool: the draft itself when editing it, else the one this server's exceptions apply to. */
  const sharedPool = computed<RewardPool>(() =>
    isShared.value ? ((editor.draft.value as RewardPool | null) ?? {}) : (editor.meta.value?.shared ?? {}),
  );

  function resolved(doc: Doc | null): RewardPool {
    if (!doc) return {};
    if (isShared.value) return doc as RewardPool;
    return resolvePool(editor.meta.value?.shared ?? {}, doc as OverridePool).pool;
  }

  /** What the server (or the shared pool) hands out with the draft applied. */
  const effectivePool = computed<RewardPool>(() => resolved(editor.draft.value));
  /** Why the draft cannot be saved, e.g. an item pool or a day with nothing left. */
  const poolProblems = computed<string[]>(() => {
    const d = editor.draft.value;
    if (!d) return [];
    if (isShared.value) {
      const pool = d as RewardPool;
      const out: string[] = [];
      if ((pool.default ?? []).length === 0) out.push("default: the item pool has no items");
      for (const [day, list] of Object.entries(pool.streakBonuses ?? {})) {
        if (list.length === 0) out.push(`streakBonuses.${day}: the day has no items`);
      }
      return out;
    }
    const problems = resolvePool(editor.meta.value?.shared ?? {}, d as OverridePool).problems;
    // A day the admin just started is empty on purpose until it gets an item.
    return problems;
  });

  const items = computed<DailyRewardItem[]>(() => effectivePool.value.default ?? []);
  const total = computed(() => totalWeight(items.value));

  const summary = computed<ChangeSummary | null>(() => {
    if (!editor.baseline.value || !editor.draft.value) return null;
    return summarizeChanges(resolved(editor.baseline.value), resolved(editor.draft.value));
  });

  // ── Undo ─────────────────────────────────────────────────────────────────

  const undoStack = ref<Array<{ label: string; snapshot: string }>>([]);
  /** Bumped by every remembered edit, so the undo bar can show again for each. */
  const undoToken = ref(0);
  const lastUndo = computed(() => undoStack.value.at(-1)?.label ?? null);
  const MAX_UNDO = 30;

  function remember(label: string): void {
    if (!editor.draft.value) return;
    undoStack.value.push({ label, snapshot: JSON.stringify(editor.draft.value) });
    if (undoStack.value.length > MAX_UNDO) undoStack.value.shift();
    undoToken.value++;
  }

  function undo(): void {
    const last = undoStack.value.pop();
    if (last) editor.draft.value = JSON.parse(last.snapshot) as Doc;
  }

  async function open(next: RewardsScope): Promise<boolean> {
    scope.value = next;
    editor.reset();
    undoStack.value = [];
    selections.value = {};
    return editor.load();
  }

  async function save(): Promise<boolean> {
    const ok = await editor.save();
    if (ok) undoStack.value = [];
    return ok;
  }

  // ── Reading lists ────────────────────────────────────────────────────────

  const weightedList = (where: ListWhere): boolean => where === "default";

  function baseList(where: ListWhere): DailyRewardItem[] | undefined {
    const shared = editor.meta.value?.shared;
    return where === "default" ? shared?.default : shared?.streakBonuses?.[dayOf(where)];
  }

  function sharedList(where: ListWhere, create = false): DailyRewardItem[] | undefined {
    const pool = sharedDraft();
    if (!pool) return undefined;
    if (where === "default") {
      if (create) pool.default ??= [];
      return pool.default;
    }
    const day = dayOf(where);
    if (create) (pool.streakBonuses ??= {})[day] ??= [];
    return pool.streakBonuses?.[day];
  }

  function patchOf(where: ListWhere, create = false): ListPatch | undefined {
    const pool = patchDraft();
    if (!pool) return undefined;
    if (where === "default") {
      if (create) pool.default ??= {};
      return pool.default;
    }
    const day = dayOf(where);
    if (create) ((pool.streakBonuses ??= {}).days ??= {})[day] ??= {};
    return pool.streakBonuses?.days?.[day];
  }

  /** The rows of one list, with the state of each against the shared pool. */
  function listRows(where: ListWhere): ListRow[] {
    if (isShared.value) {
      const list = sharedList(where) ?? [];
      const ids = entryIds(list);
      return list.map((entry, i) => ({ id: ids[i]!, state: "plain" as const, entry }));
    }
    const base = baseList(where) ?? [];
    const patch = patchOf(where);
    const ids = entryIds(base);
    const removed = new Set(patch?.remove ?? []);
    const weighted = weightedList(where);
    const rows: ListRow[] = base.map((shared, i) => {
      const id = ids[i]!;
      if (removed.has(id)) return { id, state: "removed" as const, entry: shared, shared };
      const set = patch?.set?.[id];
      if (!set) return { id, state: "inherited" as const, entry: shared, shared };
      const entry: DailyRewardItem = { ...shared };
      if (set.amount !== undefined) entry.amount = set.amount;
      if (weighted && set.weight !== undefined) entry.weight = set.weight;
      return { id, state: "changed" as const, entry, shared };
    });
    for (const add of patch?.add ?? []) {
      rows.push({ id: add.id!, state: add.detachedFrom ? "detached" : "added", entry: add });
    }
    return rows;
  }

  const poolRows = computed<ListRow[]>(() => listRows("default"));

  /** Every streak day, whether it comes from the shared pool, was added here, or was removed here. */
  const dayRows = computed<DayRow[]>(() => {
    if (isShared.value) {
      return Object.keys(sharedDraft()?.streakBonuses ?? {})
        .sort((a, b) => Number(a) - Number(b))
        .map((day) => ({ day, state: "plain" as const, rows: listRows(dayWhere(day)) }));
    }
    const baseDays = Object.keys(editor.meta.value?.shared?.streakBonuses ?? {});
    const patch = patchDraft()?.streakBonuses;
    const removedDays = new Set(patch?.removeDays ?? []);
    const days = new Set([...baseDays, ...Object.keys(patch?.days ?? {})]);
    return [...days]
      .sort((a, b) => Number(a) - Number(b))
      .map((day) => {
        const rows = listRows(dayWhere(day));
        const isBase = baseDays.includes(day);
        const state: DayState = removedDays.has(day)
          ? "removed"
          : !isBase
            ? "added"
            : rows.some((r) => r.state !== "inherited")
              ? "changed"
              : "inherited";
        return { day, state, rows };
      });
  });

  /** Highest streak day in effect, at least 30, for the timeline track. */
  const trackLength = computed(() => {
    const days = dayRows.value.filter((d) => d.state !== "removed").map((d) => Number(d.day));
    return Math.max(30, ...days);
  });

  // ── Editing lists ────────────────────────────────────────────────────────

  function takenIds(where: ListWhere): Set<string> {
    return new Set(listRows(where).map((r) => r.id));
  }

  /** New items start at the pool's average weight, so they are neither rare nor flooding. */
  function addEntry(where: ListWhere, item: string, amount = 1): string | null {
    if (!editor.draft.value) return null;
    const id = newEntryId(takenIds(where));
    const entry: DailyRewardItem = { id, item, amount };
    if (weightedList(where)) {
      const live = listRows(where).filter((r) => r.state !== "removed");
      entry.weight = live.length > 0 ? roundWeight(totalWeight(live.map((r) => r.entry)) / live.length) : 1;
    }
    if (isShared.value) sharedList(where, true)!.push(entry);
    else (patchOf(where, true)!.add ??= []).push(entry);
    return id;
  }

  function removeEntry(where: ListWhere, id: string): void {
    if (!editor.draft.value) return;
    remember("remove");
    if (isShared.value) {
      const list = sharedList(where);
      const at = list ? entryIds(list).indexOf(id) : -1;
      if (at >= 0) list!.splice(at, 1);
      return;
    }
    const patch = patchOf(where, true)!;
    const own = patch.add?.findIndex((e) => e.id === id) ?? -1;
    if (own >= 0) {
      patch.add!.splice(own, 1);
      return;
    }
    if (!patch.remove?.includes(id)) (patch.remove ??= []).push(id);
    if (patch.set) delete patch.set[id];
  }

  /** Let an entry this server removed through again. */
  function restoreEntry(where: ListWhere, id: string): void {
    const patch = patchOf(where);
    if (patch?.remove) patch.remove = patch.remove.filter((r) => r !== id);
  }

  function entryRef(where: ListWhere, id: string): DailyRewardItem | undefined {
    if (isShared.value) {
      const list = sharedList(where);
      const at = list ? entryIds(list).indexOf(id) : -1;
      return at >= 0 ? list![at] : undefined;
    }
    return patchOf(where)?.add?.find((e) => e.id === id);
  }

  /** Change one field of an entry: in place if it is this document's own, else as an exception. */
  function editField(where: ListWhere, id: string, field: "amount" | "weight", value: number): void {
    const own = entryRef(where, id);
    if (own) {
      own[field] = value;
      return;
    }
    const base = baseList(where);
    const shared = base?.[entryIds(base).indexOf(id)];
    if (!shared) return;
    const patch = patchOf(where, true)!;
    const set = (patch.set ??= {});
    const next = { ...(set[id] ?? { item: shared.item }) };
    const baseValue = field === "amount" ? shared.amount : weightOf(shared);
    if (value === baseValue) delete next[field];
    else next[field] = value;
    if (next.amount === undefined && next.weight === undefined) delete set[id];
    else set[id] = next;
  }

  function currentEntry(where: ListWhere, id: string): DailyRewardItem | undefined {
    return listRows(where).find((r) => r.id === id && r.state !== "removed")?.entry;
  }

  function setAmount(where: ListWhere, id: string, amount: number | null): void {
    if (amount === null || !Number.isInteger(amount) || amount < 1) return;
    const row = currentEntry(where, id);
    if (!row || row.amount === amount) return;
    editField(where, id, "amount", amount);
  }

  function setWeight(id: string, weight: number | null): void {
    const row = currentEntry("default", id);
    if (!row || weight === null || weight <= 0) return;
    if (roundTo(weightOf(row), 4) === weight) return;
    editField("default", id, "weight", roundWeight(weight));
  }

  function setPercent(id: string, percent: number | null): void {
    const live = listRows("default").filter((r) => r.state !== "removed");
    const row = live.find((r) => r.id === id);
    if (!row || percent === null) return;
    const all = live.map((r) => r.entry);
    // The field shows the share rounded to 3 digits and PrimeVue re-emits it on
    // blur; converting that rounded figure back would nudge the stored weight.
    if (roundTo(sharePercent(weightOf(row.entry), totalWeight(all)), 3) === percent) return;
    const others = totalWeight(all) - weightOf(row.entry);
    const weight = weightForPercent(percent, others);
    if (weight !== null) editField("default", id, "weight", weight);
  }

  /** Rescale all weights to add up to 100; every item keeps its chance. */
  function normalizeWeights(): void {
    remember("rescale");
    const live = listRows("default").filter((r) => r.state !== "removed");
    normalizedWeights(live.map((r) => r.entry)).forEach((w, i) => {
      const row = live[i]!;
      if (weightOf(row.entry) !== w) editField("default", row.id, "weight", w);
    });
  }

  /** Keep these inherited entries as they are for this server. */
  function detach(where: ListWhere, ids: string[]): void {
    const pool = patchDraft();
    if (!pool) return;
    remember("keep");
    const next = detachEntries(baseList(where), patchOf(where), ids, weightedList(where));
    if (where === "default") {
      if (next) pool.default = next;
      else delete pool.default;
    } else {
      const day = dayOf(where);
      const days = ((pool.streakBonuses ??= {}).days ??= {});
      if (next) days[day] = next;
      else delete days[day];
    }
  }

  /** Undo a detach: drop the local copy and follow the shared entry again. */
  function reattach(where: ListWhere, localId: string): void {
    const pool = patchDraft();
    if (!pool) return;
    const next = reattachEntry(patchOf(where), localId);
    if (where === "default") {
      if (next) pool.default = next;
      else delete pool.default;
    } else {
      const days = ((pool.streakBonuses ??= {}).days ??= {});
      if (next) days[dayOf(where)] = next;
      else delete days[dayOf(where)];
    }
  }

  // ── Streak days ──────────────────────────────────────────────────────────

  function dayExists(day: string): boolean {
    return dayRows.value.some((d) => d.day === day && d.state !== "removed");
  }

  function addDay(day: number): boolean {
    if (!editor.draft.value || !Number.isInteger(day) || day < 1 || day > 999999) return false;
    const key = String(day);
    if (dayExists(key)) return false;
    if (isShared.value) {
      (sharedDraft()!.streakBonuses ??= {})[key] = [];
      return true;
    }
    const pool = patchDraft()!;
    const baseHas = (editor.meta.value?.shared?.streakBonuses ?? {})[key] !== undefined;
    if (baseHas) {
      // A day this server removed comes back as the shared one.
      const streak = pool.streakBonuses;
      if (streak?.removeDays) streak.removeDays = streak.removeDays.filter((d) => d !== key);
    } else {
      patchOf(dayWhere(key), true);
    }
    return true;
  }

  function removeDay(day: string): void {
    if (!editor.draft.value) return;
    remember("remove day");
    if (isShared.value) {
      delete sharedDraft()!.streakBonuses?.[day];
      return;
    }
    const pool = patchDraft()!;
    const baseHas = (editor.meta.value?.shared?.streakBonuses ?? {})[day] !== undefined;
    if (pool.streakBonuses?.days) delete pool.streakBonuses.days[day];
    if (baseHas) {
      const streak = (pool.streakBonuses ??= {});
      if (!streak.removeDays?.includes(day)) (streak.removeDays ??= []).push(day);
    }
  }

  function restoreDay(day: string): void {
    const streak = patchDraft()?.streakBonuses;
    if (streak?.removeDays) streak.removeDays = streak.removeDays.filter((d) => d !== day);
  }

  /** Copy a day's items to a day that does not exist yet. */
  function duplicateDay(from: string, to: number): boolean {
    if (!addDay(to)) return false;
    const target = dayWhere(to);
    for (const row of listRows(dayWhere(from))) {
      if (row.state === "removed") continue;
      addEntry(target, row.entry.item, row.entry.amount);
    }
    return true;
  }

  // ── Whole fields ─────────────────────────────────────────────────────────

  /** Server scope: drop this server's exceptions in one field, so it follows the shared pool again. */
  function resetField(field: RewardPoolField): void {
    const pool = patchDraft();
    if (!pool) return;
    remember(`reset ${field}`);
    delete pool[field];
  }

  function overrides(field: RewardPoolField): boolean {
    const pool = patchDraft();
    if (!pool) return true;
    return compactOverride(pool)[field] !== undefined;
  }

  const bonusChance = computed(() => effectivePool.value.bonusChance ?? 0);

  function setBonusChance(value: number | null): void {
    if (value === null || !editor.draft.value) return;
    const next = Math.min(Math.max(value, 0), 100);
    if (next === bonusChance.value) return;
    if (isShared.value) {
      sharedDraft()!.bonusChance = next;
    } else if (next === (editor.meta.value?.shared?.bonusChance ?? 0)) {
      delete patchDraft()!.bonusChance;
    } else {
      patchDraft()!.bonusChance = next;
    }
  }

  /** Shared scope: replace the draft with the pool shipped with the bot. */
  function applyShippedDefaults(): void {
    const shipped = editor.meta.value?.shipped;
    const pool = sharedDraft();
    if (!shipped || !pool) return;
    remember("defaults");
    for (const field of ["default", "streakBonuses", "bonusChance"] as const) {
      if (shipped[field] === undefined) delete pool[field];
      else (pool as Record<string, unknown>)[field] = clone(shipped[field]);
    }
  }

  // ── Saving the shared pool for the servers that inherit it ───────────────

  /** What saving the shared draft would change per server. Empty for a server's own document. */
  async function loadImpact(): Promise<ServerImpact[]> {
    if (!isShared.value || !editor.draft.value) return [];
    const res = await apiSend<RewardsImpactResponse>("POST", "/api/rewards/impact", { pool: editor.draft.value });
    return res.servers;
  }

  function setSelections(next: Record<string, ServerSelection>): void {
    selections.value = next;
  }

  return {
    ...editor,
    save,
    scope,
    isShared,
    draft,
    open,
    sharedPool,
    effectivePool,
    poolProblems,
    items,
    total,
    summary,
    bonusChance,
    poolRows,
    dayRows,
    trackLength,
    listRows,
    addEntry,
    removeEntry,
    restoreEntry,
    setAmount,
    setWeight,
    setPercent,
    normalizeWeights,
    detach,
    reattach,
    addDay,
    removeDay,
    restoreDay,
    duplicateDay,
    resetField,
    overrides,
    setBonusChance,
    applyShippedDefaults,
    loadImpact,
    setSelections,
    undo,
    lastUndo,
    undoToken,
  };
}

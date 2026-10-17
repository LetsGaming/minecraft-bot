import { computed, ref } from "vue";
import { apiGet, apiSend } from "../api";
import { useEditableDocument } from "./useEditableDocument";
import {
  normalizedWeights,
  roundWeight,
  totalWeight,
  weightForPercent,
  weightOf,
  type DailyRewardItem,
  type RewardPool,
  type RewardPoolField,
  type ServerRewardsResponse,
  type SharedRewardsResponse,
} from "@mcbot/schema/dailyRewards.js";

/** "" is the shared pool, anything else a server id. */
export type RewardsScope = string;

interface RewardsMeta {
  /** Problems in the file as stored; their entries are not in the draft. */
  problems: string[];
  /** Server scope: the shared pool every left-out field falls back to. */
  shared?: RewardPool;
  sharedProblems?: string[];
  /** Shared scope: the pool shipped with the bot. */
  shipped?: RewardPool | null;
  exists: boolean;
}

/**
 * Editing one reward document: the shared pool, or one server's override.
 *
 * Each top-level field (item pool, streak bonuses, bonus chance) is one
 * tracked unit, which is also what an override inherits or replaces. A field
 * missing from an override's draft means "inherit"; switching it on copies
 * the shared value in as the starting point.
 *
 * Weights are the stored truth. Percent edits go through weightForPercent,
 * which changes the one item's weight and leaves every other weight as it
 * was, so the others keep their proportions to each other.
 */
export function useDailyRewards() {
  const scope = ref<RewardsScope>("");

  const editor = useEditableDocument<RewardPool, RewardsMeta>({
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
      const path =
        scope.value === "" ? "/api/rewards" : `/api/servers/${encodeURIComponent(scope.value)}/rewards`;
      await apiSend("PUT", path, { baseHash: token, pool: draft });
    },
  });

  const isShared = computed(() => scope.value === "");
  const draft = computed(() => editor.draft.value);
  const sharedPool = computed<RewardPool>(() => editor.meta.value?.shared ?? {});

  async function open(next: RewardsScope): Promise<boolean> {
    scope.value = next;
    editor.reset();
    return editor.load();
  }

  /** Whether this document sets the field itself (always true for the shared pool's items). */
  function overrides(field: RewardPoolField): boolean {
    return draft.value?.[field] !== undefined;
  }

  /** The value in effect for a field: this document's, else the shared one. */
  function effective<F extends RewardPoolField>(field: F): RewardPool[F] {
    const own = draft.value?.[field];
    if (own !== undefined || isShared.value) return own;
    return sharedPool.value[field];
  }

  /** Switch a field between inherited and overridden; the shared value seeds an override. */
  function setOverride(field: RewardPoolField, on: boolean): void {
    if (!draft.value) return;
    if (!on) {
      editor.setField(field, undefined);
      return;
    }
    const seed = sharedPool.value[field];
    const fallback: Record<RewardPoolField, unknown> = { default: [], streakBonuses: {}, bonusChance: 0 };
    editor.setField(field, JSON.parse(JSON.stringify(seed ?? fallback[field])));
  }

  // ── The item pool ──────────────────────────────────────────────────────────

  const items = computed<DailyRewardItem[]>(() => draft.value?.default ?? []);
  const total = computed(() => totalWeight(items.value));

  function ensurePool(): DailyRewardItem[] | null {
    if (!draft.value) return null;
    draft.value.default ??= [];
    return draft.value.default;
  }

  /** New items start at the pool's average weight, so they are neither rare nor flooding. */
  function addItem(item: string, amount = 1): void {
    const pool = ensurePool();
    if (!pool) return;
    const weight = pool.length > 0 ? roundWeight(totalWeight(pool) / pool.length) : 1;
    pool.push({ item, amount, weight });
  }

  function removeItem(index: number): void {
    draft.value?.default?.splice(index, 1);
  }

  function setPercent(index: number, percent: number | null): void {
    const pool = draft.value?.default;
    const row = pool?.[index];
    if (!pool || !row || percent === null) return;
    const others = totalWeight(pool) - weightOf(row);
    const weight = weightForPercent(percent, others);
    if (weight !== null) row.weight = weight;
  }

  function setWeight(index: number, weight: number | null): void {
    const row = draft.value?.default?.[index];
    if (row && weight !== null && weight > 0) row.weight = roundWeight(weight);
  }

  /** Rescale all weights to add up to 100; every item keeps its chance. */
  function normalizeWeights(): void {
    const pool = draft.value?.default;
    if (!pool) return;
    normalizedWeights(pool).forEach((w, i) => {
      pool[i]!.weight = w;
    });
  }

  // ── Streak bonuses ─────────────────────────────────────────────────────────

  function bonuses(): Record<string, DailyRewardItem[]> | null {
    if (!draft.value) return null;
    draft.value.streakBonuses ??= {};
    return draft.value.streakBonuses;
  }

  function addBonusDay(day: number): boolean {
    const map = bonuses();
    if (!map || !Number.isInteger(day) || day < 1 || map[String(day)]) return false;
    map[String(day)] = [];
    return true;
  }

  function removeBonusDay(day: string): void {
    const map = bonuses();
    if (map) delete map[day];
  }

  function addBonusItem(day: string, item: string, amount = 1): void {
    bonuses()?.[day]?.push({ item, amount });
  }

  function removeBonusItem(day: string, index: number): void {
    bonuses()?.[day]?.splice(index, 1);
  }

  /** Shared scope: replace the draft with the pool shipped with the bot. */
  function applyShippedDefaults(): void {
    const shipped = editor.meta.value?.shipped;
    if (!shipped || !draft.value) return;
    for (const field of ["default", "streakBonuses", "bonusChance"] as const) {
      editor.setField(field, shipped[field] === undefined ? undefined : JSON.parse(JSON.stringify(shipped[field])));
    }
  }

  return {
    ...editor,
    scope,
    isShared,
    sharedPool,
    open,
    overrides,
    effective,
    setOverride,
    items,
    total,
    addItem,
    removeItem,
    setPercent,
    setWeight,
    normalizeWeights,
    addBonusDay,
    removeBonusDay,
    addBonusItem,
    removeBonusItem,
    applyShippedDefaults,
  };
}

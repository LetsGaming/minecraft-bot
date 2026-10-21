<template>
  <div class="pt">
    <div v-if="editable" class="pt-add">
      <label class="pt-add-label" for="rw-pool-add">{{ t("rewards.pool.addLabel") }}</label>
      <ItemPicker input-id="rw-pool-add" :catalog="catalog" @pick="rewards.addEntry('default', $event, 1)" />
    </div>

    <div class="pt-tools">
      <div class="pt-field">
        <label for="rw-filter" class="sr-only">{{ t("rewards.pool.filterLabel") }}</label>
        <InputText id="rw-filter" v-model="filter" :placeholder="t('rewards.pool.filterPlaceholder')" class="pt-filter" />
      </div>
      <div class="pt-field">
        <span id="rw-mode-label" class="pt-label">{{ t("rewards.pool.modeLabel") }}</span>
        <SelectButton
          v-model="mode"
          :options="modeOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          aria-labelledby="rw-mode-label"
          size="small"
        />
      </div>
      <div class="pt-field">
        <label for="rw-sort" class="pt-label">{{ t("rewards.sort.label") }}</label>
        <Select v-model="sortField" input-id="rw-sort" :options="sortOptions" option-label="label" option-value="value" class="pt-sort" />
        <Button
          class="tap"
          :icon="sortDir === 1 ? 'pi pi-sort-amount-up-alt' : 'pi pi-sort-amount-down'"
          :aria-label="sortDir === 1 ? t('rewards.sort.ascending') : t('rewards.sort.descending')"
          :disabled="sortField === 'default'"
          severity="secondary"
          text
          @click="sortDir = sortDir === 1 ? -1 : 1"
        />
      </div>
      <Button
        v-if="editable && mode === 'weight'"
        class="tap"
        :label="t('rewards.pool.normalize')"
        icon="pi pi-percentage"
        severity="secondary"
        outlined
        size="small"
        @click="rewards.normalizeWeights()"
      />
    </div>

    <div class="pt-chips" role="group" :aria-label="t('rewards.rarityFilter')">
      <button
        v-for="rarity in rarities"
        :key="rarity"
        type="button"
        class="pt-chip tap"
        :aria-pressed="rarityFilter === rarity ? 'true' : 'false'"
        @click="rarityFilter = rarityFilter === rarity ? null : rarity"
      >
        <span class="pt-pip" :style="{ '--rarity': rarityColor(rarity) }" aria-hidden="true" />
        {{ rarityLabel(rarity) }}
      </button>
      <button
        v-if="!rewards.isShared.value"
        type="button"
        class="pt-chip tap"
        :aria-pressed="diffOnly ? 'true' : 'false'"
        @click="diffOnly = !diffOnly"
      >
        {{ t("rewards.pool.diffOnly", { count: differing }) }}
      </button>
      <span class="pt-count" role="status">{{ t("rewards.pool.total", { count: liveCount, total: roundTo(totalW, 3) }) }}</span>
    </div>

    <p v-if="views.length === 0" class="pt-empty">{{ t("rewards.pool.empty") }}</p>
    <p v-else-if="sorted.length === 0" class="pt-empty">{{ t("rewards.pool.noMatch", { query: filter || "…" }) }}</p>

    <table v-else class="rw-table">
      <caption class="sr-only">{{ t("rewards.pool.title") }}</caption>
      <thead>
        <tr>
          <th scope="col">{{ t("rewards.col.item") }}</th>
          <th scope="col" class="num">{{ t("rewards.col.amount") }}</th>
          <th scope="col" class="num">{{ mode === "percent" ? t("rewards.col.chance") : t("rewards.col.weight") }}</th>
          <th scope="col">{{ t("rewards.col.rarity") }}</th>
          <th v-if="editable" scope="col"><span class="sr-only">{{ t("rewards.col.actions") }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in pageRows" :key="row.id" :class="[`is-${row.state}`, { 'is-removed': row.removed }]">
          <th scope="row" class="rw-item">
            <span class="rw-item-name">{{ row.name }}</span>
            <RowStateChip :state="row.state" />
            <span class="rw-item-id mono">{{ row.entry.item }}</span>
            <span v-if="!isKnownItem(catalog, row.entry.item)" class="rw-item-warn">{{ t("rewards.notVanilla") }}</span>
          </th>
          <td class="num" :data-label="t('rewards.col.amount')">
            <InputNumber
              v-if="editable && !row.removed"
              :locale="UI_LOCALE"
              :model-value="row.entry.amount"
              :min="1"
              :max="MAX_REWARD_AMOUNT"
              :aria-label="t('rewards.amountOf', { item: row.name })"
              class="rw-num"
              @update:model-value="rewards.setAmount('default', row.id, $event)"
            />
            <span v-else>{{ row.entry.amount }}</span>
            <span v-if="stackNote(catalog, row.entry)" class="rw-sub">{{ stackNote(catalog, row.entry) }}</span>
            <span v-if="row.state === 'changed' && row.shared && row.shared.amount !== row.entry.amount" class="rw-sub">
              {{ t("rewards.was", { value: row.shared.amount }) }}
            </span>
          </td>
          <td class="num" :data-label="mode === 'percent' ? t('rewards.col.chance') : t('rewards.col.weight')">
            <template v-if="editable && !row.removed">
              <InputNumber
                v-if="mode === 'percent'"
                :locale="UI_LOCALE"
                :model-value="roundTo(row.percent, 3)"
                :min="0.001"
                :max="liveCount > 1 ? MAX_SHARE_PERCENT : 100"
                :min-fraction-digits="0"
                :max-fraction-digits="3"
                suffix=" %"
                :disabled="liveCount < 2"
                :aria-label="t('rewards.chanceOf', { item: row.name })"
                class="rw-num"
                @update:model-value="rewards.setPercent(row.id, $event)"
              />
              <InputNumber
                v-else
                :locale="UI_LOCALE"
                :model-value="weightOf(row.entry)"
                :min="0.0001"
                :min-fraction-digits="0"
                :max-fraction-digits="4"
                :aria-label="t('rewards.weightOf', { item: row.name })"
                class="rw-num"
                @update:model-value="rewards.setWeight(row.id, $event)"
              />
            </template>
            <span v-else-if="row.removed">{{ t("rewards.state.notUsed") }}</span>
            <span v-else>{{ mode === "percent" ? `${formatPercent(row.percent)} %` : weightOf(row.entry) }}</span>
            <span v-if="!row.removed" class="rw-sub">
              {{ mode === "percent" ? t("rewards.weightIs", { weight: weightOf(row.entry) }) : `${formatPercent(row.percent)} %` }} · {{ oneInText(row.percent) }}
            </span>
          </td>
          <td :data-label="t('rewards.col.rarity')">
            <span v-if="!row.removed" class="rw-rarity" :style="{ '--rarity': rarityColor(row.rarity) }">
              <span class="rw-rarity-pip" aria-hidden="true" />{{ rarityLabel(row.rarity) }}
            </span>
          </td>
          <td v-if="editable" class="rw-actions">
            <Button
              v-if="row.removed"
              class="tap"
              icon="pi pi-undo"
              severity="secondary"
              text
              :aria-label="t('rewards.restoreItem', { item: row.name })"
              @click="rewards.restoreEntry('default', row.id)"
            />
            <template v-else>
              <Button
                v-if="row.state === 'inherited' || row.state === 'changed'"
                class="tap"
                icon="pi pi-lock"
                severity="secondary"
                text
                :aria-label="t('rewards.keepItem', { item: row.name })"
                @click="rewards.detach('default', [row.id])"
              />
              <Button
                v-if="row.state === 'detached'"
                class="tap"
                icon="pi pi-link"
                severity="secondary"
                text
                :aria-label="t('rewards.reattachItem', { item: row.name })"
                @click="rewards.reattach('default', row.id)"
              />
              <Button
                class="tap"
                icon="pi pi-trash"
                severity="danger"
                text
                :aria-label="t('rewards.removeItem', { item: row.name })"
                @click="rewards.removeEntry('default', row.id)"
              />
            </template>
          </td>
        </tr>
      </tbody>
    </table>

    <PagerNav
      v-if="pages > 1"
      v-model:page="page"
      :pages="pages"
      :label="t('rewards.pool.pages')"
      windowed
      numbered-labels
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import {
  MAX_REWARD_AMOUNT,
  MAX_SHARE_PERCENT,
  rarityOf,
  sharePercent,
  totalWeight,
  weightOf,
} from "@mcbot/schema/dailyRewards.js";
import type { RewardRarity } from "@mcbot/schema/embedCategories.js";
import { useRewardsContext } from "../../composables/rewardsContext";
import type { ListRow } from "../../composables/useDailyRewards";
import {
  REWARD_RARITIES,
  formatPercent,
  isKnownItem,
  itemName,
  oneInText,
  rarityColor,
  rarityLabel,
  rarityRank,
  roundTo,
  stackNote,
} from "../../utils/rewardDisplay";
import ItemPicker from "./ItemPicker.vue";
import RowStateChip from "./RowStateChip.vue";
import PagerNav from "../mods/PagerNav.vue";
import { t, UI_LOCALE } from "../../i18n";

/**
 * The item pool as a compact table: one line per entry, sortable and
 * filterable. Editing a server's pool shows the shared entries too, marked by
 * how this server differs, so nothing is copied and nothing is hidden.
 */
const { rewards, catalog, editable, mode } = useRewardsContext();

type SortField = "default" | "name" | "amount" | "chance" | "rarity";

interface PoolView extends ListRow {
  name: string;
  percent: number;
  rarity: RewardRarity;
  removed: boolean;
}

const PAGE_SIZE = 50;
const rarities = REWARD_RARITIES;

const filter = ref("");
const rarityFilter = ref<RewardRarity | null>(null);
const diffOnly = ref(false);
const sortField = ref<SortField>("default");
const sortDir = ref<1 | -1>(1);
const page = ref(1);

const modeOptions = computed(() => [
  { label: t("rewards.pool.modePercent"), value: "percent" },
  { label: t("rewards.pool.modeWeight"), value: "weight" },
]);
const sortOptions = computed(() => [
  { label: t("rewards.sort.default"), value: "default" },
  { label: t("rewards.sort.name"), value: "name" },
  { label: t("rewards.sort.amount"), value: "amount" },
  { label: t("rewards.sort.chance"), value: "chance" },
  { label: t("rewards.sort.rarity"), value: "rarity" },
]);

const views = computed<PoolView[]>(() => {
  const rows = rewards.poolRows.value;
  const live = rows.filter((r) => r.state !== "removed").map((r) => r.entry);
  const total = totalWeight(live);
  return rows.map((row) => {
    const removed = row.state === "removed";
    return {
      ...row,
      removed,
      name: itemName(catalog.value, row.entry.item),
      percent: removed ? 0 : sharePercent(weightOf(row.entry), total),
      rarity: rarityOf(row.entry, live),
    };
  });
});

const liveCount = computed(() => views.value.filter((v) => !v.removed).length);
const totalW = computed(() => totalWeight(views.value.filter((v) => !v.removed).map((v) => v.entry)));
const differing = computed(() => views.value.filter((v) => v.state !== "inherited" && v.state !== "plain").length);

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return views.value.filter((v) => {
    if (q && !v.entry.item.toLowerCase().includes(q) && !v.name.toLowerCase().includes(q)) return false;
    if (rarityFilter.value && v.rarity !== rarityFilter.value) return false;
    if (diffOnly.value && (v.state === "inherited" || v.state === "plain")) return false;
    return true;
  });
});

const sorted = computed(() => {
  if (sortField.value === "default") return filtered.value;
  const key = (v: PoolView): number | string =>
    sortField.value === "name"
      ? v.name.toLowerCase()
      : sortField.value === "amount"
        ? v.entry.amount
        : sortField.value === "chance"
          ? v.percent
          : rarityRank(v.rarity);
  return [...filtered.value].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sortDir.value;
  });
});

const pages = computed(() => Math.max(1, Math.ceil(sorted.value.length / PAGE_SIZE)));
const pageRows = computed(() => sorted.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));

watch([filter, rarityFilter, diffOnly, sortField, sortDir], () => {
  page.value = 1;
});
watch(pages, (count) => {
  if (page.value > count) page.value = count;
});
</script>

<style scoped>
.pt { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
.pt-add { display: grid; gap: var(--space-1); }
.pt-add-label, .pt-label { font-weight: 600; font-size: var(--text-sm); }
.pt-tools { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-3) var(--space-4); }
.pt-field { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.pt-filter { min-width: 220px; }
.pt-sort { min-width: 140px; }
.pt-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.pt-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-3);
  min-height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
}
.pt-chip[aria-pressed="true"] { color: var(--text); border-color: var(--accent); background: var(--surface); }
.pt-pip { width: 8px; height: 8px; border-radius: 2px; background: var(--rarity); }
.pt-count { margin-left: auto; color: var(--text-dim); font-size: var(--text-sm); }
.pt-empty { margin: 0; color: var(--text-dim); }

.rw-table { width: 100%; border-collapse: collapse; }
.rw-table th, .rw-table td { padding: var(--space-1) var(--space-2); text-align: left; vertical-align: middle; border-bottom: 1px solid var(--border); }
.rw-table thead th { font-size: var(--text-xs); color: var(--text-dim); font-weight: 600; text-transform: uppercase; letter-spacing: var(--tracking-caps); }
.rw-table .num { white-space: nowrap; }
.rw-item { font-weight: 400; display: grid; grid-template-columns: auto auto; justify-content: start; align-items: center; gap: 0 var(--space-2); }
.rw-item-name { font-weight: 600; }
.rw-item-id { grid-column: 1 / -1; color: var(--text-dim); font-size: var(--text-xs); }
.rw-item-warn { grid-column: 1 / -1; color: var(--text-dim); font-size: var(--text-xs); }
.rw-sub { display: block; color: var(--text-dim); font-size: var(--text-xs); }
.rw-num { width: 9ch; }
.rw-num :deep(input) { width: 100%; }
.rw-rarity { display: inline-flex; align-items: center; gap: var(--space-1); white-space: nowrap; }
.rw-rarity-pip { width: 8px; height: 8px; border-radius: 2px; background: var(--rarity); }
.rw-actions { white-space: nowrap; text-align: right; }
tr.is-removed .rw-item-name, tr.is-removed .rw-item-id { text-decoration: line-through; color: var(--text-dim); }

@media (max-width: 760px) {
  .rw-table, .rw-table tbody, .rw-table tr, .rw-table th, .rw-table td { display: block; }
  .rw-table thead { display: none; }
  .rw-table tr { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
  .rw-table th, .rw-table td { border: 0; padding: var(--space-1) 0; }
  .rw-table td[data-label] { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
  .rw-table td[data-label]::before { content: attr(data-label); color: var(--text-dim); font-size: var(--text-sm); }
  .rw-actions { display: flex; justify-content: flex-end; }
  .pt-filter { min-width: 0; width: 100%; }
  .pt-field { width: 100%; }
}
</style>

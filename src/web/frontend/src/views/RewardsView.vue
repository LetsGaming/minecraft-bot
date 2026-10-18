<template>
  <div class="rewards-view">
    <ViewHeader :title="t('rewards.title')" :subtitle="t('rewards.lede')" />

    <EmptyState v-if="scopes.length === 0" icon="pi pi-gift">
      {{ t("rewards.noScopes") }}
    </EmptyState>

    <template v-else>
      <div class="rw-scope">
        <label for="rw-scope" class="rw-scope-label">{{ t("rewards.scopeLabel") }}</label>
        <Select
          input-id="rw-scope"
          :model-value="scope || SHARED"
          :options="scopes"
          option-label="label"
          option-value="value"
          class="rw-scope-select"
          @update:model-value="onScopePick"
        />
        <p class="rw-hint">{{ isShared ? t("rewards.scopeSharedHint") : t("rewards.scopeServerHint") }}</p>
      </div>

      <p v-if="loading && !ready" class="rw-hint" role="status">
        <i class="pi pi-spin pi-spinner" aria-hidden="true" /> {{ t("rewards.loading") }}
      </p>

      <InlineError
        v-else-if="!ready"
        :title="t('rewards.loadFailed')"
        :detail="loadError"
        :busy="loading"
        :heading-level="2"
        @retry="reload"
      />

      <EditorShell v-else :state="editorState" :readonly-reason="t('rewards.readonlyAccess')">
        <template #banners>
          <InlineBanner v-if="problems.length" tone="warn" :title="t('rewards.problemsTitle', { count: problems.length })">
            <p class="rw-banner-text">{{ t("rewards.problemsText") }}</p>
            <ul class="rw-list">
              <li v-for="(line, i) in problems" :key="i" class="mono">{{ line }}</li>
            </ul>
          </InlineBanner>
          <InlineBanner v-if="saveFailure.length" tone="danger" :title="t('rewards.saveFailedTitle')">
            <ul class="rw-list">
              <li v-for="(line, i) in saveFailure" :key="i">{{ line }}</li>
            </ul>
          </InlineBanner>
        </template>

        <template #conflict>
          <ConflictPicker :conflicts="conflicts" @resolve="resolveConflict($event.conflict, $event.choice)" />
        </template>
        <template #conflict-actions>
          <Button
            class="tap"
            :label="t('rewards.dropMine')"
            icon="pi pi-refresh"
            size="small"
            severity="secondary"
            outlined
            @click="reloadDiscardingMine"
          />
        </template>

        <template #bar>
          <EditBar
            :state="editorState"
            :change-count="dirtyKeys.length"
            :conflict-count="conflicts.length"
            :can-save="!stale && poolValid"
            :save-hint="t('rewards.saveHint')"
            @save="onSave"
            @discard="discard"
          >
            <template v-if="isShared && meta?.shipped" #extra>
              <Button
                class="tap"
                :label="t('rewards.useShipped')"
                icon="pi pi-replay"
                size="small"
                severity="secondary"
                outlined
                :disabled="editorState === 'saving'"
                @click="applyShippedDefaults"
              />
            </template>
          </EditBar>
        </template>

        <template #default="{ locked }">
          <!-- ── Item pool ─────────────────────────────────────────── -->
          <section class="rw-card" aria-labelledby="rw-pool-title">
            <header class="rw-head">
              <div class="rw-head-text">
                <h2 id="rw-pool-title">{{ t("rewards.pool.title") }}</h2>
                <p class="rw-hint">{{ t("rewards.pool.lede") }}</p>
              </div>
              <OverrideToggle
                v-if="!isShared"
                id="rw-own-pool"
                :model-value="overrides('default')"
                :label="t('rewards.pool.own')"
                :disabled="locked"
                @update:model-value="setOverride('default', $event)"
              />
            </header>

            <p v-if="!isShared && !overrides('default')" class="rw-inherited">
              <i class="pi pi-link" aria-hidden="true" /> {{ t("rewards.inheritedPool", { count: shownPool.length }) }}
            </p>

            <div class="rw-tools">
              <div class="rw-filter">
                <i class="pi pi-search" aria-hidden="true" />
                <label class="sr-only" for="rw-filter">{{ t("rewards.pool.filterLabel") }}</label>
                <InputText
                  id="rw-filter"
                  v-model="filter"
                  type="search"
                  autocomplete="off"
                  :placeholder="t('rewards.pool.filterPlaceholder')"
                />
              </div>
              <div class="rw-mode">
                <span id="rw-mode-label" class="rw-hint">{{ t("rewards.pool.modeLabel") }}</span>
                <SelectButton
                  v-model="mode"
                  :options="modeOptions"
                  option-label="label"
                  option-value="value"
                  :allow-empty="false"
                  aria-labelledby="rw-mode-label"
                />
              </div>
              <Button
                v-if="poolEditable"
                class="tap"
                :label="t('rewards.pool.normalize')"
                icon="pi pi-percentage"
                size="small"
                severity="secondary"
                text
                :disabled="locked || shownPool.length === 0"
                :title="t('rewards.pool.normalizeHint')"
                @click="normalizeWeights"
              />
            </div>

            <div class="rw-table-wrap">
              <table class="rw-table">
                <caption class="sr-only">{{ t("rewards.pool.title") }}</caption>
                <thead>
                  <tr>
                    <th scope="col">{{ t("rewards.col.item") }}</th>
                    <th scope="col" class="num">{{ t("rewards.col.amount") }}</th>
                    <th scope="col" class="num">{{ mode === "percent" ? t("rewards.col.chance") : t("rewards.col.weight") }}</th>
                    <th scope="col">{{ t("rewards.col.rarity") }}</th>
                    <th v-if="poolEditable" scope="col"><span class="sr-only">{{ t("rewards.col.actions") }}</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in visibleRows" :key="keyOf(row.item)">
                    <th scope="row" class="rw-item">
                      <span class="rw-item-name">{{ nameOf(row.item.item) }}</span>
                      <span class="rw-item-id mono">{{ row.item.item }}</span>
                      <span v-if="!isKnown(row.item.item)" class="rw-item-warn">{{ t("rewards.notVanilla") }}</span>
                    </th>
                    <td class="num">
                      <InputNumber
                        v-if="poolEditable"
                        :model-value="row.item.amount"
                        :min="1"
                        :max="MAX_REWARD_AMOUNT"
                        :disabled="locked"
                        :aria-label="t('rewards.amountOf', { item: nameOf(row.item.item) })"
                        class="rw-num"
                        @update:model-value="setAmount(row.item, $event)"
                      />
                      <span v-else>{{ row.item.amount }}</span>
                      <span v-if="stackNote(row.item)" class="rw-sub">{{ stackNote(row.item) }}</span>
                    </td>
                    <td class="num">
                      <template v-if="poolEditable">
                        <InputNumber
                          v-if="mode === 'percent'"
                          :model-value="round(percentOf(row.item), 3)"
                          :min="0.001"
                          :max="shownPool.length > 1 ? MAX_SHARE_PERCENT : 100"
                          :min-fraction-digits="0"
                          :max-fraction-digits="3"
                          suffix=" %"
                          :disabled="locked || shownPool.length < 2"
                          :aria-label="t('rewards.chanceOf', { item: nameOf(row.item.item) })"
                          class="rw-num"
                          @update:model-value="setPercent(row.index, $event)"
                        />
                        <InputNumber
                          v-else
                          :model-value="weightOf(row.item)"
                          :min="0.0001"
                          :min-fraction-digits="0"
                          :max-fraction-digits="4"
                          :disabled="locked"
                          :aria-label="t('rewards.weightOf', { item: nameOf(row.item.item) })"
                          class="rw-num"
                          @update:model-value="setWeight(row.index, $event)"
                        />
                      </template>
                      <span v-else>{{ mode === "percent" ? `${formatPercent(percentOf(row.item))} %` : weightOf(row.item) }}</span>
                      <span class="rw-sub">{{ mode === "percent" ? t("rewards.weightIs", { weight: weightOf(row.item) }) : `${formatPercent(percentOf(row.item))} %` }} · {{ oneIn(row.item) }}</span>
                    </td>
                    <td>
                      <span class="rw-rarity">{{ rarityLabel(row.item) }}</span>
                    </td>
                    <td v-if="poolEditable" class="rw-actions">
                      <Button
                        class="tap"
                        icon="pi pi-trash"
                        severity="danger"
                        text
                        :disabled="locked"
                        :aria-label="t('rewards.removeItem', { item: nameOf(row.item.item) })"
                        @click="removeItem(row.index)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
              <EmptyState v-if="visibleRows.length === 0" icon="pi pi-box">
                {{ filter ? t("rewards.pool.noMatch", { query: filter }) : t("rewards.pool.empty") }}
              </EmptyState>
              <div v-if="hiddenRows > 0" class="rw-more">
                <span class="rw-hint">{{ t("rewards.pool.moreHidden", { count: hiddenRows }) }}</span>
                <Button :label="t('rewards.pool.showAll')" size="small" severity="secondary" text class="tap" @click="showAll = true" />
              </div>
            </div>

            <p class="rw-total">
              {{ t("rewards.pool.total", { count: shownPool.length, total: round(poolTotal, 3) }) }}
            </p>

            <div v-if="poolEditable" class="rw-add">
              <label for="rw-add-item" class="rw-add-label">{{ t("rewards.pool.addLabel") }}</label>
              <ItemPicker input-id="rw-add-item" :catalog="catalog" :disabled="locked" @pick="addItem($event)" />
            </div>
          </section>

          <!-- ── Streak bonuses ────────────────────────────────────── -->
          <section class="rw-card" aria-labelledby="rw-streak-title">
            <header class="rw-head">
              <div class="rw-head-text">
                <h2 id="rw-streak-title">{{ t("rewards.streak.title") }}</h2>
                <p class="rw-hint">{{ t("rewards.streak.lede", { cycle }) }}</p>
              </div>
              <OverrideToggle
                v-if="!isShared"
                id="rw-own-streak"
                :model-value="overrides('streakBonuses')"
                :label="t('rewards.streak.own')"
                :disabled="locked"
                @update:model-value="setOverride('streakBonuses', $event)"
              />
            </header>

            <p v-if="!isShared && !overrides('streakBonuses')" class="rw-inherited">
              <i class="pi pi-link" aria-hidden="true" /> {{ t("rewards.inheritedStreak", { count: bonusDays.length }) }}
            </p>

            <EmptyState v-if="bonusDays.length === 0" icon="pi pi-calendar">
              {{ t("rewards.streak.empty") }}
            </EmptyState>

            <ol class="rw-days">
              <li v-for="day in bonusDays" :key="day" class="rw-day">
                <div class="rw-day-head">
                  <h3>{{ t("rewards.streak.day", { day }) }}</h3>
                  <Button
                    v-if="streakEditable"
                    class="tap"
                    icon="pi pi-trash"
                    severity="danger"
                    text
                    size="small"
                    :disabled="locked"
                    :aria-label="t('rewards.streak.removeDay', { day })"
                    @click="removeBonusDay(day)"
                  />
                </div>
                <ul class="rw-day-items">
                  <li v-for="(entry, index) in bonusItems(day)" :key="keyOf(entry)" class="rw-day-item">
                    <span class="rw-item">
                      <span class="rw-item-name">{{ nameOf(entry.item) }}</span>
                      <span class="rw-item-id mono">{{ entry.item }}</span>
                      <span v-if="!isKnown(entry.item)" class="rw-item-warn">{{ t("rewards.notVanilla") }}</span>
                    </span>
                    <InputNumber
                      v-if="streakEditable"
                      :model-value="entry.amount"
                      :min="1"
                      :max="MAX_REWARD_AMOUNT"
                      :disabled="locked"
                      :aria-label="t('rewards.amountOf', { item: nameOf(entry.item) })"
                      class="rw-num"
                      @update:model-value="setAmount(entry, $event)"
                    />
                    <span v-else class="rw-amount">× {{ entry.amount }}</span>
                    <Button
                      v-if="streakEditable"
                      class="tap"
                      icon="pi pi-times"
                      severity="secondary"
                      text
                      size="small"
                      :disabled="locked"
                      :aria-label="t('rewards.removeItem', { item: nameOf(entry.item) })"
                      @click="removeBonusItem(day, index)"
                    />
                  </li>
                </ul>
                <p v-if="bonusItems(day).length === 0" class="rw-item-warn">{{ t("rewards.streak.dayEmpty") }}</p>
                <ItemPicker
                  v-if="streakEditable"
                  :input-id="`rw-day-${day}`"
                  :catalog="catalog"
                  :disabled="locked"
                  :placeholder="t('rewards.streak.addItemPlaceholder')"
                  @pick="addBonusItem(day, $event)"
                />
              </li>
            </ol>

            <div v-if="streakEditable" class="rw-add-day">
              <label for="rw-new-day" class="rw-add-label">{{ t("rewards.streak.addDayLabel") }}</label>
              <InputNumber v-model="newDay" input-id="rw-new-day" :min="1" :max="999999" :disabled="locked" class="rw-num" />
              <Button
                class="tap"
                icon="pi pi-plus"
                :label="t('rewards.streak.addDay')"
                severity="secondary"
                outlined
                :disabled="locked || !newDay || bonusDays.includes(String(newDay))"
                @click="onAddDay"
              />
            </div>
          </section>

          <!-- ── Bonus chance ──────────────────────────────────────── -->
          <section class="rw-card" aria-labelledby="rw-bonus-title">
            <header class="rw-head">
              <div class="rw-head-text">
                <h2 id="rw-bonus-title">{{ t("rewards.bonus.title") }}</h2>
                <p class="rw-hint">{{ t("rewards.bonus.lede") }}</p>
              </div>
              <OverrideToggle
                v-if="!isShared"
                id="rw-own-bonus"
                :model-value="overrides('bonusChance')"
                :label="t('rewards.bonus.own')"
                :disabled="locked"
                @update:model-value="setOverride('bonusChance', $event)"
              />
            </header>
            <div class="rw-bonus">
              <label for="rw-bonus" class="sr-only">{{ t("rewards.bonus.title") }}</label>
              <InputNumber
                input-id="rw-bonus"
                :model-value="bonusChance"
                :min="0"
                :max="100"
                :max-fraction-digits="2"
                suffix=" %"
                :disabled="locked || !bonusEditable"
                class="rw-num"
                @update:model-value="setBonusChance"
              />
              <span v-if="!isShared && !overrides('bonusChance')" class="rw-hint">{{ t("rewards.inheritedValue") }}</span>
            </div>
          </section>
        </template>
      </EditorShell>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { useConfirm } from "primevue/useconfirm";
import { useNotify } from "../composables/useNotify";
import {
  MAX_REWARD_AMOUNT,
  MAX_SHARE_PERCENT,
  milestoneDays,
  rarityOf,
  sharePercent,
  totalWeight,
  weightOf,
  type DailyRewardItem,
} from "@mcbot/schema/dailyRewards.js";
import { RARITY_STYLE } from "@mcbot/schema/embedCategories.js";
import { useDailyRewards } from "../composables/useDailyRewards";
import { useCapabilities } from "../composables/useCapabilities";
import { confirmLeave } from "../composables/useUnsavedGuard";
import { discardPrompt } from "../composables/useDiscardPrompt";
import { loadItemCatalog, lookupItem, nameFromId, vanillaId, type ItemCatalog } from "../utils/minecraftItems";
import ViewHeader from "../components/ui/ViewHeader.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import EditorShell from "../components/ui/EditorShell.vue";
import EditBar from "../components/ui/EditBar.vue";
import InlineBanner from "../components/ui/InlineBanner.vue";
import InlineError from "../components/ui/InlineError.vue";
import ConflictPicker from "../components/schema/ConflictPicker.vue";
import ItemPicker from "../components/rewards/ItemPicker.vue";
import OverrideToggle from "../components/rewards/OverrideToggle.vue";
import type { EditorState } from "../components/ui/types";
import { t, type MessageKey } from "../i18n";

/** The scope picker's value for the shared pool (a Select treats "" as nothing picked). */
const SHARED = "\u0000shared";

/** Rows rendered before "Show all", so a 200-item pool opens quickly. */
const ROWS_SHOWN = 60;

interface PoolRow {
  item: DailyRewardItem;
  /** Position in the pool, which the edits address. */
  index: number;
}

// Stable v-for keys for objects that have no id of their own.
const objectKeys = new WeakMap<object, number>();
let nextKey = 1;

export default defineComponent({
  name: "RewardsView",
  components: {
    Button, InputNumber, InputText, Select, SelectButton,
    ViewHeader, EmptyState, EditorShell, EditBar, InlineBanner, InlineError, ConflictPicker,
    ItemPicker, OverrideToggle,
  },
  props: {
    serverIds: { type: Array as () => string[], default: () => [] },
    /** The server the URL names; empty is the shared pool. */
    server: { type: String, default: "" },
  },
  emits: ["update-route"],
  setup() {
    const confirm = useConfirm();
    return {
      ...useDailyRewards(),
      ...useCapabilities(),
      ask: discardPrompt(confirm),
      notify: useNotify(),
      t,
      weightOf,
      MAX_REWARD_AMOUNT,
      MAX_SHARE_PERCENT,
      SHARED,
    };
  },
  data() {
    return {
      catalog: null as ItemCatalog | null,
      filter: "",
      mode: "percent" as "percent" | "weight",
      showAll: false,
      newDay: null as number | null,
    };
  },
  computed: {
    canReadShared(): boolean {
      return this.can("config:read");
    },
    scopes(): Array<{ label: string; value: string }> {
      const out: Array<{ label: string; value: string }> = [];
      if (this.canReadShared) out.push({ label: t("rewards.scopeShared"), value: SHARED });
      for (const id of this.serversWith("config:read", this.serverIds)) {
        out.push({ label: t("rewards.scopeServer", { server: id }), value: id });
      }
      return out;
    },
    canWrite(): boolean {
      return this.isShared ? this.can("config:write") : this.can("config:write", this.scope);
    },
    editorState(): EditorState {
      if (!this.canWrite) return "readonly";
      if (this.saving) return "saving";
      if (this.conflicts.length > 0) return "conflict";
      if (this.dirty) return "dirty";
      return "clean";
    },
    modeOptions(): Array<{ label: string; value: string }> {
      return [
        { label: t("rewards.pool.modePercent"), value: "percent" },
        { label: t("rewards.pool.modeWeight"), value: "weight" },
      ];
    },
    problems(): string[] {
      return [...(this.meta?.problems ?? []), ...(this.isShared ? [] : (this.meta?.sharedProblems ?? []).map((p) => t("rewards.sharedProblem", { problem: p })))];
    },
    saveFailure(): string[] {
      if (this.conflicts.length > 0) return [];
      return [...(this.saveError ? [this.saveError] : []), ...this.fieldErrors];
    },
    poolEditable(): boolean {
      return this.canWrite && (this.isShared || this.overrides("default"));
    },
    streakEditable(): boolean {
      return this.canWrite && (this.isShared || this.overrides("streakBonuses"));
    },
    bonusEditable(): boolean {
      return this.canWrite && (this.isShared || this.overrides("bonusChance"));
    },
    /** The pool in effect: this document's, or the inherited one. */
    shownPool(): DailyRewardItem[] {
      return this.effective("default") ?? [];
    },
    poolTotal(): number {
      return totalWeight(this.shownPool);
    },
    filteredRows(): PoolRow[] {
      const q = this.filter.trim().toLowerCase();
      const rows = this.shownPool.map((item, index) => ({ item, index }));
      if (!q) return rows;
      return rows.filter(({ item }) =>
        item.item.toLowerCase().includes(q) || this.nameOf(item.item).toLowerCase().includes(q),
      );
    },
    visibleRows(): PoolRow[] {
      return this.showAll ? this.filteredRows : this.filteredRows.slice(0, ROWS_SHOWN);
    },
    hiddenRows(): number {
      return this.filteredRows.length - this.visibleRows.length;
    },
    bonusMap(): Record<string, DailyRewardItem[]> {
      return this.effective("streakBonuses") ?? {};
    },
    bonusDays(): string[] {
      return milestoneDays(this.bonusMap).map(String);
    },
    cycle(): number {
      const days = milestoneDays(this.bonusMap);
      return days.length > 0 ? days[days.length - 1]! : 35;
    },
    bonusChance(): number {
      return this.effective("bonusChance") ?? 0;
    },
    /** A shared pool with no items cannot be saved: every server falls back to it. */
    poolValid(): boolean {
      const ownBonuses = this.draft?.streakBonuses;
      if (ownBonuses && Object.values(ownBonuses).some((list) => list.length === 0)) return false;
      if (this.isShared) return this.items.length > 0;
      return !this.overrides("default") || this.items.length > 0;
    },
  },
  watch: {
    server() {
      void this.syncScope();
    },
    serverIds() {
      void this.syncScope();
    },
    scopes() {
      void this.syncScope();
    },
  },
  async mounted() {
    void this.syncScope();
    try {
      this.catalog = await loadItemCatalog();
    } catch {
      // The editor works without names; ids are shown instead.
    }
  },
  methods: {
    round(value: number, digits: number): number {
      const f = 10 ** digits;
      return Math.round(value * f) / f;
    },
    keyOf(obj: object): number {
      let key = objectKeys.get(obj);
      if (key === undefined) {
        key = nextKey++;
        objectKeys.set(obj, key);
      }
      return key;
    },
    nameOf(item: string): string {
      return lookupItem(this.catalog, item)?.name ?? nameFromId(item);
    },
    /** Vanilla items are checked against the list; a modded id is taken on trust. */
    isKnown(item: string): boolean {
      if (!this.catalog || vanillaId(item) === null) return true;
      return lookupItem(this.catalog, item) !== undefined;
    },
    stackNote(item: DailyRewardItem): string {
      const stack = lookupItem(this.catalog, item.item)?.stackSize;
      if (!stack || item.amount <= stack) return "";
      return t("rewards.stacks", { count: Math.ceil(item.amount / stack) });
    },
    percentOf(item: DailyRewardItem): number {
      return sharePercent(weightOf(item), this.poolTotal);
    },
    formatPercent(value: number): string {
      return value >= 10 ? value.toFixed(1) : value >= 1 ? value.toFixed(2) : value.toPrecision(2);
    },
    oneIn(item: DailyRewardItem): string {
      const p = this.percentOf(item);
      return p > 0 ? t("rewards.oneIn", { count: Math.max(1, Math.round(100 / p)) }) : "";
    },
    rarityLabel(item: DailyRewardItem): string {
      const rarity = rarityOf(item, this.shownPool);
      return `${RARITY_STYLE[rarity].icon} ${t(`appearance.key.rarity.${rarity}` as MessageKey)}`;
    },
    bonusItems(day: string): DailyRewardItem[] {
      return this.bonusMap[day] ?? [];
    },
    setAmount(item: DailyRewardItem, value: number | null): void {
      if (value !== null && Number.isInteger(value) && value >= 1) item.amount = Math.min(value, MAX_REWARD_AMOUNT);
    },
    setBonusChance(value: number | null): void {
      if (this.draft && value !== null) this.setField("bonusChance", Math.min(Math.max(value, 0), 100));
    },
    onAddDay(): void {
      if (this.newDay && this.addBonusDay(this.newDay)) this.newDay = null;
    },
    /**
     * Open the scope the URL names, or the first one this user may see. An
     * unknown or forbidden server in the URL is replaced, never shown empty.
     */
    async syncScope(): Promise<void> {
      if (this.scopes.length === 0) return;
      const wanted = this.server || SHARED;
      const allowed = this.scopes.some((s) => s.value === wanted);
      const first = this.scopes[0]!.value;
      const target = allowed ? this.server : first === SHARED ? "" : first;
      if (target !== this.server) {
        // Server ids arrive with the status poll; wait for them before
        // calling a server in the URL unknown.
        if (this.server && this.serverIds.length === 0) return;
        this.$emit("update-route", { params: { server: target || undefined } });
        return;
      }
      if (this.ready && this.scope === target) return;
      if (this.loading && this.scope === target) return;
      this.filter = "";
      this.showAll = false;
      await this.open(target);
    },
    async onScopePick(picked: string): Promise<void> {
      const value = picked === SHARED ? "" : picked;
      if (value === this.scope) return;
      if (!(await confirmLeave(this.ask))) return;
      this.discard();
      this.$emit("update-route", { params: { server: value || undefined } });
    },
    async reload(): Promise<void> {
      await this.open(this.scope);
    },
    async onSave(): Promise<void> {
      const ok = await this.save();
      if (ok) {
        this.notify.ok(t("rewards.savedToast"), t("rewards.savedToastDetail"));
      }
    },
  },
});
</script>

<style scoped>
.rewards-view { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.rw-hint { color: var(--text-dim); font-size: var(--text-sm); margin: 0; }
.rw-scope { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.rw-scope-label { font-weight: 600; }
.rw-scope-select { min-width: 240px; max-width: 100%; }
.rw-scope .rw-hint { flex-basis: 100%; }
.rw-list { margin: 0; padding-left: var(--space-4); overflow-wrap: anywhere; }
.rw-banner-text { margin: 0 0 var(--space-2); }

.rw-card {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.rw-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
.rw-head-text { min-width: 0; flex: 1 1 280px; }
.rw-head h2 { margin: 0 0 var(--space-1); font-size: var(--text-xl); }
.rw-inherited {
  margin: 0; padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-control); background: var(--surface-raised);
  color: var(--text-dim); font-size: var(--text-sm);
}

.rw-tools { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); }
.rw-filter { position: relative; flex: 1 1 220px; min-width: 0; }
.rw-filter .pi { position: absolute; left: var(--space-3); top: 50%; transform: translateY(-50%); color: var(--text-dim); pointer-events: none; }
.rw-filter :deep(.p-inputtext) { width: 100%; padding-left: 36px; }
.rw-mode { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

.rw-table-wrap { min-width: 0; overflow-x: auto; }
.rw-table { width: 100%; border-collapse: collapse; }
.rw-table th, .rw-table td { padding: var(--space-2); border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
.rw-table thead th { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: var(--tracking-caps); color: var(--text-dim); font-weight: 600; }
.rw-table .num { text-align: right; }
.rw-item { display: flex; flex-direction: column; min-width: 0; font-weight: normal; }
.rw-item-name { font-weight: 600; overflow-wrap: anywhere; }
.rw-item-id { font-size: var(--text-xs); color: var(--text-dim); overflow-wrap: anywhere; }
.rw-item-warn { font-size: var(--text-xs); color: var(--st-degraded); margin: 0; }
.rw-sub { display: block; font-size: var(--text-xs); color: var(--text-dim); }
.rw-num :deep(.p-inputnumber-input) { width: 9ch; text-align: right; }
.rw-rarity { white-space: nowrap; font-size: var(--text-sm); }
.rw-actions { width: 1%; white-space: nowrap; }
.rw-more { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) 0; flex-wrap: wrap; }
.rw-total { margin: 0; font-size: var(--text-sm); color: var(--text-dim); }
.rw-add, .rw-add-day { display: flex; flex-direction: column; gap: var(--space-1); max-width: 560px; }
.rw-add-day { flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.rw-add-label { font-weight: 600; font-size: var(--text-sm); }

.rw-days {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
}
.rw-day {
  border: 1px solid var(--border); border-radius: var(--radius-control);
  padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); min-width: 0;
}
.rw-day-head { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.rw-day-head h3 { margin: 0; font-size: var(--text-md); }
.rw-day-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
.rw-day-item { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: var(--space-2); }
.rw-amount { color: var(--text-dim); }
.rw-bonus { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }

@media (max-width: 600px) {
  .rw-table thead { display: none; }
  .rw-table tr { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1) var(--space-2); padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
  .rw-table th, .rw-table td { border: 0; padding: 0; }
  .rw-table .rw-item { grid-column: 1 / -1; }
  .rw-table .num { text-align: left; }
}
</style>

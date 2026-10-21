<template>
  <div class="st">
    <div class="st-track" aria-hidden="true">
      <span
        v-for="d in days"
        :key="d.day"
        class="st-dot"
        :class="`is-${d.state}`"
        :style="{ left: `${position(d.day)}%` }"
      />
      <span class="st-end">{{ length }}</span>
    </div>

    <p v-if="days.length === 0" class="st-empty">{{ t("rewards.streak.empty") }}</p>
    <ol v-else ref="list" class="st-list" :aria-label="t('rewards.streak.listLabel')" @keydown="onKey">
      <li v-for="(d, i) in days" :key="d.day" class="st-item">
        <button
          type="button"
          class="st-chip"
          :class="[`is-${d.state}`, { 'is-selected': d.day === selected }]"
          :aria-pressed="d.day === selected ? 'true' : 'false'"
          :tabindex="focusable === i ? 0 : -1"
          :data-day="d.day"
          @click="select(d.day)"
          @focus="focusable = i"
        >
          <span class="st-day">{{ t("rewards.streak.day", { day: d.day }) }}</span>
          <span class="st-count">{{ t("rewards.streak.items", { count: liveCount(d) }) }}</span>
          <RowStateChip :state="d.state" />
          <span v-if="liveCount(d) === 0 && d.state !== 'removed'" class="st-warn">{{ t("rewards.streak.dayEmptyShort") }}</span>
        </button>
      </li>
    </ol>

    <form v-if="editable" class="st-add" @submit.prevent="add">
      <label for="rw-new-day" class="st-add-label">{{ t("rewards.streak.addDayLabel") }}</label>
      <InputNumber v-model="newDay" input-id="rw-new-day" :locale="UI_LOCALE" :min="1" :max="999999" class="st-add-input" />
      <Button class="tap" type="submit" icon="pi pi-plus" :label="t('rewards.streak.addDay')" severity="secondary" outlined :disabled="!newDay" />
    </form>
    <p v-if="addError" class="st-error" role="alert">{{ addError }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import { useRewardsContext } from "../../composables/rewardsContext";
import type { DayRow } from "../../composables/useDailyRewards";
import RowStateChip from "./RowStateChip.vue";
import { t, UI_LOCALE } from "../../i18n";

/**
 * The milestone days as a strip. The thin track above is an overview of where
 * they fall between day 1 and the end of the cycle; the buttons below are the
 * controls, in order, with arrow keys moving between them.
 */
defineProps<{ selected: string | null }>();
const emit = defineEmits<{ select: [day: string] }>();

const { rewards, editable } = useRewardsContext();

const days = computed(() => rewards.dayRows.value);
const length = computed(() => rewards.trackLength.value);
const list = ref<HTMLElement | null>(null);
const focusable = ref(0);
const newDay = ref<number | null>(null);
const addError = ref("");

function position(day: string): number {
  return Math.min(100, (Number(day) / length.value) * 100);
}

function liveCount(d: DayRow): number {
  return d.rows.filter((r) => r.state !== "removed").length;
}

function select(day: string): void {
  emit("select", day);
}

function add(): void {
  addError.value = "";
  if (!newDay.value) return;
  const day = newDay.value;
  if (!rewards.addDay(day)) {
    addError.value = t("rewards.streak.dayExists", { day });
    return;
  }
  newDay.value = null;
  emit("select", String(day));
}

function onKey(event: KeyboardEvent): void {
  const count = days.value.length;
  if (count === 0) return;
  const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  let next = focusable.value;
  if (back) next = (next - 1 + count) % count;
  else if (forward) next = (next + 1) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else return;
  event.preventDefault();
  focusable.value = next;
  void nextTick(() => list.value?.querySelector<HTMLElement>(`[data-day="${days.value[next]!.day}"]`)?.focus());
}

</script>

<style scoped>
.st { display: grid; gap: var(--space-3); min-width: 0; }
.st-track { position: relative; height: 14px; margin: 0 var(--space-2); }
.st-track::before { content: ""; position: absolute; left: 0; right: 0; top: 6px; height: 2px; background: var(--border-strong); border-radius: var(--radius-full); }
.st-dot { position: absolute; top: 2px; width: 10px; height: 10px; margin-left: -5px; border-radius: var(--radius-full); background: var(--text-dim); }
.st-dot.is-added, .st-dot.is-changed { background: var(--accent); }
.st-dot.is-removed { background: transparent; border: 1px solid var(--text-dim); }
.st-end { position: absolute; right: 0; top: -14px; font-size: var(--text-xs); color: var(--text-dim); }
.st-empty { margin: 0; color: var(--text-dim); }
.st-list { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.st-chip {
  display: grid;
  gap: 2px var(--space-3);
  justify-items: start;
  min-width: 112px;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.st-chip:hover { border-color: var(--accent); }
.st-chip.is-selected { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.st-chip.is-removed { color: var(--text-dim); }
.st-chip.is-removed .st-day { text-decoration: line-through; }
.st-day { font-weight: 600; }
.st-count { font-size: var(--text-sm); color: var(--text-dim); }
.st-warn { font-size: var(--text-xs); color: var(--text); }
.st-add { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.st-add-label { font-weight: 600; font-size: var(--text-sm); }
.st-add-input { width: 9ch; }
.st-add-input :deep(input) { width: 100%; }
.st-error { margin: 0; color: var(--text); font-size: var(--text-sm); }

@media (max-width: 760px) {
  .st-track { display: none; }
  .st-list { flex-direction: column; }
  .st-chip { width: 100%; grid-template-columns: auto 1fr auto; align-items: center; min-height: var(--touch-min); }
}
</style>

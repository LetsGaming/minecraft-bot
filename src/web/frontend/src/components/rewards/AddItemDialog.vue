<template>
  <Dialog
    :visible="item !== null"
    modal
    :header="t('rewards.add.title', { item: name })"
    :style="{ width: 'min(440px, calc(100vw - 32px))' }"
    @update:visible="(open) => !open && emit('close')"
    @show="focusAmount"
  >
    <form id="rw-add-form" class="ai" @submit.prevent="confirm">
      <p class="ai-id mono">{{ item }}</p>
      <p v-if="item && !isKnownItem(catalog, item)" class="ai-note">{{ t("rewards.notVanilla") }}</p>
      <p v-if="duplicate" class="ai-note">{{ t("rewards.add.duplicate", { item: name }) }}</p>

      <div class="ai-field">
        <label for="rw-add-amount" class="ai-label">{{ t("rewards.col.amount") }}</label>
        <InputNumber
          ref="amountInput"
          v-model="amount"
          input-id="rw-add-amount"
          :locale="UI_LOCALE"
          :min="1"
          :max="MAX_REWARD_AMOUNT"
          class="ai-num"
        />
        <span v-if="stack" class="ai-hint">{{ stack }}</span>
      </div>

      <div v-if="withChance" class="ai-field">
        <label for="rw-add-chance" class="ai-label">{{ mode === "percent" ? t("rewards.col.chance") : t("rewards.col.weight") }}</label>
        <InputNumber
          v-if="mode === 'percent'"
          v-model="percent"
          input-id="rw-add-chance"
          :locale="UI_LOCALE"
          :min="0.001"
          :max="hasOthers ? MAX_SHARE_PERCENT : 100"
          :min-fraction-digits="0"
          :max-fraction-digits="3"
          suffix=" %"
          :disabled="!hasOthers"
          class="ai-num"
        />
        <InputNumber
          v-else
          v-model="weight"
          input-id="rw-add-chance"
          :locale="UI_LOCALE"
          :min="0.0001"
          :min-fraction-digits="0"
          :max-fraction-digits="4"
          class="ai-num"
        />
        <span class="ai-hint">{{ chanceHint }}</span>
      </div>
    </form>

    <template #footer>
      <Button class="tap" :label="t('rewards.add.cancel')" severity="secondary" outlined @click="emit('close')" />
      <Button class="tap" type="submit" form="rw-add-form" icon="pi pi-plus" :label="t('rewards.add.confirm')" :disabled="!valid" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import { MAX_REWARD_AMOUNT, MAX_SHARE_PERCENT, roundWeight, sharePercent, weightForPercent, type ListWhere } from "@mcbot/schema/dailyRewards.js";
import { useRewardsContext } from "../../composables/rewardsContext";
import { formatPercent, isKnownItem, itemName, oneInText, roundTo, stackNote } from "../../utils/rewardDisplay";
import { t, UI_LOCALE } from "../../i18n";

/**
 * The step between picking an item and adding it: amount, and for the item
 * pool its chance, both pre-filled with what a new item gets by default. The
 * entry only joins the list when this is confirmed.
 */
const props = defineProps<{
  /** The picked item string; null while no item is waiting. */
  item: string | null;
  where: ListWhere;
}>();
const emit = defineEmits<{ close: [] }>();

const { rewards, catalog, mode } = useRewardsContext();

const withChance = computed(() => props.where === "default");
const amount = ref<number | null>(1);
const percent = ref<number | null>(null);
const weight = ref<number | null>(null);
const amountInput = ref<{ $el: HTMLElement } | null>(null);

const live = computed(() => rewards.listRows(props.where).filter((r) => r.state !== "removed"));
const hasOthers = computed(() => live.value.length > 0);
const totalOthers = computed(() => live.value.reduce((sum, r) => sum + (r.entry.weight ?? 1), 0));
const name = computed(() => (props.item ? itemName(catalog.value, props.item) : ""));
const duplicate = computed(() => live.value.some((r) => r.entry.item === props.item));
const stack = computed(() => (props.item && amount.value ? stackNote(catalog.value, { item: props.item, amount: amount.value }) : ""));

/** The weight the new entry will get, from whichever of the two fields is shown. */
const chosenWeight = computed<number | null>(() => {
  if (mode.value === "weight") return weight.value;
  if (percent.value === null) return null;
  return hasOthers.value ? weightForPercent(percent.value, totalOthers.value) : 1;
});

const chosenPercent = computed(() => {
  const w = chosenWeight.value;
  return w === null ? 0 : sharePercent(w, totalOthers.value + w);
});

const chanceHint = computed(() => `${mode.value === "percent" ? t("rewards.weightIs", { weight: chosenWeight.value ?? 0 }) : `${formatPercent(chosenPercent.value)} %`} · ${oneInText(chosenPercent.value)}`);

const valid = computed(() => !!amount.value && amount.value >= 1 && (!withChance.value || (chosenWeight.value !== null && chosenWeight.value > 0)));

watch(
  () => props.item,
  (item) => {
    if (item === null) return;
    amount.value = 1;
    const w = rewards.defaultWeight(props.where);
    weight.value = w;
    percent.value = roundTo(sharePercent(w, totalOthers.value + w), 3);
  },
  { immediate: true },
);

function focusAmount(): void {
  // After the dialog has placed its own initial focus.
  setTimeout(() => amountInput.value?.$el.querySelector("input")?.select(), 60);
}

function confirm(): void {
  if (!props.item || !valid.value || !amount.value) return;
  rewards.addEntry(props.where, props.item, amount.value, withChance.value && chosenWeight.value !== null ? roundWeight(chosenWeight.value) : undefined);
  emit("close");
}
</script>

<style scoped>
.ai { display: grid; gap: var(--space-3); }
.ai-id { margin: 0; color: var(--text-dim); font-size: var(--text-sm); overflow-wrap: anywhere; }
.ai-note { margin: 0; font-size: var(--text-sm); color: var(--text); padding: var(--space-2) var(--space-3); border: 1px solid var(--border-strong); border-radius: var(--radius-control); }
.ai-field { display: grid; gap: var(--space-1); }
.ai-label { font-weight: 600; font-size: var(--text-sm); }
.ai-num { width: 14ch; }
.ai-num :deep(input) { width: 100%; }
.ai-hint { color: var(--text-dim); font-size: var(--text-sm); }
</style>

<template>
  <SidePanel
    :model-value="day !== null"
    :label="day ? t('rewards.streak.day', { day: day.day }) : ''"
    :close-label="t('rewards.close')"
    @update:model-value="(open) => !open && emit('close')"
  >
    <template v-if="day">
      <p v-if="day.state === 'removed'" class="dp-note">{{ t("rewards.streak.removedNote") }}</p>

      <div v-if="editable && day.state !== 'removed'" class="dp-add">
        <label class="dp-label" for="rw-day-add">{{ t("rewards.streak.addItemPlaceholder") }}</label>
        <ItemPicker input-id="rw-day-add" :catalog="catalog" @pick="pending = $event" />
        <AddItemDialog :item="pending" :where="where" @close="pending = null" />
      </div>

      <p v-if="liveRows.length === 0 && day.state !== 'removed'" class="dp-warn" role="alert">
        {{ t("rewards.streak.dayEmpty") }}
      </p>

      <ul class="dp-list">
        <li v-for="row in day.rows" :key="row.id" class="dp-row" :class="{ 'is-removed': row.state === 'removed' }">
          <span class="dp-name">
            <span class="dp-item">{{ itemName(catalog, row.entry.item) }}</span>
            <RowStateChip :state="row.state" />
            <span class="dp-id mono">{{ row.entry.item }}</span>
          </span>
          <InputNumber
            v-if="editable && row.state !== 'removed'"
            :locale="UI_LOCALE"
            :model-value="row.entry.amount"
            :min="1"
            :max="MAX_REWARD_AMOUNT"
            :aria-label="t('rewards.amountOf', { item: itemName(catalog, row.entry.item) })"
            class="dp-amount"
            @update:model-value="rewards.setAmount(where, row.id, $event)"
          />
          <span v-else class="dp-amount-text">× {{ row.entry.amount }}</span>
          <span v-if="editable" class="dp-actions">
            <Button
              v-if="row.state === 'removed'"
              class="tap"
              icon="pi pi-undo"
              severity="secondary"
              text
              :aria-label="t('rewards.restoreItem', { item: itemName(catalog, row.entry.item) })"
              @click="rewards.restoreEntry(where, row.id)"
            />
            <template v-else>
              <Button
                v-if="row.state === 'inherited' || row.state === 'changed'"
                class="tap"
                icon="pi pi-lock"
                severity="secondary"
                text
                :aria-label="t('rewards.keepItem', { item: itemName(catalog, row.entry.item) })"
                @click="rewards.detach(where, [row.id])"
              />
              <Button
                v-if="row.state === 'detached'"
                class="tap"
                icon="pi pi-link"
                severity="secondary"
                text
                :aria-label="t('rewards.reattachItem', { item: itemName(catalog, row.entry.item) })"
                @click="rewards.reattach(where, row.id)"
              />
              <Button
                class="tap"
                icon="pi pi-trash"
                severity="danger"
                text
                :aria-label="t('rewards.removeItem', { item: itemName(catalog, row.entry.item) })"
                @click="rewards.removeEntry(where, row.id)"
              />
            </template>
          </span>
        </li>
      </ul>
    </template>

    <template v-if="day && editable" #footer>
      <form v-if="day.state !== 'removed'" class="dp-copy" @submit.prevent="copy">
        <label class="dp-label" for="rw-day-copy">{{ t("rewards.streak.copyTo") }}</label>
        <InputNumber v-model="copyTarget" input-id="rw-day-copy" :locale="UI_LOCALE" :min="1" :max="999999" class="dp-amount" />
        <Button class="tap" type="submit" icon="pi pi-copy" :label="t('rewards.streak.copy')" severity="secondary" outlined :disabled="!copyTarget" />
      </form>
      <Button
        v-if="day.state === 'removed'"
        class="tap"
        icon="pi pi-undo"
        :label="t('rewards.streak.restoreDay')"
        severity="secondary"
        outlined
        @click="rewards.restoreDay(day.day)"
      />
      <Button
        v-else
        class="tap"
        icon="pi pi-trash"
        :label="t('rewards.streak.removeDayLabel')"
        severity="danger"
        outlined
        @click="removeDay"
      />
    </template>
  </SidePanel>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import { MAX_REWARD_AMOUNT } from "@mcbot/schema/dailyRewards.js";
import { useRewardsContext } from "../../composables/rewardsContext";
import { dayWhere } from "../../composables/useDailyRewards";
import { itemName } from "../../utils/rewardDisplay";
import SidePanel from "../ui/SidePanel.vue";
import AddItemDialog from "./AddItemDialog.vue";
import ItemPicker from "./ItemPicker.vue";
import RowStateChip from "./RowStateChip.vue";
import { t, UI_LOCALE } from "../../i18n";

/** One streak day's items, edited beside the timeline (a sheet on narrow screens). */
const props = defineProps<{ selected: string | null }>();
const emit = defineEmits<{ close: []; select: [day: string] }>();

const { rewards, catalog, editable } = useRewardsContext();

const day = computed(() => rewards.dayRows.value.find((d) => d.day === props.selected) ?? null);
const where = computed(() => dayWhere(props.selected ?? "0"));
const liveRows = computed(() => day.value?.rows.filter((r) => r.state !== "removed") ?? []);
const copyTarget = ref<number | null>(null);
/** The item picked in the search box, waiting in the add dialog. */
const pending = ref<string | null>(null);

watch(
  () => props.selected,
  () => {
    copyTarget.value = null;
    pending.value = null;
  },
);

function copy(): void {
  if (!day.value || !copyTarget.value) return;
  const target = copyTarget.value;
  if (rewards.duplicateDay(day.value.day, target)) {
    copyTarget.value = null;
    emit("select", String(target));
  }
}

function removeDay(): void {
  if (!day.value) return;
  rewards.removeDay(day.value.day);
  emit("close");
}
</script>

<style scoped>
.dp-label { font-weight: 600; font-size: var(--text-sm); }
.dp-note { margin: 0 0 var(--space-3); color: var(--text-dim); }
.dp-add { display: grid; gap: var(--space-1); margin-bottom: var(--space-3); }
.dp-warn { margin: 0 0 var(--space-3); padding: var(--space-2) var(--space-3); border: 1px solid var(--accent); border-radius: var(--radius-control); }
.dp-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-2); }
.dp-row { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: var(--space-2); padding-bottom: var(--space-2); border-bottom: 1px solid var(--border); }
.dp-name { display: grid; gap: 2px; justify-items: start; min-width: 0; }
.dp-item { font-weight: 600; }
.dp-id { color: var(--text-dim); font-size: var(--text-xs); overflow-wrap: anywhere; }
.dp-amount { width: 9ch; }
.dp-amount :deep(input) { width: 100%; }
.dp-amount-text { color: var(--text-dim); }
.dp-actions { white-space: nowrap; }
.dp-row.is-removed .dp-item { text-decoration: line-through; color: var(--text-dim); }
.dp-copy { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); flex: 1 1 100%; }
.sp-foot :deep(button) { white-space: nowrap; }
</style>

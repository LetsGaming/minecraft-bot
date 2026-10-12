<template>
  <div class="sort-control">
    <label :id="labelId" :for="inputId" class="sc-label">{{ t("ui.sort.label") }}</label>
    <Select
      :inputId="inputId"
      :ariaLabelledby="labelId"
      :modelValue="field"
      :options="options"
      optionLabel="label"
      optionValue="field"
      size="small"
      class="sc-select"
      @update:modelValue="$emit('update:field', $event)"
    />
    <Button
      class="sc-order"
      :icon="order === 1 ? 'pi pi-sort-amount-up-alt' : 'pi pi-sort-amount-down'"
      :label="order === 1 ? t('ui.sort.ascending') : t('ui.sort.descending')"
      :aria-label="t('ui.sort.orderLabel', { order: order === 1 ? t('ui.sort.ascending') : t('ui.sort.descending') })"
      severity="secondary"
      outlined
      size="small"
      @click="$emit('update:order', order === 1 ? -1 : 1)"
    />
  </div>
</template>

<script setup lang="ts">
import { useId } from "vue";
import Select from "primevue/select";
import Button from "primevue/button";
import { t } from "../../i18n";

/**
 * Sort picker for a `.stack-table`. Under 760px that table drops its header
 * row, and with it the clickable column headers, so this takes their place;
 * above that width it stays hidden and the headers sort as usual.
 */
defineProps<{
  field: string;
  order: 1 | -1;
  options: Array<{ field: string; label: string }>;
}>();

defineEmits<{ "update:field": [field: string]; "update:order": [order: 1 | -1] }>();

const inputId = `sort-${useId()}`;
const labelId = `${inputId}-label`;
</script>

<style scoped>
.sort-control { display: none; }
@media (max-width: 760px) {
  .sort-control {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .sc-label { flex: none; color: var(--text-dim); font-size: var(--text-sm); }
  .sc-select { flex: 1 1 0; min-width: 0; align-items: center; }
  .sc-select, .sc-order { min-height: var(--touch-min); }
}
</style>

<template>
  <div class="override-toggle">
    <ToggleSwitch
      :model-value="modelValue"
      :input-id="id"
      :disabled="disabled"
      :pt="{ input: { 'aria-describedby': `${id}-state` } }"
      @update:model-value="$emit('update:model-value', Boolean($event))"
    />
    <label :for="id" class="ot-label">{{ label }}</label>
    <span :id="`${id}-state`" class="ot-state">
      {{ modelValue ? t("rewards.overrideOn") : t("rewards.overrideOff") }}
    </span>
  </div>
</template>

<script setup lang="ts">
import ToggleSwitch from "primevue/toggleswitch";
import { t } from "../../i18n";

/**
 * "This server sets its own …" switch. Off means the field is inherited from
 * the shared pool; on copies the shared value in as a starting point.
 */
defineProps<{
  id: string;
  modelValue: boolean;
  label: string;
  disabled?: boolean;
}>();

defineEmits<{ "update:model-value": [value: boolean] }>();
</script>

<style scoped>
.override-toggle {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 2px var(--space-2);
  max-width: 320px;
}
.ot-label { font-weight: 600; font-size: var(--text-sm); }
.ot-state { grid-column: 2; font-size: var(--text-xs); color: var(--text-dim); }
</style>

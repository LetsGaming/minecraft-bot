<template>
  <div :class="['field-row', { dirty, invalid: !!error }]">
    <div class="fr-head">
      <label class="fr-label" :for="inputId">
        {{ label }}<span v-if="required" class="fr-req" aria-hidden="true"> *</span>
      </label>
      <FieldHint v-if="help" :text="help" :label="label" />
      <span v-if="dirty" class="fr-dirty">{{ COPY.dirty }}</span>
    </div>
    <code v-if="keyPath" :id="keyId" class="fr-key">{{ keyPath }}</code>
    <div class="fr-control">
      <slot :id="inputId" :describedBy="describedBy" :invalid="!!error" />
    </div>
    <p v-if="error" :id="errorId" class="fr-error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";
import FieldHint from "./FieldHint.vue";

const COPY = {
  dirty: "Changed",
} as const;

const props = withDefaults(
  defineProps<{
    label: string;
    /** Id of the input in the slot. Generated when omitted; the slot receives it either way. */
    id?: string;
    /** The config key, shown in mono under the label. */
    keyPath?: string;
    help?: string;
    dirty?: boolean;
    error?: string;
    required?: boolean;
  }>(),
  { id: "", keyPath: "", help: "", dirty: false, error: "", required: false },
);

const generated = useId();
const inputId = computed(() => props.id || `field-${generated}`);
const keyId = computed(() => `${inputId.value}-key`);
const errorId = computed(() => `${inputId.value}-error`);
const describedBy = computed(() =>
  [props.keyPath ? keyId.value : "", props.error ? errorId.value : ""]
    .filter(Boolean)
    .join(" ") || undefined,
);
</script>

<style scoped>
.field-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-left: var(--space-3);
  border-left: 3px solid transparent;
}
.field-row.dirty { border-left-color: var(--st-pending); }
.field-row.invalid { border-left-color: var(--st-offline); }
.fr-head { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.fr-label { font-size: var(--text-sm); font-weight: 500; color: var(--text); }
.fr-req { color: var(--text-dim); }
.fr-dirty { font-size: var(--text-xs); color: var(--st-pending); }
.fr-key {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.fr-control { min-width: 0; }
.fr-error { margin: 0; font-size: var(--text-sm); color: var(--st-offline); max-width: 56ch; }
</style>

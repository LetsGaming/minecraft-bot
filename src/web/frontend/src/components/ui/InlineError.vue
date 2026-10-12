<template>
  <div class="inline-error" role="alert">
    <StatusChip state="offline" variant="dot" :label="t('ui.error')" class="ie-mark" />
    <div class="ie-body">
      <component :is="headingTag" class="ie-title">{{ title }}</component>
      <p v-if="recovery || $slots.default" class="ie-recovery">
        <slot>{{ recovery }}</slot>
      </p>
      <code v-if="detail" class="ie-detail">{{ detail }}</code>
      <div v-if="retryable || $slots.actions" class="ie-actions">
        <Button
          v-if="retryable"
          class="tap"
          :label="retryLabel || t('ui.retry')"
          icon="pi pi-refresh"
          size="small"
          :loading="busy"
          @click="$emit('retry')"
        />
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import StatusChip from "./StatusChip.vue";
import { t } from "../../i18n";

/** A failure in place of the content it stopped: what went wrong, what to do, and Retry. */
const props = withDefaults(
  defineProps<{
    /** The problem, one sentence. */
    title: string;
    /** What the reader can do about it. */
    recovery?: string;
    /** A technical line for whoever fixes it (request and status), shown in mono. */
    detail?: string;
    retryable?: boolean;
    retryLabel?: string;
    busy?: boolean;
    headingLevel?: 2 | 3 | 4;
  }>(),
  { recovery: "", detail: "", retryable: true, retryLabel: "", busy: false, headingLevel: 3 },
);

defineEmits<{ retry: [] }>();

const headingTag = computed(() => `h${props.headingLevel}`);
</script>

<style scoped>
.inline-error {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--st-offline);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.ie-mark { margin-top: 5px; }
.ie-body { min-width: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.ie-title { margin: 0; font-size: var(--text-lg); font-weight: 600; color: var(--text); }
.ie-recovery { margin: 0; max-width: 64ch; color: var(--text-dim); }
.ie-detail {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.ie-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-1); }
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
}
</style>

<template>
  <div :class="['edit-bar', { dirty: dirtyCount > 0, saving }]" role="region" :aria-label="COPY.region">
    <p class="eb-state" aria-live="polite">
      <StatusChip
        :state="saving ? 'info' : dirtyCount > 0 ? 'pending' : 'applied'"
        :label="stateText"
        :busy="saving"
      />
      <span v-if="error" class="eb-error">{{ error }}</span>
    </p>
    <div class="eb-actions">
      <slot name="extra" />
      <Button
        class="tap"
        :label="COPY.discard"
        severity="secondary"
        text
        :disabled="dirtyCount === 0 || saving || readonly"
        @click="$emit('discard')"
      />
      <Button
        v-if="reviewable"
        class="tap"
        :label="COPY.review"
        severity="secondary"
        outlined
        :disabled="dirtyCount === 0 || saving"
        @click="$emit('review')"
      />
      <Button
        class="tap"
        :label="saveLabel || COPY.save"
        icon="pi pi-check"
        :loading="saving"
        :disabled="dirtyCount === 0 || !canSave || readonly"
        @click="$emit('save')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import StatusChip from "./StatusChip.vue";

const COPY = {
  region: "Unsaved changes",
  clean: "No unsaved changes",
  saving: "Saving",
  discard: "Discard",
  review: "Review changes",
  save: "Save",
  one: "1 unsaved change",
  many: (n: number) => `${n} unsaved changes`,
} as const;

/** Save controls for an editor; docks to the bottom edge on phones. */
const props = withDefaults(
  defineProps<{
    dirtyCount: number;
    saving?: boolean;
    /** False while the draft has validation errors. */
    canSave?: boolean;
    readonly?: boolean;
    reviewable?: boolean;
    saveLabel?: string;
    error?: string;
  }>(),
  { saving: false, canSave: true, readonly: false, reviewable: false, saveLabel: "", error: "" },
);

defineEmits<{ save: []; discard: []; review: [] }>();

const stateText = computed(() => {
  if (props.saving) return COPY.saving;
  if (props.dirtyCount === 0) return COPY.clean;
  return props.dirtyCount === 1 ? COPY.one : COPY.many(props.dirtyCount);
});
</script>

<style scoped>
.edit-bar {
  position: sticky;
  bottom: 0;
  z-index: var(--z-sticky);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.edit-bar.dirty { border-left: 3px solid var(--st-pending); }
.eb-state { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.eb-error { color: var(--st-offline); font-size: var(--text-sm); }
.eb-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 760px) {
  .edit-bar {
    border-radius: 0;
    margin: 0 calc(-1 * var(--space-4));
    border-left: none;
    border-right: none;
  }
  .edit-bar.dirty { border-left: none; border-top: 3px solid var(--st-pending); }
  .eb-actions { width: 100%; }
  .eb-actions > :last-child { flex: 1 1 auto; }
}
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
}
</style>

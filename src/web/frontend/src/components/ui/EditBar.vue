<template>
  <div :class="['edit-bar', `is-${state}`, { docked }]" role="region" :aria-label="t('editor.bar')">
    <p class="eb-status" aria-live="polite">
      <template v-if="state === 'clean'">
        <slot name="status">
          <StatusChip state="applied" :label="t('editor.clean')" />
        </slot>
      </template>
      <template v-else-if="state === 'readonly'">
        <StatusChip state="unknown" :label="t('editor.readonly')" />
      </template>
      <template v-else-if="state === 'saving'">
        <StatusChip state="info" busy :label="t('editor.savingCount', { count: changeCount })" />
        <span v-if="savingHint" class="eb-hint">{{ savingHint }}</span>
      </template>
      <template v-else-if="state === 'error'">
        <StatusChip state="offline" :label="t('editor.problems', { count: problemCount })" />
        <span class="eb-hint">
          {{ t("editor.fixToSave") }}
          <button type="button" class="eb-link" @click="$emit('first-problem')">{{ t("editor.firstProblem") }}</button>
        </span>
      </template>
      <template v-else-if="state === 'conflict'">
        <StatusChip state="degraded" :label="t('editor.conflicts', { count: conflictCount })" />
        <span class="eb-hint">{{ t("editor.resolveToSave") }}</span>
      </template>
      <template v-else>
        <StatusChip state="pending" :label="t('editor.unsaved', { count: changeCount })" />
        <span v-if="saveHint" class="eb-hint">{{ saveHint }}</span>
      </template>
      <span v-if="error" class="eb-error">{{ error }}</span>
    </p>
    <div v-if="state !== 'readonly'" class="eb-actions">
      <slot name="extra" />
      <Button
        v-if="changeCount > 0 && state !== 'saving'"
        class="tap"
        :label="t('editor.discard')"
        severity="secondary"
        outlined
        @click="$emit('discard')"
      />
      <Button
        v-if="reviewable && changeCount > 0 && state !== 'saving'"
        class="tap"
        :label="t('editor.review')"
        severity="secondary"
        outlined
        @click="$emit('review')"
      />
      <Button
        class="tap eb-save"
        :label="saveText"
        :icon="state === 'saving' ? undefined : 'pi pi-check'"
        :loading="state === 'saving'"
        :disabled="!saveEnabled"
        :severity="state === 'clean' ? 'secondary' : undefined"
        :outlined="state === 'clean'"
        @click="$emit('save')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import StatusChip from "./StatusChip.vue";
import { t } from "../../i18n";
import type { EditorState } from "./types";

/**
 * The status strip and save controls every editor shares. Sticky at the top
 * of the content on wide screens; docked to the bottom edge on phones. The
 * clean state's text comes from the editor (apply state, last save), the
 * other states are worded here.
 */
const props = withDefaults(
  defineProps<{
    state: EditorState;
    /** Changed fields; a raw edit that does not parse counts as one. */
    changeCount: number;
    problemCount?: number;
    conflictCount?: number;
    /** Blocks Save for a reason the state does not show (a stale read). */
    canSave?: boolean;
    reviewable?: boolean;
    /** What saving does, shown next to the unsaved count. */
    saveHint?: string;
    savingHint?: string;
    error?: string;
    /** False inside a dialog footer: no sticky or fixed positioning. */
    docked?: boolean;
  }>(),
  {
    problemCount: 0,
    conflictCount: 0,
    canSave: true,
    reviewable: false,
    saveHint: "",
    savingHint: "",
    error: "",
    docked: true,
  },
);

defineEmits<{ save: []; discard: []; review: []; "first-problem": [] }>();

const saveEnabled = computed(() => props.state === "dirty" && props.changeCount > 0 && props.canSave);

const saveText = computed(() => {
  if (props.state === "saving") return t("editor.savingButton");
  if (props.state === "clean") return t("editor.nothingToSave");
  if (props.state === "dirty" && props.changeCount > 0) return t("editor.saveCount", { count: props.changeCount });
  return t("editor.save");
});
</script>

<style scoped>
.edit-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  background: var(--surface);
}
.edit-bar.docked {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}
.is-dirty { border-color: var(--accent); }
.is-error { border-color: var(--danger); }
.eb-status {
  margin: 0;
  flex: 1 1 280px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}
.eb-hint { color: var(--text-dim); font-size: var(--text-sm); }
.eb-hint :deep(code) { font-family: var(--font-mono); }
.eb-error { color: var(--danger); font-size: var(--text-sm); }
.eb-link {
  padding: 0;
  background: none;
  border: 0;
  color: var(--link);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.eb-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
@media (max-width: 760px) {
  .edit-bar.docked {
    position: fixed;
    top: auto;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: var(--radius-surface) var(--radius-surface) 0 0;
    border-width: 1px 0 0;
    padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
    box-shadow: var(--shadow-overlay);
  }
  .docked .eb-actions { width: 100%; }
  .docked .eb-actions > * { flex: 1 1 auto; }
}
@media (pointer: coarse), (max-width: 760px) {
  .tap, .eb-link { min-height: var(--touch-min); }
}
</style>

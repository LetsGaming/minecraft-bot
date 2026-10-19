<template>
  <div ref="root" class="tl" role="tablist" :aria-label="label" @keydown="onKey">
    <button
      v-for="tab in tabs"
      :id="`${idPrefix}-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      role="tab"
      class="tl-tab"
      :aria-selected="tab.id === modelValue ? 'true' : 'false'"
      :tabindex="tab.id === modelValue ? 0 : -1"
      :aria-controls="panelId"
      :disabled="tab.disabled"
      :data-tab="tab.id"
      @click="emit('select', tab.id)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from "vue";

export interface TabItem {
  id: string;
  label: string;
  disabled?: boolean;
}

/**
 * A tab strip: roving tabindex, Left and Right (wrapping), Home and End. The
 * parent owns which tab is selected and may refuse a switch; after a key
 * press focus follows whatever is selected once the parent has answered.
 */
const props = defineProps<{
  tabs: TabItem[];
  modelValue: string;
  /** The tablist's accessible name. */
  label: string;
  /** Ids are `<idPrefix>-tab-<tab id>`. */
  idPrefix: string;
  /** The id of the panel every tab controls. */
  panelId: string;
}>();
const emit = defineEmits<{ select: [id: string] }>();

const root = ref<HTMLElement | null>(null);

function onKey(event: KeyboardEvent): void {
  const enabled = props.tabs.filter((tab) => !tab.disabled);
  if (enabled.length < 2) return;
  const at = enabled.findIndex((tab) => tab.id === props.modelValue);
  let next = -1;
  if (event.key === "ArrowRight") next = (at + 1) % enabled.length;
  else if (event.key === "ArrowLeft") next = (at - 1 + enabled.length) % enabled.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = enabled.length - 1;
  else return;
  event.preventDefault();
  const target = enabled[next]!;
  if (target.id !== props.modelValue) emit("select", target.id);
  void nextTick(() => {
    root.value?.querySelector<HTMLElement>(`[data-tab="${props.modelValue}"]`)?.focus();
  });
}
</script>

<style scoped>
.tl { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border); overflow-x: auto; }
.tl-tab {
  min-height: var(--control-h);
  padding: 0 var(--space-4);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--text-dim);
  font: inherit;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
}
.tl-tab[aria-selected="true"] { color: var(--text); border-bottom-color: var(--accent); }
.tl-tab:disabled { cursor: default; opacity: 0.6; }
@media (pointer: coarse), (max-width: 760px) {
  .tl-tab { min-height: var(--touch-min); }
}
</style>

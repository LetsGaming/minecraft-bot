<template>
  <div v-if="visible" class="ub" role="status">
    <span class="ub-text">{{ message }}</span>
    <button type="button" class="ub-action tap" @click="onUndo">{{ actionLabel }}</button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";

/**
 * A short-lived "Removed. Undo" bar. It shows again each time `token` changes
 * and hides itself after a few seconds; the parent owns the actual undo.
 */
const props = defineProps<{
  /** Changes with every edit that can be undone. */
  token: number;
  message: string;
  actionLabel: string;
  /** How long the bar stays, in milliseconds. */
  duration?: number;
}>();
const emit = defineEmits<{ undo: [] }>();

const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

function hide(): void {
  visible.value = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
}

watch(
  () => props.token,
  (token) => {
    if (token === 0) return;
    visible.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(hide, props.duration ?? 8000);
  },
);

function onUndo(): void {
  hide();
  emit("undo");
}

onBeforeUnmount(hide);
</script>

<style scoped>
.ub {
  position: fixed;
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  z-index: var(--z-toast);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-2) var(--space-4);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  box-shadow: var(--shadow-overlay);
}
.ub-text { color: var(--text); }
.ub-action {
  background: none;
  border: 0;
  color: var(--accent);
  font: inherit;
  font-weight: 600;
  min-height: var(--control-h);
  padding: 0 var(--space-2);
  cursor: pointer;
}
@media (max-width: 760px) {
  /* Above the docked edit bar. */
  .ub { bottom: calc(var(--space-7) + var(--space-6)); width: calc(100% - var(--space-4) * 2); justify-content: space-between; }
}
</style>

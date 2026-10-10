<template>
  <span
    v-if="!forbidden"
    :class="['cfg-chip', view.severity]"
    v-tooltip.bottom="view.hint"
    role="status"
  >
    <i :class="view.icon" />
    {{ view.label }}
  </span>
</template>

<script setup lang="ts">
import { watch, onMounted } from "vue";
import { useConfigStatus } from "../../composables/useConfigStatus";

const props = defineProps<{
  /** Change this after a save to re-check straight away. */
  refreshKey?: number;
}>();

const { view, forbidden, start, refresh } = useConfigStatus();
onMounted(start);
watch(() => props.refreshKey, () => void refresh());
</script>

<style scoped>
.cfg-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 999px; font-size: 12px;
  border: 1px solid var(--mc-border);
  color: var(--mc-text);
}
.cfg-chip.success { color: var(--mc-accent); border-color: color-mix(in srgb, var(--mc-accent) 40%, transparent); }
.cfg-chip.info { border-color: var(--mc-mid); }
.cfg-chip.warn { color: #e0b34a; border-color: color-mix(in srgb, #e0b34a 45%, transparent); }
.cfg-chip.secondary { color: var(--mc-muted, #8a9099); }
</style>

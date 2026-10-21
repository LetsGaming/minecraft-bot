<template>
  <span v-if="text" class="rsc" :class="`is-${state}`">{{ text }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { DayState, RowState } from "../../composables/useDailyRewards";
import { t } from "../../i18n";

/**
 * Says how a row or day differs from the shared pool, in words, so the state
 * never depends on colour. Rows that are simply inherited or have no shared
 * pool to compare to say nothing.
 */
const props = defineProps<{ state: RowState | DayState }>();

const text = computed(() => {
  switch (props.state) {
    case "changed":
      return t("rewards.state.changed");
    case "added":
      return t("rewards.state.added");
    case "detached":
      return t("rewards.state.detached");
    case "removed":
      return t("rewards.state.removed");
    default:
      return "";
  }
});
</script>

<style scoped>
.rsc {
  display: inline-block;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  line-height: 1.6;
  color: var(--text-dim);
  white-space: nowrap;
}
.is-added, .is-detached { color: var(--text); border-color: var(--accent); }
.is-changed { color: var(--text); border-style: dashed; }
.is-removed { text-decoration: line-through; }
</style>

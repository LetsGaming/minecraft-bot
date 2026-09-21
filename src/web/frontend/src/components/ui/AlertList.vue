<template>
  <ul v-if="alerts.length" :class="['alert-list', { compact }]">
    <li v-for="(a, i) in alerts" :key="i" :class="['alert', a.level]">
      <i :class="a.icon" />
      <span>{{ a.text }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { Alert } from "../../utils/serverAlerts";

defineProps<{
  alerts: Alert[];
  /** Tighter padding/font for a card that already has other content. */
  compact?: boolean;
}>();
</script>

<style scoped>
.alert-list { list-style: none; margin: 0; padding: 6px 0; display: flex; flex-direction: column; gap: 2px; }
.alert { display: flex; align-items: center; gap: 9px; padding: 7px 0; font-size: 13.5px; }
.alert.warn i { color: var(--mc-mid); }
.alert.danger i { color: var(--mc-bad); }
.alert-list.compact { padding: 2px 0; }
.alert-list.compact .alert { padding: 4px 0; font-size: 12.5px; gap: 7px; }
</style>

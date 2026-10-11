<template>
  <ul v-if="alerts.length" :class="['alert-list', { compact }]">
    <li v-for="(a, i) in alerts" :key="`${a.kind}-${i}`" class="alert">
      <StatusChip :state="ROLE[a.level]" variant="dot" :label="t(LABEL[a.level])" class="alert-mark" />
      <span>{{ a.text }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { StatusRole } from "@mcbot/schema";
import StatusChip from "./StatusChip.vue";
import type { Alert } from "../../utils/serverAlerts";
import { t, type MessageKey } from "../../i18n";

const ROLE: Record<Alert["level"], StatusRole> = {
  warn: StatusRole.Degraded,
  danger: StatusRole.Offline,
};

const LABEL: Record<Alert["level"], MessageKey> = {
  warn: "servers.alertWarn",
  danger: "servers.alertDanger",
};

defineProps<{
  alerts: Alert[];
  /** Tighter padding/font for a card that already has other content. */
  compact?: boolean;
}>();
</script>

<style scoped>
.alert-list { list-style: none; margin: 0; padding: var(--space-1) 0; display: flex; flex-direction: column; gap: 2px; }
.alert { display: flex; align-items: baseline; gap: var(--space-2); padding: var(--space-2) 0; font-size: var(--text-sm); }
.alert-mark { flex: none; }
.alert-list.compact { padding: 2px 0; }
.alert-list.compact .alert { padding: var(--space-1) 0; font-size: var(--text-xs); }
</style>

<template>
  <span v-if="!hidden" v-tooltip.bottom="shown.hint" class="cfg-chip">
    <StatusChip :state="current?.state ?? StatusRole.Unknown" :label="shown.label" live />
  </span>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from "vue";
import { StatusRole, type ConfigStatusResponse } from "@mcbot/schema";
import { describeStatus, useConfigStatus } from "../../composables/useConfigStatus";
import StatusChip from "./StatusChip.vue";

const props = defineProps<{
  /** Change this after a save to re-check straight away. */
  refreshKey?: number;
  /** A status the parent already tracks. When given (even null), the chip does not poll. */
  status?: ConfigStatusResponse | null;
}>();

const own = useConfigStatus();
const controlled = computed(() => props.status !== undefined);
const current = computed(() => (controlled.value ? props.status : own.status.value));
const shown = computed(() => (controlled.value ? describeStatus(props.status ?? null) : own.view.value));
const hidden = computed(() => !controlled.value && own.forbidden.value);

onMounted(() => {
  if (!controlled.value) own.start();
});
watch(() => props.refreshKey, () => void own.refresh());
</script>

<style scoped>
.cfg-chip { display: inline-flex; }
</style>

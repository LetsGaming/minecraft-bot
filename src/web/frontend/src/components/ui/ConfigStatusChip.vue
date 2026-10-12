<template>
  <span v-if="!forbidden" v-tooltip.bottom="view.hint" class="cfg-chip">
    <StatusChip
      :state="status?.state ?? StatusRole.Unknown"
      :label="view.label"
      live
    />
  </span>
</template>

<script setup lang="ts">
import { watch, onMounted } from "vue";
import { StatusRole } from "@mcbot/schema";
import { useConfigStatus } from "../../composables/useConfigStatus";
import StatusChip from "./StatusChip.vue";

const props = defineProps<{
  /** Change this after a save to re-check straight away. */
  refreshKey?: number;
}>();

const { status, view, forbidden, start, refresh } = useConfigStatus();
onMounted(start);
watch(() => props.refreshKey, () => void refresh());
</script>

<style scoped>
.cfg-chip { display: inline-flex; }
</style>

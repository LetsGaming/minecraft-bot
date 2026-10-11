<template>
  <div :class="['inline-banner', `tone-${tone}`]" :role="tone === 'danger' ? 'alert' : 'status'">
    <StatusChip :state="ROLE[tone]" variant="dot" :label="toneLabel" class="ib-mark" />
    <div class="ib-body">
      <p v-if="title" class="ib-title">{{ title }}</p>
      <div class="ib-text"><slot /></div>
    </div>
    <div v-if="$slots.actions" class="ib-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { StatusRole } from "@mcbot/schema";
import StatusChip from "./StatusChip.vue";

type Tone = "info" | "warn" | "danger";

const COPY: Record<Tone, string> = {
  info: "Note",
  warn: "Warning",
  danger: "Problem",
};

const ROLE: Record<Tone, StatusRole> = {
  info: StatusRole.Info,
  warn: StatusRole.Degraded,
  danger: StatusRole.Offline,
};

/** A one-block notice above the content it qualifies (read-only, stale, blocked). */
const props = withDefaults(defineProps<{ tone?: Tone; title?: string }>(), {
  tone: "info",
  title: "",
});

const toneLabel = computed(() => COPY[props.tone]);
</script>

<style scoped>
.inline-banner {
  --banner-edge: var(--st-info);
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border);
  border-left: 3px solid var(--banner-edge);
  border-radius: var(--radius-surface);
  background: var(--surface);
  color: var(--text);
}
.tone-warn { --banner-edge: var(--st-degraded); }
.tone-danger { --banner-edge: var(--st-offline); }
.ib-mark { margin-top: 6px; }
.ib-body { flex: 1 1 32ch; min-width: 0; }
.ib-title { margin: 0 0 var(--space-1); font-weight: 600; }
.ib-text { max-width: 78ch; overflow-wrap: anywhere; }
.ib-text :deep(p) { margin: 0; }
.ib-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; }
</style>

<template>
  <span
    :class="['status-chip', `st-${def.name}`, `is-${variant}`, { busy }]"
    :role="live ? 'status' : undefined"
    :title="variant === 'dot' ? text : undefined"
  >
    <span :class="['shape', `shape-${def.shape}`]" aria-hidden="true" />
    <span :class="variant === 'dot' ? 'sr-only' : 'label'">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  GLOSSARY,
  statusDefinition,
  type GlossaryKey,
  type StatusInput,
} from "@mcbot/schema";

const props = withDefaults(
  defineProps<{
    /** A status role, a server state or a config apply state. */
    state: StatusInput;
    /** Overrides the glossary label of the role. */
    label?: string;
    /** `dot` shows the shape only; the label stays for assistive tech and the tooltip. */
    variant?: "chip" | "dot";
    /** Spins the info shape. */
    busy?: boolean;
    /** Announce changes (role="status"). Off for chips that sit in lists. */
    live?: boolean;
  }>(),
  { label: "", variant: "chip", busy: false, live: false },
);

const def = computed(() => statusDefinition(props.state));
const text = computed(
  () => props.label || GLOSSARY[def.value.labelKey as GlossaryKey]?.en || def.value.name,
);
</script>

<style scoped>
.status-chip {
  --chip-fg: var(--st-unknown);
  --chip-bg: var(--st-unknown-bg);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  color: var(--chip-fg);
  font-size: var(--text-xs);
  font-weight: 500;
  line-height: var(--leading-tight);
  white-space: nowrap;
  vertical-align: middle;
}
.status-chip.is-chip {
  padding: 3px var(--space-2) 3px 7px;
  border-radius: var(--radius-control);
  background: var(--chip-bg);
}
.label { overflow: hidden; text-overflow: ellipsis; }

.st-online { --chip-fg: var(--st-online); --chip-bg: var(--st-online-bg); }
.st-degraded { --chip-fg: var(--st-degraded); --chip-bg: var(--st-degraded-bg); }
.st-offline { --chip-fg: var(--st-offline); --chip-bg: var(--st-offline-bg); }
.st-unknown { --chip-fg: var(--st-unknown); --chip-bg: var(--st-unknown-bg); }
.st-pending { --chip-fg: var(--st-pending); --chip-bg: var(--st-pending-bg); }
.st-applied { --chip-fg: var(--st-applied); --chip-bg: var(--st-applied-bg); }
.st-info { --chip-fg: var(--st-info); --chip-bg: var(--st-info-bg); }

.shape {
  position: relative;
  flex: none;
  width: 9px;
  height: 9px;
  box-sizing: border-box;
}
.shape-filled-circle { border-radius: 50%; background: var(--chip-fg); }
.shape-ring { border-radius: 50%; border: 2px solid var(--chip-fg); }
.shape-dashed-ring { border-radius: 50%; border: 2px dashed var(--chip-fg); width: 10px; height: 10px; }
.shape-diamond { width: 8px; height: 8px; background: var(--chip-fg); transform: rotate(45deg); }
.shape-dash { height: 2px; border-radius: 1px; background: var(--chip-fg); }
.shape-check {
  width: 5px;
  height: 9px;
  margin: 0 2px 2px;
  border: solid var(--chip-fg);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.shape-spinner-circle { border-radius: 50%; border: 2px solid var(--chip-fg); }
.busy .shape-spinner-circle {
  border-right-color: transparent;
  animation: chip-spin 0.9s linear infinite;
}
@keyframes chip-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .busy .shape-spinner-circle { animation: none; border-right-color: var(--chip-fg); }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
</style>

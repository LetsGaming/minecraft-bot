<template>
  <div :class="['editor-shell', `es-${state}`, { 'has-nav': !!$slots.nav }]" :aria-busy="state === 'saving' ? 'true' : undefined">
    <div v-if="$slots.status" class="es-status">
      <slot name="status" />
    </div>
    <InlineBanner v-if="state === 'readonly'" tone="info" :title="COPY.readonly">
      {{ readonlyReason }}
    </InlineBanner>
    <InlineBanner v-else-if="state === 'conflict'" tone="warn" :title="COPY.conflict">
      <slot name="conflict">{{ COPY.conflictHelp }}</slot>
    </InlineBanner>
    <div class="es-body">
      <nav v-if="$slots.nav" class="es-nav" :aria-label="navLabel">
        <slot name="nav" />
      </nav>
      <div class="es-main">
        <slot />
      </div>
    </div>
    <slot name="bar" />
  </div>
</template>

<script setup lang="ts">
import InlineBanner from "./InlineBanner.vue";
import type { EditorState } from "./types";

const COPY = {
  readonly: "Read-only",
  conflict: "Changed by someone else",
  conflictHelp: "This file changed on disk after you opened it. Pick which value to keep for each field before saving.",
} as const;

/**
 * The frame every editor shares: status strip, an optional group list, the
 * fields, and the edit bar. It draws the state; the editor's composable owns it.
 */
withDefaults(
  defineProps<{
    state?: EditorState;
    readonlyReason?: string;
    navLabel?: string;
  }>(),
  { state: "clean", readonlyReason: "", navLabel: "Groups" },
);
</script>

<style scoped>
.editor-shell { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.es-status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.es-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); }
.es-main { min-width: 0; display: flex; flex-direction: column; gap: var(--field-gap); }
@media (min-width: 1100px) {
  .has-nav .es-body { grid-template-columns: 220px minmax(0, 1fr); }
  .es-nav { position: sticky; top: var(--space-4); align-self: start; }
}
</style>

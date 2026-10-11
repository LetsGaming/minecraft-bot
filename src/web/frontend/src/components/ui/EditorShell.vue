<template>
  <div
    :class="['editor-shell', `es-${state}`, { 'has-nav': !!$slots.nav }]"
    :style="navWidth ? { '--es-nav-w': navWidth } : undefined"
    :aria-busy="state === 'saving' ? 'true' : undefined"
  >
    <div v-if="$slots.banners" class="es-banners">
      <slot name="banners" />
    </div>
    <InlineBanner v-if="state === 'readonly'" tone="info" :title="t('editor.readonlyTitle')">
      {{ readonlyReason }}
    </InlineBanner>
    <InlineBanner v-else-if="state === 'conflict'" tone="warn" :title="t('editor.conflictTitle')">
      <slot name="conflict">{{ t("editor.conflictHelp") }}</slot>
      <template v-if="$slots['conflict-actions']" #actions>
        <slot name="conflict-actions" />
      </template>
    </InlineBanner>
    <slot name="bar" />
    <slot name="toolbar" />
    <div class="es-body">
      <nav v-if="$slots.nav" class="es-nav" :aria-label="navLabel || t('editor.groups')">
        <slot name="nav" />
      </nav>
      <div class="es-main">
        <slot :locked="state === 'saving' || state === 'readonly'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import InlineBanner from "./InlineBanner.vue";
import { t } from "../../i18n";
import type { EditorState } from "./types";

/**
 * The frame every editor shares, top to bottom: notices, the read-only or
 * conflict banner, the edit bar, an optional toolbar (tabs), then the group
 * list beside the fields. It draws the state; the editor's composable owns
 * it. The default slot gets `locked` while saving or read-only.
 */
withDefaults(
  defineProps<{
    state?: EditorState;
    readonlyReason?: string;
    navLabel?: string;
    /** Width of the group list column on wide screens, e.g. `300px`. */
    navWidth?: string;
  }>(),
  { state: "clean", readonlyReason: "", navLabel: "", navWidth: "" },
);
</script>

<style scoped>
.editor-shell { --es-nav-w: 220px; display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.es-banners { display: flex; flex-direction: column; gap: var(--space-3); }
.es-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-5); align-items: start; }
.es-nav { min-width: 0; }
.es-main { min-width: 0; display: flex; flex-direction: column; gap: var(--field-gap); }
@media (min-width: 1100px) {
  .has-nav .es-body { grid-template-columns: var(--es-nav-w) minmax(0, 1fr); }
  .es-nav { position: sticky; top: 96px; }
}
/* The edit bar is fixed to the bottom edge on phones; keep the last field clear of it. */
@media (max-width: 760px) {
  .editor-shell { padding-bottom: 120px; }
}
</style>

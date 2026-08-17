<template>
  <span v-if="text" :class="['fh', { pinned }]">
    <button
      type="button"
      class="fh-btn"
      aria-label="Help"
      @click.stop="pinned = !pinned"
      @blur="pinned = false"
    >
      <i class="pi pi-info-circle" />
    </button>
    <span class="fh-pop" role="tooltip">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref } from "vue";

/**
 * Schema help text as an info affordance (audit P3).
 *
 * The generated help on this config is genuinely good — it explains what
 * `allowedServers` does in multi-guild deployments, what happens when `events`
 * is omitted — but there is six to eight lines of it under nearly every field,
 * and the same scoping paragraph repeats across notifications, leaderboard,
 * tpsAlerts and reports for every guild. Rendered inline it turned a form of
 * twelve inputs into an essay with twelve inputs buried in it, and the old
 * two-line clamp cut sentences mid-word.
 *
 * So it collapses to one icon per field. The full text — never truncated —
 * appears on hover, and a click pins it open for a reader who wants to keep it
 * up while they edit. Nothing shows until asked for, so the same paragraph is
 * no longer visually repeated down the page.
 */
defineProps<{ text?: string }>();

const pinned = ref(false);
</script>

<style scoped>
.fh {
  position: relative;
  display: inline-flex;
  vertical-align: middle;
}
.fh-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: help;
  line-height: 1;
  display: inline-flex;
  color: var(--mc-muted);
}
.fh-btn:hover,
.fh.pinned .fh-btn {
  color: var(--mc-text);
}
.fh-btn i {
  font-size: 13px;
}
.fh-pop {
  display: none;
  position: absolute;
  z-index: 30;
  left: 0;
  top: calc(100% + 6px);
  width: max-content;
  max-width: 46ch;
  white-space: normal;
  background: var(--mc-card);
  color: var(--mc-text);
  border: 1px solid var(--mc-border);
  border-radius: 8px;
  padding: 9px 11px;
  font-size: 12.5px;
  line-height: 1.5;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.38);
}
.fh:hover .fh-pop,
.fh.pinned .fh-pop {
  display: block;
}
</style>

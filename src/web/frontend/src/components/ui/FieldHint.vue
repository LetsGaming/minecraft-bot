<template>
  <span v-if="text" :class="['fh', { pinned }]">
    <button
      type="button"
      class="fh-btn"
      :aria-label="label ? t('ui.helpFor', { label }) : t('ui.help')"
      :aria-expanded="pinned"
      :aria-describedby="popId"
      @click.stop="pinned = !pinned"
      @blur="pinned = false"
      @keydown.escape="pinned = false"
    >
      <i class="pi pi-info-circle" aria-hidden="true" />
    </button>
    <span :id="popId" class="fh-pop" role="tooltip">{{ text }}</span>
  </span>
</template>

<script setup lang="ts">
import { ref, useId } from "vue";
import { t } from "../../i18n";

/**
 * Schema help text as an info affordance.
 *
 * The generated help runs to six to eight lines under nearly every field, and
 * the same scoping paragraph repeats across notifications, leaderboard,
 * tpsAlerts and reports for every guild. Inline, a form of twelve inputs read
 * as an essay with the inputs buried in it.
 *
 * So it collapses to one icon per field. The full text, never truncated,
 * appears on hover and is the button's description for assistive tech; a click
 * pins it open while the reader edits, Escape or leaving the button closes it.
 */
defineProps<{
  text?: string;
  /** The field this explains, so the button is not one of many called "Help". */
  label?: string;
}>();

const pinned = ref(false);
const popId = `fh-${useId()}`;
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
.fh.pinned .fh-pop,
.fh-btn:focus-visible + .fh-pop {
  display: block;
}
@media (pointer: coarse) {
  .fh-btn {
    min-width: var(--touch-min);
    min-height: var(--touch-min);
    justify-content: center;
    align-items: center;
  }
}
</style>

<template>
  <figure class="sb">
    <div class="sb-bar" role="img" :aria-label="label">
      <span
        v-for="segment in visible"
        :key="segment.key"
        class="sb-seg"
        :style="{ flexGrow: segment.share, background: segment.color }"
      />
    </div>
    <ul class="sb-legend">
      <li v-for="segment in segments" :key="segment.key" class="sb-item">
        <span class="sb-dot" :style="{ background: segment.color }" aria-hidden="true" />
        <span class="sb-name">{{ segment.label }}</span>
        <span class="sb-value">{{ segment.text }}</span>
      </li>
    </ul>
  </figure>
</template>

<script setup lang="ts">
import { computed } from "vue";

export interface BarSegment {
  key: string;
  label: string;
  /** Share of the whole, 0 to 100; sets the width. */
  share: number;
  /** The text shown for the segment in the legend, e.g. "12 %". */
  text: string;
  color: string;
}

/**
 * One bar split into shares, with a legend that carries the same numbers as
 * text, so nothing depends on seeing the colours.
 */
const props = defineProps<{ segments: BarSegment[]; label: string }>();
const visible = computed(() => props.segments.filter((s) => s.share > 0));
</script>

<style scoped>
.sb { margin: 0; display: grid; gap: var(--space-2); }
.sb-bar { display: flex; height: 10px; border-radius: var(--radius-full); overflow: hidden; background: var(--surface); gap: 2px; }
.sb-seg { min-width: 3px; flex-basis: 0; }
.sb-legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); margin: 0; padding: 0; list-style: none; font-size: var(--text-sm); }
.sb-item { display: inline-flex; align-items: center; gap: var(--space-1); }
.sb-dot { width: 8px; height: 8px; border-radius: var(--radius-full); }
.sb-name { color: var(--text-dim); }
.sb-value { font-variant-numeric: tabular-nums; }
</style>

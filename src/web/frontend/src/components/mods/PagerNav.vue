<template>
  <nav class="pager" :aria-label="label">
    <button
      type="button"
      class="pg tap"
      :disabled="page <= 1 || disabled"
      :aria-label="t('mods.catalog.previousPage')"
      @click="emit('update:page', page - 1)"
    >
      <i class="pi pi-angle-left" aria-hidden="true" />
    </button>
    <template v-for="(item, i) in items" :key="`${item}-${i}`">
      <span v-if="item === 'gap'" class="pg-gap" aria-hidden="true">…</span>
      <button
        v-else
        type="button"
        :class="['pg', 'tap', { on: item === page }]"
        :disabled="disabled"
        :aria-current="item === page ? 'page' : undefined"
        :aria-label="numberedLabels ? t('mods.catalog.pageNumber', { page: item }) : undefined"
        @click="emit('update:page', item)"
      >{{ item }}</button>
    </template>
    <button
      type="button"
      class="pg tap"
      :disabled="page >= pages || disabled"
      :aria-label="t('mods.catalog.nextPage')"
      @click="emit('update:page', page + 1)"
    >
      <i class="pi pi-angle-right" aria-hidden="true" />
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "../../i18n";
import { pageWindow } from "../../utils/modsFormat";

const props = defineProps<{
  page: number;
  pages: number;
  /** The nav landmark's accessible name. */
  label: string;
  /** Show only the first, last and nearby pages instead of every page. */
  windowed?: boolean;
  /** Give each page button an accessible name of its own. */
  numberedLabels?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:page": [page: number] }>();

const items = computed<Array<number | "gap">>(() =>
  props.windowed ? pageWindow(props.page, props.pages) : Array.from({ length: props.pages }, (_, i) => i + 1),
);
</script>

<style scoped>
.pager { display: inline-flex; flex-wrap: wrap; gap: var(--space-1); }
.pg {
  min-width: 32px;
  min-height: 32px;
  padding: 0 var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.pg:hover:not(:disabled) { background: var(--surface); border-color: var(--border-hover); }
.pg.on { background: var(--accent-tint); border-color: var(--accent); }
.pg:disabled { opacity: 0.45; cursor: default; }
.pg.on:disabled { opacity: 1; }
@media (pointer: coarse), (max-width: 760px) {
  .pg { min-width: var(--touch-min); min-height: var(--touch-min); }
}
.pg-gap { display: inline-flex; align-items: center; padding: 0 var(--space-1); color: var(--text-dim); }
</style>

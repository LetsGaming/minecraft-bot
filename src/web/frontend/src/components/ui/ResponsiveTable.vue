<template>
  <div class="rt" :style="maxHeight ? { maxHeight, overflowY: 'auto' } : undefined">
    <table class="rt-table">
      <caption class="sr-only">{{ caption }}</caption>
      <thead>
        <tr>
          <th
            v-for="col in columns"
            :key="col.key"
            scope="col"
            :class="[`align-${col.align ?? 'start'}`, { 'rt-num': col.numeric }]"
          >
            {{ col.label }}
          </th>
          <th v-if="$slots.actions" scope="col" class="align-end">
            <span :class="{ 'sr-only': !actionsLabelVisible }">{{ actionsLabel }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="keyOf(row, index)"
          :class="['rt-row', { busy: isBusy(row) }]"
          :aria-busy="isBusy(row) ? 'true' : undefined"
        >
          <component
            :is="col.primary ? 'th' : 'td'"
            v-for="col in columns"
            :key="col.key"
            :scope="col.primary ? 'row' : undefined"
            :data-label="col.label"
            :class="[
              `align-${col.align ?? 'start'}`,
              { 'rt-primary': col.primary, 'rt-num': col.numeric, 'rt-mono': col.mono },
            ]"
          >
            <slot :name="`cell-${col.key}`" :row="row" :index="index">
              {{ (row as Record<string, unknown>)[col.key] }}
            </slot>
          </component>
          <td v-if="$slots.actions" class="rt-actions align-end">
            <slot name="actions" :row="row" :index="index" :busy="isBusy(row)" />
          </td>
        </tr>
      </tbody>
    </table>
    <slot name="footer" />
  </div>
</template>

<script setup lang="ts" generic="T">
import type { ResponsiveColumn } from "./types";

const props = withDefaults(
  defineProps<{
    columns: ResponsiveColumn[];
    rows: T[];
    /** Read by screen readers only; tables need a name. */
    caption: string;
    rowKey?: (row: T, index: number) => string | number;
    busy?: (row: T) => boolean;
    actionsLabel?: string;
    actionsLabelVisible?: boolean;
    /** Caps the height so the header sticks inside the table instead of the page. */
    maxHeight?: string;
  }>(),
  {
    rowKey: undefined,
    busy: undefined,
    actionsLabel: "Actions",
    actionsLabelVisible: true,
    maxHeight: "",
  },
);

function keyOf(row: T, index: number): string | number {
  return props.rowKey ? props.rowKey(row, index) : index;
}

function isBusy(row: T): boolean {
  return props.busy ? props.busy(row) : false;
}
</script>

<style scoped>
.rt { container-type: inline-size; width: 100%; }
.rt-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--text-sm);
}
thead th {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  background: var(--surface-raised);
  color: var(--text-dim);
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--tracking-caps);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-strong);
  text-align: start;
  white-space: nowrap;
}
thead th:first-child { border-top-left-radius: var(--radius-control); }
thead th:last-child { border-top-right-radius: var(--radius-control); }
tbody th,
tbody td {
  padding: var(--row-pad-y) var(--space-3);
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  text-align: start;
  font-weight: 400;
}
tbody tr:last-child > * { border-bottom: none; }
.align-end { text-align: end; }
th.align-end, td.align-end { text-align: end; }
.rt-primary { color: var(--text); font-weight: 500; overflow-wrap: anywhere; }
.rt-mono { font-family: var(--font-mono); font-size: var(--text-xs); }
.rt-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.rt-row.busy > * { background: var(--surface-raised); }
.rt-row.busy > :first-child { box-shadow: inset 3px 0 0 var(--st-info); }
.rt-actions { white-space: nowrap; }
.rt-actions :deep(> *) { vertical-align: middle; }

@container (max-width: 760px) {
  .rt-table, .rt-table tbody { display: block; }
  .rt-table thead { display: none; }
  .rt-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-1) var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    margin-bottom: var(--space-2);
    background: var(--surface);
  }
  .rt-row.busy { background: var(--surface-raised); box-shadow: inset 3px 0 0 var(--st-info); }
  .rt-row.busy > * { background: none; box-shadow: none; }
  .rt-row > th,
  .rt-row > td {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    grid-column: 1 / -1;
    padding: 0;
    border: none;
    text-align: start;
  }
  .rt-row > td:not(.rt-actions)::before {
    content: attr(data-label);
    flex: none;
    color: var(--text-dim);
    font-size: var(--text-xs);
  }
  .rt-row > .rt-primary { font-size: var(--text-md); margin-bottom: var(--space-1); }
  .rt-row > .rt-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-2);
    white-space: normal;
  }
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

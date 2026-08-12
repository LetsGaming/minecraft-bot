<template>
  <div v-if="conflicts.length" class="conflicts">
    <div class="c-head">
      <h4>{{ conflicts.length }} queued {{ conflicts.length === 1 ? "change needs" : "changes need" }} a decision</h4>
      <p class="muted small">
        These keys changed on disk while your edits waited. Everything else
        applied on its own.
      </p>
    </div>

    <div v-for="conflict in conflicts" :key="keyOf(conflict)" class="c-row">
      <code class="c-key mono">{{ conflict.keyPath.join(".") }}</code>

      <!-- All three values, because "someone changed this" is not a decision
           anyone can make. What it was when you queued, what you wanted, and
           what is there now. -->
      <div class="c-values">
        <div class="c-val">
          <span class="c-label muted small">Was, when you queued</span>
          <code class="mono">{{ show(conflict.base) }}</code>
        </div>
        <div class="c-val c-mine">
          <span class="c-label muted small">Yours</span>
          <code class="mono">{{ show(conflict.queued) }}</code>
        </div>
        <div class="c-val">
          <span class="c-label muted small">On disk now</span>
          <code class="mono">{{ show(conflict.current) }}</code>
        </div>
      </div>

      <div class="c-actions">
        <Button
          label="Keep mine"
          size="small"
          :loading="busy === keyOf(conflict)"
          @click="$emit('resolve', { conflict, choice: 'queued' })"
        />
        <Button
          label="Keep disk"
          size="small"
          severity="secondary"
          outlined
          :loading="busy === keyOf(conflict)"
          @click="$emit('resolve', { conflict, choice: 'current' })"
        />
      </div>

      <span class="c-meta muted small" :title="timestampTitle(conflict.queuedAt)">
        queued {{ relativeAge(conflict.queuedAt) }}<template v-if="conflict.byTag"> by {{ conflict.byTag }}</template>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from "primevue/button";
import { relativeAge, timestampTitle } from "../../utils/time";
import type { EditConflict } from "../../composables/useModConfigs";

/**
 * Resolving queued edits whose keys moved underneath them.
 *
 * "Keep mine" does not rewrite the file directly: it rebases the queued edit
 * onto the current value, so the next flush sees an untouched key and applies
 * it through the same path as every other edit. That keeps one write path
 * rather than a second one that only conflict resolution uses.
 *
 * "Keep disk" drops the queued edit. Both are one click, because the operator
 * has already done the hard part by reading three values.
 */
defineProps<{
  conflicts: EditConflict[];
  /** Key currently being resolved, so its buttons show progress. */
  busy?: string;
}>();

defineEmits<{
  resolve: [payload: { conflict: EditConflict; choice: "queued" | "current" }];
}>();

const keyOf = (conflict: EditConflict): string => conflict.keyPath.join(".");

/** Values are config scalars or lists; render them the way the file would. */
function show(value: unknown): string {
  if (value === null || value === undefined) return "(unset)";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(empty)";
  return String(value);
}
</script>

<style scoped>
.conflicts {
  border: 1px solid var(--mc-mid);
  border-radius: var(--mc-radius);
  background: var(--mc-card);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.c-head h4 { margin: 0 0 2px; font-size: 14px; font-weight: 600; }
.c-head p { margin: 0 0 12px; max-width: 70ch; }

.c-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 8px 16px;
  padding: 10px 0;
  border-top: 0.5px solid var(--mc-border);
}
.c-key { font-size: 12.5px; word-break: break-word; }
.c-values { display: flex; flex-wrap: wrap; gap: 14px; }
.c-val { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.c-label { line-height: 1.2; }
.c-val code { font-size: 12.5px; overflow-wrap: anywhere; }
.c-mine code { color: var(--mc-accent); }
.c-actions { display: flex; gap: 6px; }
.c-meta { grid-column: 1 / -1; }

@media (max-width: 900px) {
  .c-row { grid-template-columns: 1fr; }
}
</style>

<template>
  <div v-if="conflicts.length" class="conflicts">
    <div class="c-head">
      <p class="c-title">
        {{ mode === "queued" ? t("conflict.queuedTitle", { count: conflicts.length }) : t("conflict.editTitle", { count: conflicts.length }) }}
      </p>
      <p class="c-lede">{{ mode === "queued" ? t("conflict.queuedLede") : t("conflict.editLede") }}</p>
    </div>

    <div v-for="conflict in conflicts" :key="keyOf(conflict)" class="c-row">
      <code class="c-key">{{ keyOf(conflict) }}</code>

      <!-- All three values, because "someone changed this" is not a decision
           anyone can make: what it was, what you wanted, and what is there now. -->
      <dl class="c-values">
        <div class="c-val">
          <dt>{{ mode === "queued" ? t("conflict.baseQueued") : t("conflict.baseEdit") }}</dt>
          <dd><code>{{ show(conflict.base) }}</code></dd>
        </div>
        <div class="c-val c-mine">
          <dt>{{ t("conflict.mine") }}</dt>
          <dd><code>{{ show(conflict.queued) }}</code></dd>
        </div>
        <div class="c-val">
          <dt>{{ t("conflict.current") }}</dt>
          <dd><code>{{ show(conflict.current) }}</code></dd>
        </div>
      </dl>

      <div class="c-actions">
        <Button
          :label="t('conflict.keepMine')"
          :aria-label="t('conflict.keepMineFor', { key: keyOf(conflict) })"
          size="small"
          class="tap"
          :loading="busy === keyOf(conflict)"
          @click="$emit('resolve', { conflict, choice: 'queued' })"
        />
        <Button
          :label="t('conflict.keepCurrent')"
          :aria-label="t('conflict.keepCurrentFor', { key: keyOf(conflict) })"
          size="small"
          severity="secondary"
          outlined
          class="tap"
          :loading="busy === keyOf(conflict)"
          @click="$emit('resolve', { conflict, choice: 'current' })"
        />
      </div>

      <span v-if="mode === 'queued'" class="c-meta" :title="timestampTitle(conflict.queuedAt)">
        {{ conflict.byTag
          ? t("conflict.queuedBy", { age: relativeAge(conflict.queuedAt), who: conflict.byTag })
          : t("conflict.queuedAt", { age: relativeAge(conflict.queuedAt) }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import Button from "primevue/button";
import { relativeAge, timestampTitle } from "../../utils/time";
import { t } from "../../i18n";
import type { EditConflict } from "../../composables/useEditableDocument";

/**
 * Settling fields that changed underneath the user.
 *
 * `edit`: a save found the document changed on disk; fields both sides
 * changed are listed, keep mine or take the version on disk.
 *
 * `queued`: mod config edits held while the wrapper was away. "Keep mine"
 * does not rewrite the file directly: it rebases the queued edit onto the
 * current value, so the next flush applies it through the same path as every
 * other edit. "Keep disk" drops the queued edit.
 */
withDefaults(
  defineProps<{
    conflicts: EditConflict[];
    /** Key currently being resolved, so its buttons show progress. */
    busy?: string;
    mode?: "edit" | "queued";
  }>(),
  { busy: "", mode: "edit" },
);

defineEmits<{
  resolve: [payload: { conflict: EditConflict; choice: "queued" | "current" }];
}>();

const keyOf = (conflict: EditConflict): string => conflict.keyPath.join(".");

/** Values are config scalars, lists or objects; render them the way the file would. */
function show(value: unknown): string {
  if (value === null || value === undefined) return t("field.unsetValue");
  if (Array.isArray(value)) {
    if (value.length === 0) return t("conflict.empty");
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
</script>

<style scoped>
.conflicts {
  border: 1px solid var(--st-degraded);
  border-radius: var(--radius-surface);
  background: var(--surface);
  padding: var(--space-3) var(--space-4);
}
.c-title { margin: 0 0 2px; font-weight: 600; }
.c-lede { margin: 0 0 var(--space-3); max-width: 70ch; color: var(--text-dim); font-size: var(--text-sm); }
.c-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--border);
}
.c-key { font: 400 var(--text-sm) / 1.4 var(--font-mono); overflow-wrap: anywhere; }
.c-values { display: flex; flex-wrap: wrap; gap: var(--space-3); margin: 0; min-width: 0; }
.c-val { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.c-val dt { color: var(--text-dim); font-size: var(--text-xs); }
.c-val dd { margin: 0; min-width: 0; }
.c-val code { font: 400 var(--text-sm) / 1.4 var(--font-mono); overflow-wrap: anywhere; }
.c-mine code { color: var(--accent); }
.c-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.c-meta { grid-column: 1 / -1; color: var(--text-dim); font-size: var(--text-xs); }
@media (max-width: 900px) {
  .c-row { grid-template-columns: minmax(0, 1fr); }
}
</style>

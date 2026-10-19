<template>
  <Dialog
    :visible="visible"
    modal
    :header="t('review.title', { count: changes.length })"
    :style="{ width: 'min(720px, calc(100vw - 32px))' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <p class="rv-lede">{{ t("review.lede") }}</p>
    <ul class="rv-list">
      <li v-for="change in changes" :key="change.key" class="rv-item">
        <code class="rv-key">{{ change.key }}</code>
        <p v-if="change.secret" class="rv-secret">{{ t("review.secretChanged") }}</p>
        <dl v-else class="rv-values">
          <dt>{{ t("review.before") }}</dt>
          <dd><del>{{ show(change.before) }}</del></dd>
          <dt>{{ t("review.after") }}</dt>
          <dd><ins>{{ show(change.after) }}</ins></dd>
        </dl>
      </li>
    </ul>
    <template #footer>
      <Button
        :label="t('review.close')"
        severity="secondary"
        outlined
        class="tap"
        @click="$emit('update:visible', false)"
      />
      <Button
        :label="t('editor.saveCount', { count: changes.length })"
        icon="pi pi-check"
        class="tap"
        :disabled="!canSave"
        @click="$emit('save')"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import { t } from "../../i18n";

export interface ReviewItem {
  /** The config key, dotted. */
  key: string;
  before: unknown;
  after: unknown;
  /** Values are not shown, only that it changed. */
  secret?: boolean;
}

/** The pending edits as was and now, one per changed field, with Save beside Close. */
defineProps<{
  visible: boolean;
  changes: ReviewItem[];
  canSave: boolean;
}>();

defineEmits<{ "update:visible": [open: boolean]; save: [] }>();

const MAX = 240;

function show(value: unknown): string {
  if (value === undefined) return t("review.unset");
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
}
</script>

<style scoped>
.rv-lede { margin: 0 0 var(--space-3); color: var(--text-dim); max-width: 64ch; }
.rv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rv-item { padding: var(--space-3) 0; border-top: 1px solid var(--border); min-width: 0; }
.rv-key { font: 400 var(--text-sm) / 1.4 var(--font-mono); overflow-wrap: anywhere; }
.rv-secret { margin: var(--space-1) 0 0; color: var(--text-dim); font-size: var(--text-sm); }
.rv-values {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-1) var(--space-3);
  margin: var(--space-2) 0 0;
  font-size: var(--text-sm);
}
.rv-values dt { color: var(--text-dim); }
.rv-values dd { margin: 0; min-width: 0; font-family: var(--font-mono); overflow-wrap: anywhere; }
.rv-values del { color: var(--danger); text-decoration-thickness: 1px; }
.rv-values ins { color: var(--st-online); text-decoration: none; }
</style>

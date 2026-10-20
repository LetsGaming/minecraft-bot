<template>
  <div :class="['field-row', { dirty, invalid: !!error, conflict }]" :data-field="keyPath || undefined">
    <div class="fr-grid">
      <div class="fr-text">
        <div class="fr-head">
          <span v-if="dotState" :class="['fr-dot', `is-${dotState}`]" aria-hidden="true" />
          <label :id="labelId" class="fr-label" :for="inputId">
            {{ label }}<span v-if="required" class="fr-req" aria-hidden="true"> *</span>
          </label>
          <span v-if="dirty" class="fr-tag fr-tag-changed">{{ t("field.changed") }}</span>
          <slot name="tags" />
          <button
            v-if="keyPath"
            type="button"
            class="fr-key"
            :title="t('field.copyKey', { key: keyPath })"
            :aria-label="t('field.copyKey', { key: keyPath })"
            @click="copyKey"
          >
            <code :id="keyId">{{ shortKey }}</code>
            <i :class="['pi', copied ? 'pi-check' : 'pi-copy']" aria-hidden="true" />
          </button>
        </div>
        <p v-if="help" :id="helpId" :class="['fr-help', { clamped: longHelp && !helpOpen }]">{{ help }}</p>
        <button
          v-if="longHelp"
          type="button"
          class="fr-more"
          :aria-expanded="helpOpen ? 'true' : 'false'"
          @click="helpOpen = !helpOpen"
        >
          {{ helpOpen ? t("field.helpLess") : t("field.helpMore") }}
        </button>
        <p v-if="effect" :id="effectId" class="fr-effect">
          <i class="pi pi-info-circle" aria-hidden="true" /> {{ effect }}
        </p>
      </div>
      <div class="fr-control">
        <slot :id="inputId" :labelId="labelId" :describedBy="describedBy" :invalid="!!error" />
        <p v-if="error" :id="errorId" class="fr-error" role="alert">{{ error }}</p>
        <slot name="meta" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { t } from "../../i18n";

/** Help longer than this starts clamped to one line. */
const LONG_HELP = 90;

/**
 * One editable setting: label bound to its control, the config key in mono,
 * help and effect lines, and the error under the control. A dot before the
 * label marks a change, an error or a conflict. The key shows as a copy chip.
 * Two columns once the row has room, one on a phone or in a dialog.
 */
const props = withDefaults(
  defineProps<{
    label: string;
    /** Id of the control in the slot. Generated when omitted; the slot receives it either way. */
    id?: string;
    /** The config key, shown in mono under the label. */
    keyPath?: string;
    help?: string;
    /** When a change takes hold, from the schema's `effect`. */
    effect?: string;
    dirty?: boolean;
    conflict?: boolean;
    error?: string;
    required?: boolean;
  }>(),
  { id: "", keyPath: "", help: "", effect: "", dirty: false, conflict: false, error: "", required: false },
);

const helpOpen = ref(false);
const copied = ref(false);
const shortKey = computed(() => props.keyPath.split(".").pop() ?? props.keyPath);
const dotState = computed(() => (props.error ? "invalid" : props.conflict ? "conflict" : props.dirty ? "dirty" : ""));

async function copyKey(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.keyPath);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    copied.value = false;
  }
}
const longHelp = computed(() => props.help.length > LONG_HELP);

const generated = useId();
const inputId = computed(() => props.id || `field-${generated}`);
const labelId = computed(() => `${inputId.value}-label`);
const keyId = computed(() => `${inputId.value}-key`);
const helpId = computed(() => `${inputId.value}-help`);
const effectId = computed(() => `${inputId.value}-effect`);
const errorId = computed(() => `${inputId.value}-error`);
const describedBy = computed(
  () =>
    [
      props.keyPath ? keyId.value : "",
      props.help ? helpId.value : "",
      props.effect ? effectId.value : "",
      props.error ? errorId.value : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined,
);
</script>

<style scoped>
.field-row {
  container-type: inline-size;
  position: relative;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  scroll-margin-top: 112px;
}
.field-row.dirty { background: linear-gradient(90deg, var(--accent-tint), transparent 55%); }
.fr-dot { flex: none; width: 8px; height: 8px; border-radius: var(--radius-full); background: var(--accent); }
.fr-dot.is-invalid { background: var(--danger); }
.fr-dot.is-conflict { background: var(--st-degraded); }
.fr-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-2) var(--space-5); }
@container (min-width: 620px) {
  .fr-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); }
}
.fr-text { min-width: 0; }
.fr-head { display: flex; align-items: center; gap: var(--space-1) var(--space-2); flex-wrap: wrap; }
.fr-label { font-weight: 500; color: var(--text); overflow-wrap: anywhere; }
.fr-req { color: var(--text-dim); }
.fr-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}
.fr-tag-changed { background: var(--accent-tint); color: var(--text); border: 1px solid var(--accent); }
.fr-key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 0 var(--space-2);
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.fr-key code { font: 400 var(--text-xs) / 1.6 var(--font-mono); overflow-wrap: anywhere; }
.fr-key .pi { font-size: var(--text-xs); }
.fr-key:hover { color: var(--text); border-color: var(--border-strong); }
.fr-key:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.fr-help {
  margin: var(--space-1) 0 0;
  max-width: 56ch;
  color: var(--text-dim);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.fr-help.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.fr-more {
  padding: 0;
  margin-top: var(--space-1);
  background: none;
  border: 0;
  color: var(--text-dim);
  font-size: var(--text-sm);
  cursor: pointer;
  text-decoration: underline;
}
.fr-more:hover { color: var(--text); }
.fr-effect {
  margin: var(--space-1) 0 0;
  max-width: 56ch;
  font-size: var(--text-sm);
  color: var(--st-pending);
}
.fr-effect .pi { font-size: var(--text-xs); }
.fr-control { display: grid; gap: var(--space-2); align-content: start; min-width: 0; }
.fr-control > :deep(.p-inputtext),
.fr-control > :deep(.p-select),
.fr-control > :deep(.p-multiselect),
.fr-control > :deep(.p-inputnumber),
.fr-control > :deep(.p-autocomplete),
.fr-control > :deep(.p-textarea) {
  width: 100%;
  min-width: 0;
}
.fr-error { margin: 0; font-size: var(--text-sm); color: var(--danger); max-width: 56ch; }
@media (pointer: coarse), (max-width: 760px) {
  .fr-more { min-height: var(--touch-min); }
}
/* Keeps a field scrolled to (first problem, focus) clear of the edit bar docked at the bottom. */
@media (max-width: 760px) {
  .field-row { scroll-margin-bottom: 200px; }
}
</style>

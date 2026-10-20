<template>
  <fieldset :id="fieldId || undefined" :class="['group', { 'has-error': !!error }]">
    <legend>
      <span class="g-title">{{ label || name }}</span>
      <code v-if="keyText" class="g-key">{{ keyText }}</code>
    </legend>
    <p v-if="description" class="g-help">{{ description }}</p>
    <p v-if="error" class="g-error" role="alert">{{ error }}</p>

    <p v-if="keys.length === 0" class="g-empty">{{ t("map.empty") }}</p>

    <template v-for="key in keys" :key="key">
      <MapEntry
        v-if="entryVisible(key)"
        :map-name="name"
        :entry-key="key"
        :value-schema="valueSchema"
        :definitions="definitions"
        :path="path"
        :key-path="[...keyPath, key]"
        :model-value="model[key]"
        @update:model-value="setValue(key, $event)"
        @remove="removeKey"
      />
    </template>

    <div v-if="!filtering && !locked" class="map-add">
      <label class="sr-only" :for="addId">{{ t("map.newKeyLabel", { name: label || name }) }}</label>
      <InputText
        :id="addId"
        v-model="newKey"
        :placeholder="t('map.newKeyPlaceholder')"
        :invalid="!!addError"
        :aria-describedby="addError ? `${addId}-error` : undefined"
        @keyup.enter="addKey"
      />
      <Button :label="t('map.add')" icon="pi pi-plus" class="tap" :disabled="!canAdd" @click="addKey" />
    </div>
    <p v-if="addError" :id="`${addId}-error`" class="g-error" role="alert">{{ addError }}</p>
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, inject, useId, type PropType } from "vue";
import { isRecord } from "../../utils/isRecord";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import MapEntry from "./MapEntry.vue";
import {
  mapValueSchema,
  classifyField,
  type JsonSchemaNode,
  type Definitions,
} from "./schemaField.js";
import { anyValueProp } from "./anyValueProp.js";
import { SchemaFormKey } from "../../composables/useSchemaForm.js";
import { t } from "../../i18n.js";

/**
 * Editor for a Record<string, X> map (commands, servers, schedules, guilds):
 * one entry per key with its own Remove button, the value rendered by
 * SchemaField, and a row to add a key. <SchemaField> is resolved from the
 * global registration (main.ts) to avoid a SchemaField, MapField import cycle.
 */
export default defineComponent({
  name: "MapField",
  components: { InputText, Button, MapEntry },
  props: {
    name: { type: String, required: true },
    label: { type: String, default: "" },
    schema: { type: Object as PropType<JsonSchemaNode>, required: true },
    definitions: {
      type: Object as PropType<Definitions>,
      required: false,
      default: undefined,
    },
    modelValue: anyValueProp,
    path: { type: Array as PropType<string[]>, required: false, default: () => [] },
    keyPath: { type: Array as PropType<string[]>, required: false, default: () => [] },
  },
  emits: ["update:model-value"],
  setup() {
    return { form: inject(SchemaFormKey, undefined), t, addId: `map-add-${useId()}` };
  },
  data() {
    return { newKey: "", addError: "" };
  },
  computed: {
    model(): Record<string, unknown> {
      return isRecord(this.modelValue) ? this.modelValue : {};
    },
    keys(): string[] {
      return Object.keys(this.model);
    },
    valueSchema(): JsonSchemaNode {
      return mapValueSchema(this.schema, this.definitions);
    },
    description(): string {
      return this.schema.description ?? "";
    },
    keyText(): string {
      return this.keyPath.join(".");
    },
    fieldId(): string {
      return this.form && this.keyPath.length ? this.form.idFor(this.keyPath) : "";
    },
    error(): string {
      return this.form && this.keyPath.length ? this.form.errorFor(this.keyPath) : "";
    },
    filtering(): boolean {
      return this.form?.filtering() ?? false;
    },
    locked(): boolean {
      return this.form?.locked() ?? false;
    },
    canAdd(): boolean {
      return this.newKey.trim().length > 0;
    },
  },
  methods: {
    entryVisible(key: string): boolean {
      return !this.form || this.keyPath.length === 0 || this.form.isVisible([...this.keyPath, key]);
    },
    emitMap(next: Record<string, unknown>) {
      this.$emit("update:model-value", Object.keys(next).length > 0 ? next : undefined);
    },
    setValue(key: string, value: unknown) {
      const next = { ...this.model };
      if (value === undefined) delete next[key];
      else next[key] = value;
      this.emitMap(next);
    },
    removeKey(key: string) {
      const next = { ...this.model };
      delete next[key];
      this.emitMap(next);
    },
    // A type-appropriate empty value so the new key persists and renders the
    // right control immediately (object → {}, list → [], scalar → "").
    blankValue(): unknown {
      const k = classifyField(this.valueSchema, this.definitions);
      if (k === "object" || k === "map") return {};
      if (k === "array" || k === "multiselect" || k === "chips" || k === "numberList") return [];
      if (k === "boolean") return false;
      return "";
    },
    addKey() {
      const key = this.newKey.trim();
      this.addError = "";
      if (!key) return;
      if (key in this.model) {
        this.addError = t("map.exists", { key });
        return;
      }
      this.newKey = "";
      this.emitMap({ ...this.model, [key]: this.blankValue() });
    },
  },
});
</script>

<style scoped>
.group {
  min-width: 0;
  margin: var(--space-2) var(--space-3);
  padding: var(--space-2) var(--space-3) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  scroll-margin-top: 112px;
}
.group.has-error { border-color: var(--danger); }
.group legend {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  padding: 0 var(--space-2);
  max-width: 100%;
}
.g-title { font-weight: 600; color: var(--text); }
.g-key { font: 400 var(--text-xs) / 1.4 var(--font-mono); color: var(--text-dim); overflow-wrap: anywhere; }
.g-help { margin: var(--space-1) var(--space-2) var(--space-2); color: var(--text-dim); font-size: var(--text-sm); max-width: 64ch; }
.g-error { margin: var(--space-1) var(--space-2); color: var(--danger); font-size: var(--text-sm); }
.g-empty { margin: var(--space-1) var(--space-2) var(--space-2); color: var(--text-dim); font-size: var(--text-sm); }
.map-add { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin: var(--space-3) var(--space-2) 0; }
.map-add :deep(.p-inputtext) { flex: 1 1 180px; min-width: 0; }
@media (max-width: 760px) {
  .group { margin: var(--space-2) 0; padding: var(--space-2) var(--space-1) var(--space-3); }
}
</style>

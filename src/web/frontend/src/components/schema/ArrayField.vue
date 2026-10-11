<template>
  <fieldset :id="fieldId || undefined" :class="['group', { 'has-error': !!error }]">
    <legend>
      <span class="g-title">{{ label || name }}</span>
      <code v-if="keyText" class="g-key">{{ keyText }}</code>
    </legend>
    <p v-if="description" class="g-help">{{ description }}</p>
    <p v-if="error" class="g-error" role="alert">{{ error }}</p>

    <p v-if="items.length === 0" class="g-empty">{{ t("array.empty") }}</p>

    <template v-for="(item, i) in items" :key="i">
      <div v-if="itemVisible(i)" class="arr-item">
        <div class="arr-item-top">
          <span class="arr-name">{{ t("array.item", { n: i + 1 }) }}</span>
          <Button
            icon="pi pi-trash"
            text
            severity="secondary"
            class="tap"
            :aria-label="t('array.remove', { n: i + 1, name: label || name })"
            :disabled="locked"
            v-tooltip.top="t('array.remove', { n: i + 1, name: label || name })"
            @click="removeItem(i)"
          />
        </div>
        <SchemaField
          :name="t('array.item', { n: i + 1 })"
          :schema="itemSchema"
          :definitions="definitions"
          :path="path"
          :key-path="[...keyPath, String(i)]"
          :model-value="item"
          @update:model-value="setItem(i, $event)"
        />
      </div>
    </template>

    <Button
      v-if="!filtering && !locked"
      :label="t('array.add')"
      icon="pi pi-plus"
      text
      class="tap arr-add"
      @click="addItem"
    />
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, inject, type PropType } from "vue";
import Button from "primevue/button";
import {
  arrayItemSchema,
  classifyField,
  type JsonSchemaNode,
  type Definitions,
} from "./schemaField.js";
import { SchemaFormKey } from "../../composables/useSchemaForm.js";
import { t } from "../../i18n.js";

/**
 * Editor for an array of objects (or an "X or X[]" union whose item is an
 * object, e.g. chatBridge): one block per item with a Remove button and the
 * item rendered by SchemaField. A single (non-array) value is shown as one
 * item and always emitted as an array (valid for the union's array branch).
 */
export default defineComponent({
  name: "ArrayField",
  components: { Button },
  props: {
    name: { type: String, required: true },
    label: { type: String, default: "" },
    schema: { type: Object as PropType<JsonSchemaNode>, required: true },
    definitions: {
      type: Object as PropType<Definitions>,
      required: false,
      default: undefined,
    },
    modelValue: { type: null as unknown as PropType<unknown>, required: false },
    path: { type: Array as PropType<string[]>, required: false, default: () => [] },
    keyPath: { type: Array as PropType<string[]>, required: false, default: () => [] },
  },
  emits: ["update:model-value"],
  setup() {
    return { form: inject(SchemaFormKey, undefined), t };
  },
  computed: {
    items(): unknown[] {
      const v = this.modelValue;
      if (Array.isArray(v)) return v;
      return v === undefined || v === null ? [] : [v];
    },
    itemSchema(): JsonSchemaNode {
      return arrayItemSchema(this.schema, this.definitions);
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
  },
  methods: {
    itemVisible(i: number): boolean {
      return !this.form || this.keyPath.length === 0 || this.form.isVisible([...this.keyPath, String(i)]);
    },
    emitArray(next: unknown[]) {
      this.$emit("update:model-value", next.length > 0 ? next : undefined);
    },
    setItem(i: number, value: unknown) {
      const next = [...this.items];
      next[i] = value ?? {};
      this.emitArray(next);
    },
    removeItem(i: number) {
      const next = [...this.items];
      next.splice(i, 1);
      this.emitArray(next);
    },
    addItem() {
      const k = classifyField(this.itemSchema, this.definitions);
      const blank = k === "object" || k === "map" ? {} : k === "array" ? [] : "";
      this.emitArray([...this.items, blank]);
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
.group.has-error { border-left: 3px solid var(--danger); }
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
.arr-item { border-left: 2px solid var(--border); padding-left: var(--space-2); margin: var(--space-2) 0; min-width: 0; }
.arr-item-top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding-left: var(--space-2); }
.arr-name { color: var(--text-dim); font-size: var(--text-sm); }
.arr-add { margin-top: var(--space-2); }
@media (max-width: 760px) {
  .group { margin: var(--space-2) 0; padding: var(--space-2) var(--space-1) var(--space-3); }
}
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-width: var(--touch-min); min-height: var(--touch-min); }
}
</style>

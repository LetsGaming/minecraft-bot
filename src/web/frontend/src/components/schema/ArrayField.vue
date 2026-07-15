<template>
  <fieldset class="group">
    <legend>{{ name }}</legend>
    <p v-if="description" class="hint group-hint">{{ description }}</p>

    <div v-if="items.length === 0" class="muted small arr-empty">No items yet.</div>

    <div v-for="(item, i) in items" :key="i" class="arr-item">
      <div class="arr-item-top">
        <span class="muted small">Item {{ i + 1 }}</span>
        <Button
          icon="pi pi-trash"
          text
          severity="secondary"
          size="small"
          v-tooltip.top="'Remove'"
          @click="removeItem(i)"
        />
      </div>
      <SchemaField
        :name="`Item ${i + 1}`"
        :schema="itemSchema"
        :definitions="definitions"
        :model-value="item"
        @update:model-value="setItem(i, $event)"
      />
    </div>

    <Button label="Add item" icon="pi pi-plus" size="small" text @click="addItem" />
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import Button from "primevue/button";
import {
  arrayItemSchema,
  classifyField,
  type JsonSchemaNode,
  type Definitions,
} from "./schemaField.js";

/**
 * Editor for an array of objects (or an "X or X[]" union whose item is an
 * object, e.g. chatBridge) — one card per item with a Remove button and the
 * item rendered by SchemaField. A single (non-array) value is shown as one
 * item and always emitted as an array (valid for the union's array branch).
 * SchemaField is loaded async and cast to a generic Component to break the
 * SchemaField ⇄ ArrayField type-inference cycle.
 */
export default defineComponent({
  name: "ArrayField",
  components: {
    Button,
  },
  props: {
    name: { type: String, required: true },
    schema: { type: Object as PropType<JsonSchemaNode>, required: true },
    definitions: {
      type: Object as PropType<Definitions>,
      required: false,
      default: undefined,
    },
    modelValue: { type: null as unknown as PropType<unknown>, required: false },
  },
  emits: ["update:model-value"],
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
  },
  methods: {
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
.arr-item {
  border-left: 2px solid var(--mc-border);
  padding-left: 12px;
  margin: 10px 0;
}
.arr-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.arr-empty {
  margin: 4px 0 10px;
}
.hint {
  color: var(--mc-muted);
  font-size: 12.5px;
  line-height: 1.45;
}
.group-hint {
  margin: 0 0 8px;
}
.group {
  border: 1px solid var(--mc-border);
  border-radius: 10px;
  margin: 14px 0;
  padding: 6px 16px 14px;
  background: rgba(255, 255, 255, 0.012);
}
.group legend {
  font-weight: 700;
  padding: 0 8px;
  color: var(--mc-text);
}
</style>

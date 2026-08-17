<template>
  <fieldset class="group">
    <legend>{{ name }}</legend>
    <FieldHint v-if="description" :text="description" class="group-hint" />

    <div v-if="keys.length === 0" class="muted small map-empty">No entries yet.</div>

    <MapEntry
      v-for="key in keys"
      :key="key"
      :map-name="name"
      :entry-key="key"
      :value-schema="valueSchema"
      :definitions="definitions"
      :path="path"
      :model-value="model[key]"
      @update:model-value="setValue(key, $event)"
      @remove="removeKey"
    />

    <div class="map-add">
      <InputText
        v-model="newKey"
        placeholder="New entry key…"
        size="small"
        @keyup.enter="addKey"
      />
      <Button label="Add" icon="pi pi-plus" size="small" :disabled="!canAdd" @click="addKey" />
    </div>
    <span v-if="addError" class="err">{{ addError }}</span>
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import { isRecord } from "../../utils/isRecord";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import FieldHint from "../ui/FieldHint.vue";
import MapEntry from "./MapEntry.vue";
import {
  mapValueSchema,
  classifyField,
  type JsonSchemaNode,
  type Definitions,
} from "./schemaField.js";

/**
 * Editor for a Record<string, X> map (commands, options, servers, schedules,
 * …) — a row per key with a Remove button and the value rendered by
 * SchemaField (so the value gets its own typed inputs, recursively), plus an
 * add-key row. Reused wherever the schema is an object with additionalProperties
 * instead of a raw JSON textarea. <SchemaField> is resolved from the global
 * registration (main.ts) to avoid a SchemaField ⇄ MapField import cycle.
 */
export default defineComponent({
  name: "MapField",
  components: {
    InputText,
    Button,
    FieldHint,
    MapEntry,
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
    path: { type: Array as PropType<string[]>, required: false, default: () => [] },
  },
  emits: ["update:model-value"],
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
    canAdd(): boolean {
      return this.newKey.trim().length > 0;
    },
  },
  methods: {
    emitMap(next: Record<string, unknown>) {
      this.$emit(
        "update:model-value",
        Object.keys(next).length > 0 ? next : undefined,
      );
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
        this.addError = `"${key}" already exists.`;
        return;
      }
      this.newKey = "";
      this.emitMap({ ...this.model, [key]: this.blankValue() });
    },
  },
});
</script>

<style scoped>
.map-add {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.map-empty {
  margin: 4px 0 10px;
}
.err {
  color: var(--mc-bad);
  font-size: 12.5px;
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

<template>
  <!-- Boolean -->
  <label v-if="kind === 'boolean'" class="field row">
    <input
      type="checkbox"
      :checked="modelValue === true"
      @change="emitValue(($event.target as HTMLInputElement).checked)"
    />
    <span>{{ name }}</span>
    <span v-if="description" class="hint">{{ description }}</span>
  </label>

  <!-- Enum -->
  <label v-else-if="kind === 'enum'" class="field">
    <span>{{ name }}</span>
    <select
      :value="modelValue ?? ''"
      @change="emitValue(($event.target as HTMLSelectElement).value || undefined)"
    >
      <option value="">(unset)</option>
      <option v-for="opt in enumValues" :key="String(opt)" :value="opt">
        {{ opt }}
      </option>
    </select>
    <span v-if="description" class="hint">{{ description }}</span>
  </label>

  <!-- String / number -->
  <label v-else-if="kind === 'string' || kind === 'number'" class="field">
    <span>{{ name }}</span>
    <input
      :type="kind === 'number' ? 'number' : 'text'"
      :value="modelValue ?? ''"
      @input="onScalarInput(($event.target as HTMLInputElement).value)"
    />
    <span v-if="description" class="hint">{{ description }}</span>
  </label>

  <!-- Object with declared properties: recurse -->
  <fieldset v-else-if="kind === 'object'" class="field group">
    <legend>{{ name }}</legend>
    <p v-if="description" class="hint">{{ description }}</p>
    <SchemaField
      v-for="(childSchema, key) in objectProps"
      :key="key"
      :name="String(key)"
      :schema="childSchema"
      :model-value="objectValue[key]"
      @update:model-value="setChild(String(key), $event)"
    />
  </fieldset>

  <!-- Everything else (arrays, records, unions): JSON textarea -->
  <label v-else class="field">
    <span>{{ name }} <em class="muted">(JSON)</em></span>
    <textarea
      :value="jsonText"
      spellcheck="false"
      @change="onJsonInput(($event.target as HTMLTextAreaElement).value)"
    ></textarea>
    <span v-if="jsonError" class="error">{{ jsonError }}</span>
    <span v-else-if="description" class="hint">{{ description }}</span>
  </label>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
}

export default defineComponent({
  name: "SchemaField",
  props: {
    name: { type: String, required: true },
    schema: { type: Object as PropType<unknown>, required: true },
    // `null` type = accept anything; typed via PropType<unknown> without
    // a default so vue-tsc infers `unknown | undefined` instead of
    // collapsing the prop to the default's type.
    modelValue: { type: null as unknown as PropType<unknown>, required: false },
  },
  emits: ["update:model-value"],
  data() {
    return { jsonError: "" };
  },
  computed: {
    node(): JsonSchemaNode {
      return (this.schema ?? {}) as JsonSchemaNode;
    },
    description(): string {
      return this.node.description ?? "";
    },
    enumValues(): unknown[] {
      return this.node.enum ?? [];
    },
    objectProps(): Record<string, unknown> {
      return this.node.properties ?? {};
    },
    objectValue(): Record<string, unknown> {
      return (this.modelValue ?? {}) as Record<string, unknown>;
    },
    kind(): string {
      if (this.enumValues.length > 0) return "enum";
      const type = Array.isArray(this.node.type)
        ? this.node.type[0]
        : this.node.type;
      if (type === "boolean") return "boolean";
      if (type === "string") return "string";
      if (type === "number" || type === "integer") return "number";
      if (type === "object" && this.node.properties) return "object";
      return "json";
    },
    jsonText(): string {
      return this.modelValue === undefined
        ? ""
        : JSON.stringify(this.modelValue, null, 2);
    },
  },
  methods: {
    emitValue(value: unknown) {
      this.$emit("update:model-value", value);
    },
    onScalarInput(raw: string) {
      if (raw === "") return this.emitValue(undefined);
      this.emitValue(this.kind === "number" ? Number(raw) : raw);
    },
    setChild(key: string, value: unknown) {
      const next = { ...this.objectValue };
      if (value === undefined) delete next[key];
      else next[key] = value;
      this.emitValue(Object.keys(next).length > 0 ? next : undefined);
    },
    onJsonInput(raw: string) {
      this.jsonError = "";
      if (raw.trim() === "") return this.emitValue(undefined);
      try {
        this.emitValue(JSON.parse(raw));
      } catch (err) {
        this.jsonError = `Invalid JSON: ${(err as Error).message}`;
      }
    },
  },
});
</script>

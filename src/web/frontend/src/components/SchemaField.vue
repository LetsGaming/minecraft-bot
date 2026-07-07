<template>
  <!-- Boolean -->
  <div v-if="kind === 'boolean'" class="field row">
    <ToggleSwitch
      :modelValue="modelValue === true"
      @update:modelValue="emitValue($event)"
    />
    <div class="label-block">
      <span class="fname">{{ name }}</span>
      <span v-if="description" class="hint">{{ description }}</span>
    </div>
  </div>

  <!-- Enum -->
  <div v-else-if="kind === 'enum'" class="field">
    <label class="fname">{{ name }}</label>
    <Select
      :modelValue="modelValue ?? null"
      :options="enumOptions"
      optionLabel="label"
      optionValue="value"
      showClear
      placeholder="(unset)"
      class="fcontrol"
      @update:modelValue="emitValue($event ?? undefined)"
    />
    <span v-if="description" class="hint">{{ description }}</span>
  </div>

  <!-- String -->
  <div v-else-if="kind === 'string'" class="field">
    <label class="fname">{{ name }}</label>
    <InputText
      :modelValue="(modelValue as string) ?? ''"
      class="fcontrol"
      @update:modelValue="onScalarInput($event ?? '')"
    />
    <span v-if="description" class="hint">{{ description }}</span>
  </div>

  <!-- Number -->
  <div v-else-if="kind === 'number'" class="field">
    <label class="fname">{{ name }}</label>
    <InputNumber
      :modelValue="(modelValue as number) ?? null"
      class="fcontrol"
      :useGrouping="false"
      @update:modelValue="emitValue($event ?? undefined)"
    />
    <span v-if="description" class="hint">{{ description }}</span>
  </div>

  <!-- Object with declared properties: recurse -->
  <fieldset v-else-if="kind === 'object'" class="group">
    <legend>{{ name }}</legend>
    <p v-if="description" class="hint group-hint">{{ description }}</p>
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
  <div v-else class="field">
    <label class="fname">{{ name }} <em class="muted">(JSON)</em></label>
    <Textarea
      :modelValue="jsonText"
      spellcheck="false"
      autoResize
      class="fcontrol json-area"
      @update:modelValue="onJsonInput($event)"
    />
    <span v-if="jsonError" class="err">{{ jsonError }}</span>
    <span v-else-if="description" class="hint">{{ description }}</span>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import Textarea from "primevue/textarea";

interface JsonSchemaNode {
  type?: string | string[];
  enum?: unknown[];
  description?: string;
  properties?: Record<string, unknown>;
  additionalProperties?: unknown;
}

export default defineComponent({
  name: "SchemaField",
  components: { InputText, InputNumber, Select, ToggleSwitch, Textarea },
  props: {
    name: { type: String, required: true },
    schema: { type: Object as PropType<unknown>, required: true },
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
    enumOptions(): { value: unknown; label: string }[] {
      return this.enumValues.map((v) => ({ value: v, label: String(v) }));
    },
    objectProps(): Record<string, unknown> {
      return this.node.properties ?? {};
    },
    objectValue(): Record<string, unknown> {
      return (this.modelValue ?? {}) as Record<string, unknown>;
    },
    kind(): string {
      if (this.enumValues.length > 0) return "enum";
      const type = Array.isArray(this.node.type) ? this.node.type[0] : this.node.type;
      if (type === "boolean") return "boolean";
      if (type === "string") return "string";
      if (type === "number" || type === "integer") return "number";
      if (type === "object" && this.node.properties) return "object";
      return "json";
    },
    jsonText(): string {
      return this.modelValue === undefined ? "" : JSON.stringify(this.modelValue, null, 2);
    },
  },
  methods: {
    emitValue(value: unknown) {
      this.$emit("update:model-value", value);
    },
    onScalarInput(raw: string) {
      if (raw === "") return this.emitValue(undefined);
      this.emitValue(raw);
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

<style scoped>
.field { display: flex; flex-direction: column; gap: 5px; margin: 12px 0; }
.field.row { flex-direction: row; align-items: flex-start; gap: 12px; }
.label-block { display: flex; flex-direction: column; gap: 2px; padding-top: 2px; }
.fname { font-weight: 600; font-size: 14px; }
.fcontrol { width: 100%; max-width: 480px; }
.json-area { max-width: 640px; font-family: ui-monospace, monospace; font-size: 13px; }
.hint { color: var(--mc-muted); font-size: 12.5px; line-height: 1.45; max-width: 60ch; }
.group-hint { margin: 0 0 8px; }
.err { color: var(--mc-bad); font-size: 12.5px; }

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

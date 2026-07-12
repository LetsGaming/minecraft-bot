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
      :definitions="definitions"
      :model-value="objectValue[key]"
      @update:model-value="setChild(String(key), $event)"
    />
  </fieldset>

  <!-- Array of a fixed enum → multiselect (e.g. notification events) -->
  <div v-else-if="kind === 'multiselect'" class="field">
    <label class="fname">{{ name }}</label>
    <MultiSelect
      :modelValue="arrayModel"
      :options="arrayEnumOptions"
      optionLabel="label"
      optionValue="value"
      display="chip"
      filter
      placeholder="(none)"
      class="fcontrol"
      @update:modelValue="emitArray($event)"
    />
    <span v-if="description" class="hint">{{ description }}</span>
  </div>

  <!-- Array of free-form strings → chips (e.g. adminUsers, a ServerScope list) -->
  <div v-else-if="kind === 'chips'" class="field">
    <label class="fname">{{ name }}</label>
    <InputChips
      :modelValue="(arrayModel as string[])"
      separator=","
      class="fcontrol"
      @update:modelValue="emitArray($event)"
    />
    <span v-if="description" class="hint">{{ description }}</span>
  </div>

  <!-- Array of numbers → chips with numeric coercion (e.g. warnMinutes) -->
  <div v-else-if="kind === 'numberList'" class="field">
    <label class="fname">{{ name }}</label>
    <InputChips
      :modelValue="(arrayModel as unknown[]).map(String)"
      separator=","
      class="fcontrol"
      @update:modelValue="emitNumberArray($event)"
    />
    <span class="hint">Numbers, comma-separated.<template v-if="description"> {{ description }}</template></span>
  </div>

  <!-- Record<string, X> → key/value editor (reused MapField) -->
  <MapField
    v-else-if="kind === 'map'"
    :name="name"
    :schema="node"
    :definitions="definitions"
    :model-value="modelValue"
    @update:model-value="emitValue($event)"
  />

  <!-- Array of objects (or X|X[] of objects) → item-list editor (ArrayField) -->
  <ArrayField
    v-else-if="kind === 'array'"
    :name="name"
    :schema="node"
    :definitions="definitions"
    :model-value="modelValue"
    @update:model-value="emitValue($event)"
  />

  <!-- Genuine last resort (mixed-type unions, free-form objects): JSON -->
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
import MultiSelect from "primevue/multiselect";
import InputChips from "primevue/inputchips";
import ToggleSwitch from "primevue/toggleswitch";
import Textarea from "primevue/textarea";
import MapField from "./MapField.vue";
import ArrayField from "./ArrayField.vue";
import {
  derefNode,
  classifyField,
  arrayEnumOptions as arrayEnumOptionsFor,
  type JsonSchemaNode,
  type Definitions,
} from "./schemaField.js";

export default defineComponent({
  name: "SchemaField",
  components: { InputText, InputNumber, Select, MultiSelect, InputChips, ToggleSwitch, Textarea, MapField, ArrayField },
  props: {
    name: { type: String, required: true },
    schema: { type: Object as PropType<unknown>, required: true },
    modelValue: { type: null as unknown as PropType<unknown>, required: false },
    /** The schema's `definitions` map, threaded down so `$ref`s resolve at
     *  every depth (root topRef, enum item refs, …). */
    definitions: {
      type: Object as PropType<Definitions>,
      required: false,
      default: undefined,
    },
  },
  emits: ["update:model-value"],
  data() {
    return { jsonError: "" };
  },
  computed: {
    node(): JsonSchemaNode {
      return derefNode(this.schema, this.definitions);
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
    arrayEnumOptions(): { value: unknown; label: string }[] {
      return arrayEnumOptionsFor(this.node, this.definitions);
    },
    objectProps(): Record<string, unknown> {
      return this.node.properties ?? {};
    },
    objectValue(): Record<string, unknown> {
      return (this.modelValue ?? {}) as Record<string, unknown>;
    },
    // Coerce the value for array-like controls: an "X or X[]" union may hold a
    // single value (e.g. ServerScope "smp") — present it as a one-item list.
    arrayModel(): unknown[] {
      const v = this.modelValue;
      if (Array.isArray(v)) return v;
      return v === undefined || v === null ? [] : [v];
    },
    kind(): string {
      return classifyField(this.node, this.definitions);
    },
    jsonText(): string {
      return this.modelValue === undefined ? "" : JSON.stringify(this.modelValue, null, 2);
    },
  },
  methods: {
    emitValue(value: unknown) {
      this.$emit("update:model-value", value);
    },
    emitArray(value: unknown) {
      // Empty selection → unset (drop the key), matching the scalar/object
      // handling; a non-empty selection is emitted as-is.
      const arr = Array.isArray(value) ? value : [];
      this.emitValue(arr.length > 0 ? arr : undefined);
    },
    emitNumberArray(value: unknown) {
      // Chips come back as strings; coerce to numbers and drop non-numeric.
      const arr = (Array.isArray(value) ? value : [])
        .map((x) => Number(x))
        .filter((n) => !Number.isNaN(n));
      this.emitValue(arr.length > 0 ? arr : undefined);
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

<template>
  <!-- Boolean -->
  <div v-if="kind === 'boolean'" class="field row">
    <ToggleSwitch
      :modelValue="modelValue === true"
      @update:modelValue="emitValue($event)"
    />
    <div class="label-block">
      <span class="fname">{{ name }} <FieldHint :text="description" /></span>
    </div>
  </div>

  <!-- Enum -->
  <div v-else-if="kind === 'enum'" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
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
  </div>

  <!-- ID reference (single) → dropdown of entity names (channel/role/server) -->
  <div v-else-if="refControl && !refControl.multi" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
    <Select
      :modelValue="modelValue ?? null"
      :options="refControl.options"
      optionLabel="label"
      optionValue="id"
      showClear
      filter
      placeholder="(unset)"
      class="fcontrol"
      @update:modelValue="emitValue($event ?? undefined)"
    />
  </div>

  <!-- ID reference (one or many) → multi-select of entity names -->
  <div v-else-if="refControl && refControl.multi" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
    <MultiSelect
      :modelValue="arrayModel"
      :options="refControl.options"
      optionLabel="label"
      optionValue="id"
      display="chip"
      filter
      placeholder="(none)"
      class="fcontrol"
      @update:modelValue="emitArray($event)"
    />
  </div>

  <!-- String -->
  <div v-else-if="kind === 'string'" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
    <InputText
      :modelValue="(modelValue as string) ?? ''"
      class="fcontrol"
      @update:modelValue="onScalarInput($event ?? '')"
    />
  </div>

  <!-- Number -->
  <div v-else-if="kind === 'number'" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
    <InputNumber
      :modelValue="(modelValue as number) ?? null"
      class="fcontrol"
      :useGrouping="false"
      @update:modelValue="emitValue($event ?? undefined)"
    />
  </div>

  <!-- Object with declared properties: collapsible section (P1).
       Collapsed by default; the header's chip states On/Off/Configured/Unset
       so the section is readable without expanding, and a New badge flags a
       feature the config has never set. -->
  <section v-else-if="kind === 'object'" :class="['section', 'depth-' + depthClass, { open: expanded }]">
    <div class="section-head-wrap">
      <button
        type="button"
        class="section-head"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <i class="pi section-caret" :class="expanded ? 'pi-chevron-down' : 'pi-chevron-right'" />
        <span class="section-meta">
          <span class="stitle-row">
            <!-- P2: the scope path, so a field is never ambiguous about which
                 guild or feature it belongs to (e.g. "Data Corner › notifications"). -->
            <span v-if="path.length" class="scrumb">{{ path.join(" › ") }} ›</span>
            <span class="stitle">{{ sectionTitle }}</span>
            <span v-if="showNew" class="badge-new">New</span>
          </span>
          <span v-if="description" class="section-desc">{{ description }}</span>
        </span>
        <span :class="['chip', 'chip-' + sectionInfo.chip]">{{ chipLabel }}</span>
      </button>
      <!-- P4: drop just this subtree to raw JSON and back, without the whole
           form becoming a blob. -->
      <button
        type="button"
        :class="['json-toggle', { on: jsonMode }]"
        :title="jsonMode ? 'Back to form' : 'Edit as JSON'"
        @click.stop="toggleJson"
      >
        <i class="pi" :class="jsonMode ? 'pi-list' : 'pi-code'" />
      </button>
    </div>

    <div v-if="expanded" class="section-body">
      <template v-if="jsonMode">
        <Textarea
          :modelValue="jsonText"
          spellcheck="false"
          autoResize
          class="fcontrol json-area"
          @update:modelValue="onJsonInput($event)"
        />
        <span v-if="jsonError" class="err">{{ jsonError }}</span>
      </template>
      <SchemaField
        v-for="(childSchema, key) in objectProps"
        v-else
        :key="key"
        :name="String(key)"
        :schema="childSchema"
        :definitions="definitions"
        :path="[...path, sectionTitle]"
        :model-value="objectValue[key]"
        @update:model-value="setChild(String(key), $event)"
      />
    </div>
  </section>

  <!-- Array of a fixed enum → multiselect (e.g. notification events) -->
  <div v-else-if="kind === 'multiselect'" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
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
  </div>

  <!-- Array of free-form strings → chips (e.g. adminUsers, a ServerScope list) -->
  <div v-else-if="kind === 'chips'" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
    <InputChips
      :modelValue="(arrayModel as string[])"
      separator=","
      class="fcontrol"
      @update:modelValue="emitArray($event)"
    />
  </div>

  <!-- Array of numbers → chips with numeric coercion (e.g. warnMinutes) -->
  <div v-else-if="kind === 'numberList'" class="field">
    <label class="fname">{{ name }} <FieldHint :text="description" /></label>
    <InputChips
      :modelValue="arrayModel.map(String)"
      separator=","
      class="fcontrol"
      @update:modelValue="emitNumberArray($event)"
    />
  </div>

  <!-- Record<string, X> → key/value editor (reused MapField) -->
  <MapField
    v-else-if="kind === 'map'"
    :name="name"
    :schema="node"
    :definitions="definitions"
    :path="path"
    :model-value="modelValue"
    @update:model-value="emitValue($event)"
  />

  <!-- Array of objects (or X|X[] of objects) → item-list editor (ArrayField) -->
  <ArrayField
    v-else-if="kind === 'array'"
    :name="name"
    :schema="node"
    :definitions="definitions"
    :path="[...path, sectionTitle]"
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
    <FieldHint v-else :text="description" />
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, type PropType } from "vue";
import { errorMessage } from "../../utils/errorMessage";
import { isRecord } from "../../utils/isRecord";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import InputChips from "primevue/inputchips";
import ToggleSwitch from "primevue/toggleswitch";
import Textarea from "primevue/textarea";
import MapField from "./MapField.vue";
import ArrayField from "./ArrayField.vue";
import FieldHint from "../ui/FieldHint.vue";
import {
  derefNode,
  classifyField,
  referenceKind,
  arrayEnumOptions as arrayEnumOptionsFor,
  sectionState as computeSectionState,
  humanizeKey,
  type SectionState,
  type JsonSchemaNode,
  type Definitions,
} from "./schemaField.js";
import { isFeatureNew } from "../../composables/useSeenFeatures.js";
import {
  SchemaRefsKey,
  type RefOption,
} from "../../composables/useSchemaRefs.js";

export default defineComponent({
  name: "SchemaField",
  components: {
    InputText, InputNumber, Select, MultiSelect, InputChips, ToggleSwitch,
    Textarea, MapField, ArrayField, FieldHint,
  },
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
    /** Ancestor section titles, for the header breadcrumb (P2). */
    path: {
      type: Array as PropType<string[]>,
      required: false,
      default: () => [],
    },
  },
  emits: ["update:model-value"],
  setup() {
    // Named-entity options for ID fields, provided by the config editor.
    // Absent (undefined) when no editor supplies them → text/chips fallback.
    return { schemaRefs: inject(SchemaRefsKey, undefined) };
  },
  data() {
    // Sections collapse by default: the header chip states On/Off/Configured/
    // Unset, so the form reads as a scannable index and expands one at a time.
    return { jsonError: "", expanded: false, jsonMode: false };
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
    // Section header (P1): title prefers a schema `title`, else a humanised key.
    sectionTitle(): string {
      return this.node.title ?? humanizeKey(this.name);
    },
    sectionInfo(): SectionState {
      return computeSectionState(this.schema, this.modelValue, this.definitions);
    },
    // New is a top-level, first-seen concept: an unset sub-object three levels
    // deep is not "new", and an unset feature the user has already seen is just
    // Unset, not New (see useSeenFeatures).
    showNew(): boolean {
      return (
        this.path.length === 0 &&
        this.sectionInfo.isNew &&
        isFeatureNew(this.name)
      );
    },
    chipLabel(): string {
      return {
        on: "On",
        off: "Off",
        configured: "Configured",
        unset: "Unset",
      }[this.sectionInfo.chip];
    },
    // Depth drives the header's weight/size rhythm (capped so it never
    // vanishes): top-level features read louder than a sub-object three in.
    depthClass(): number {
      return Math.min(this.path.length, 2);
    },
    objectValue(): Record<string, unknown> {
      return isRecord(this.modelValue) ? this.modelValue : {};
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
    // If this field is an ID reference AND named options are available, render
    // a dropdown of names instead of a raw-ID input. `multi` follows the field
    // shape: a string is a single Select; a list (ServerScope, allowedServers,
    // classified "chips") is a MultiSelect. No options → null → text fallback.
    refControl(): { multi: boolean; options: RefOption[] } | null {
      const rk = referenceKind(this.name);
      if (!rk || !this.schemaRefs) return null;
      const refs = this.schemaRefs;
      const options =
        rk === "server" ? refs.servers : rk === "channel" ? refs.channels : refs.roles;
      if (!options || options.length === 0) return null;
      return { multi: this.kind === "chips", options };
    },
    /**
     * When an ID field falls back to a text box, say why.
     *
     * A bare input holding a snowflake is indistinguishable from a design
     * decision. Naming the cause turns it into a temporary state ("still
     * loading") or an actionable one ("the bot cannot list this guild's
     * channels"), and stops it reading as the way the product works.
     */
    refFallbackNote(): string {
      const rk = referenceKind(this.name);
      if (!rk || rk === "server" || this.refControl) return "";
      switch (this.schemaRefs?.status) {
        case "loading":
          return `Loading ${rk}s…`;
        case "unavailable":
          return `Can't list this guild's ${rk}s right now — enter an ID, or reopen once the bot can reach it.`;
        case "ready":
          return `This guild has no ${rk} the bot can use.`;
        default:
          return "";
      }
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
    toggleJson() {
      this.jsonMode = !this.jsonMode;
      // Editing JSON on a collapsed section would hide the editor.
      if (this.jsonMode) this.expanded = true;
    },
    onJsonInput(raw: string) {
      this.jsonError = "";
      if (raw.trim() === "") return this.emitValue(undefined);
      try {
        this.emitValue(JSON.parse(raw));
      } catch (err) {
        this.jsonError = `Invalid JSON: ${errorMessage(err)}`;
      }
    },
  },
});
</script>

<style scoped>
.ref-note { color: var(--mc-mid); display: block; margin-top: 3px; }
.field { display: flex; flex-direction: column; gap: 5px; margin: 12px 0; }
.field.row { flex-direction: row; align-items: flex-start; gap: 12px; }
.label-block { display: flex; flex-direction: column; gap: 2px; padding-top: 2px; }
.fname { font-weight: 600; font-size: 14px; }
.fcontrol { width: 100%; max-width: 480px; }
.json-area { max-width: 640px; font-family: ui-monospace, monospace; font-size: 13px; }
.group-hint { margin: 0 0 8px; }
.err { color: var(--mc-bad); font-size: 12.5px; }

/* Collapsible object section (P1) */
.section {
  border: 1px solid var(--mc-border);
  border-radius: 10px;
  margin: 8px 0;
  background: var(--mc-surface);
  overflow: hidden;
}
.section.open {
  border-color: color-mix(in srgb, var(--mc-accent) 22%, var(--mc-border));
}
.section-head-wrap { display: flex; align-items: stretch; }
.section-head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--mc-text);
}
.json-toggle {
  flex: none;
  width: 40px;
  background: none;
  border: none;
  border-left: 1px solid var(--mc-border);
  color: var(--mc-muted);
  cursor: pointer;
}
.json-toggle:hover { color: var(--mc-text); background: rgba(255, 255, 255, 0.02); }
.json-toggle.on { color: var(--mc-accent); }
.json-toggle i { font-size: 13px; }
.scrumb { color: var(--mc-muted); font-weight: 500; font-size: 12px; }
.section-head:hover { background: rgba(255, 255, 255, 0.02); }
.section-caret { font-size: 12px; color: var(--mc-muted); flex: none; }
.section-meta { flex: 1; min-width: 0; }
.stitle-row { display: flex; align-items: center; gap: 8px; }
.stitle { font-weight: 600; font-size: 14px; }
.depth-1 .stitle { font-size: 13.5px; }
.depth-2 .stitle { font-size: 13px; font-weight: 550; }
.depth-1 > .section-head-wrap .section-head { padding: 9px 14px; }
.depth-2 > .section-head-wrap .section-head { padding: 8px 14px; }
.section-desc {
  display: block;
  color: var(--mc-muted);
  font-size: 12px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60ch;
}
.badge-new {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--mc-accent) 18%, transparent);
  color: var(--mc-accent);
  border: 1px solid color-mix(in srgb, var(--mc-accent) 35%, transparent);
}
.chip {
  flex: none;
  font-size: 11px;
  font-weight: 500;
  padding: 3px 10px;
  border-radius: 20px;
  background: var(--mc-card);
  color: var(--mc-muted);
}
.chip-on { background: color-mix(in srgb, var(--mc-good) 16%, transparent); color: var(--mc-good); }
.chip-off { background: var(--mc-card); color: var(--mc-muted); }
.chip-configured { background: color-mix(in srgb, var(--mc-accent) 15%, transparent); color: var(--mc-accent); }
.chip-unset { background: var(--mc-card); color: var(--mc-muted); }
.section-body {
  padding: 4px 16px 14px 34px;
  border-top: 1px solid var(--mc-border);
}
</style>

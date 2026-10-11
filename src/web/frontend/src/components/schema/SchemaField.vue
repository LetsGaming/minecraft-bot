<template>
  <template v-if="visible">
    <!-- One control: a FieldRow with label, key line, help, error and the old value. -->
    <FieldRow
      v-if="isLeaf"
      :id="fieldId"
      :label="label"
      :key-path="keyText"
      :help="help"
      :effect="text.effect"
      :dirty="dirty"
      :conflict="conflict"
      :error="error"
    >
      <template #tags>
        <span v-if="secret" class="sf-tag sf-tag-secret">{{ t("field.secret") }}</span>
        <span v-if="conflict" class="sf-tag sf-tag-conflict">{{ t("field.conflict") }}</span>
      </template>
      <template #default="{ id, labelId, describedBy, invalid }">
        <div v-if="secret" class="sf-secret">
          <InputText
            :id="id"
            :type="revealed ? 'text' : 'password'"
            :model-value="secretInput"
            :placeholder="secretWasSet ? t('field.secretSet') : t('field.secretUnset')"
            autocomplete="new-password"
            spellcheck="false"
            :aria-describedby="describedBy"
            :disabled="locked"
            :invalid="invalid"
            @update:model-value="onSecretInput($event ?? '')"
          />
          <Button
            :label="revealed ? t('field.hideSecret') : t('field.showSecret')"
            :aria-label="revealed ? t('field.hideSecretFor', { name: label }) : t('field.showSecretFor', { name: label })"
            :aria-pressed="revealed ? 'true' : 'false'"
            severity="secondary"
            outlined
            class="sf-reveal"
            :disabled="!secretInput"
            @click="revealed = !revealed"
          />
        </div>
        <ToggleSwitch
          v-else-if="kind === 'boolean'"
          :model-value="modelValue === true"
          :input-id="id"
          :disabled="locked"
          :pt="{ input: { 'aria-describedby': describedBy } }"
          @update:model-value="emitValue($event)"
        />
        <Select
          v-else-if="kind === 'enum'"
          :model-value="modelValue ?? null"
          :options="enumOptions"
          option-label="label"
          option-value="value"
          show-clear
          :placeholder="t('field.unsetChoice')"
          :label-id="id"
          :aria-labelledby="labelId"
          :disabled="locked"
          :invalid="invalid"
          :pt="{ label: { 'aria-describedby': describedBy } }"
          @update:model-value="emitValue($event ?? undefined)"
        />
        <Select
          v-else-if="refControl && !refControl.multi"
          :model-value="modelValue ?? null"
          :options="refControl.options"
          option-label="label"
          option-value="id"
          show-clear
          filter
          :placeholder="t('field.unsetChoice')"
          :label-id="id"
          :aria-labelledby="labelId"
          :disabled="locked"
          :invalid="invalid"
          :pt="{ label: { 'aria-describedby': describedBy } }"
          @update:model-value="emitValue($event ?? undefined)"
        />
        <MultiSelect
          v-else-if="refControl && refControl.multi"
          :model-value="arrayModel"
          :options="refControl.options"
          option-label="label"
          option-value="id"
          display="chip"
          filter
          :placeholder="t('field.noneChoice')"
          :input-id="id"
          :aria-labelledby="labelId"
          :disabled="locked"
          :invalid="invalid"
          @update:model-value="emitArray($event)"
        />
        <InputText
          v-else-if="kind === 'string'"
          :id="id"
          :model-value="(modelValue as string) ?? ''"
          :aria-describedby="describedBy"
          :disabled="locked"
          :invalid="invalid"
          @update:model-value="onScalarInput($event ?? '')"
        />
        <InputNumber
          v-else-if="kind === 'number'"
          :model-value="(modelValue as number) ?? null"
          :input-id="id"
          :use-grouping="false"
          :max-fraction-digits="6"
          :disabled="locked"
          :invalid="invalid"
          :pt="{ pcInputText: { root: { 'aria-describedby': describedBy } } }"
          @update:model-value="emitValue($event ?? undefined)"
        />
        <MultiSelect
          v-else-if="kind === 'multiselect'"
          :model-value="arrayModel"
          :options="arrayEnumOptions"
          option-label="label"
          option-value="value"
          display="chip"
          filter
          :placeholder="t('field.noneChoice')"
          :input-id="id"
          :aria-labelledby="labelId"
          :disabled="locked"
          :invalid="invalid"
          @update:model-value="emitArray($event)"
        />
        <InputChips
          v-else-if="kind === 'chips'"
          :model-value="(arrayModel as string[])"
          separator=","
          :input-id="id"
          :input-props="{ 'aria-describedby': describedBy }"
          :aria-labelledby="labelId"
          :pt="CHIPS_PT"
          :disabled="locked"
          :invalid="invalid"
          @update:model-value="emitArray($event)"
        />
        <InputChips
          v-else-if="kind === 'numberList'"
          :model-value="arrayModel.map(String)"
          separator=","
          :input-id="id"
          :input-props="{ 'aria-describedby': describedBy }"
          :aria-labelledby="labelId"
          :pt="CHIPS_PT"
          :disabled="locked"
          :invalid="invalid"
          @update:model-value="emitNumberArray($event)"
        />
        <Textarea
          v-else
          :id="id"
          :model-value="jsonText"
          spellcheck="false"
          auto-resize
          class="sf-json"
          :aria-describedby="describedBy"
          :disabled="locked"
          :invalid="invalid || !!jsonError"
          @update:model-value="onJsonInput($event)"
        />
        <span v-if="jsonError" class="sf-error">{{ jsonError }}</span>
        <span v-if="refFallbackNote" class="sf-note">{{ refFallbackNote }}</span>
      </template>
      <template #meta>
        <span v-if="dirty" class="sf-was">
          <template v-if="!secret">{{ t("field.was") }} <s>{{ shownBaseline }}</s></template>
          <button type="button" class="sf-reset" :disabled="locked" @click="reset">{{ t("field.reset") }}</button>
        </span>
        <span v-if="defaultText" class="sf-meta">{{ defaultText }}</span>
      </template>
    </FieldRow>

    <!-- An object the editor already titles (a group with one section): its fields, no header. -->
    <div v-else-if="kind === 'object' && bare" class="sf-bare">
      <p v-if="error" class="sf-error sf-pad" role="alert">{{ error }}</p>
      <SchemaField
        v-for="(childSchema, key) in objectProps"
        :key="key"
        :name="String(key)"
        :schema="childSchema"
        :definitions="definitions"
        :path="path"
        :key-path="[...keyPath, String(key)]"
        :model-value="objectValue[key]"
        @update:model-value="setChild(String(key), $event)"
      />
    </div>

    <!-- An object: a collapsible section. Its chip says On, Off, Configured or
         Unset so it reads without opening; New flags a feature never set. -->
    <section
      v-else-if="kind === 'object'"
      :id="fieldId || undefined"
      :class="['section', 'depth-' + depthClass, { open, 'has-error': !!error || problemInside, dirty: dirtyInside }]"
    >
      <div class="section-head-wrap">
        <button
          type="button"
          class="section-head"
          :aria-expanded="open ? 'true' : 'false'"
          @click="expanded = !open"
        >
          <i class="pi section-caret" :class="open ? 'pi-chevron-down' : 'pi-chevron-right'" aria-hidden="true" />
          <span class="section-meta">
            <span class="stitle-row">
              <span v-if="path.length" class="scrumb">{{ path.join(" › ") }} ›</span>
              <span class="stitle">{{ label }}</span>
              <span v-if="showNew" class="badge-new">{{ t("field.new") }}</span>
            </span>
            <code v-if="keyText" class="section-key">{{ keyText }}</code>
            <span v-if="text.description" class="section-desc">{{ text.description }}</span>
          </span>
          <span :class="['chip', 'chip-' + sectionInfo.chip]">{{ chipLabel }}</span>
        </button>
        <button
          type="button"
          :class="['json-toggle', { on: jsonMode }]"
          :aria-label="jsonMode ? t('field.backToForm', { name: label }) : t('field.editAsJson', { name: label })"
          :aria-pressed="jsonMode ? 'true' : 'false'"
          :title="jsonMode ? t('field.backToForm', { name: label }) : t('field.editAsJson', { name: label })"
          :disabled="locked"
          @click.stop="toggleJson"
        >
          <i class="pi" :class="jsonMode ? 'pi-list' : 'pi-code'" aria-hidden="true" />
        </button>
      </div>
      <p v-if="error" class="sf-error sf-pad" role="alert">{{ error }}</p>

      <div v-if="open" class="section-body">
        <template v-if="jsonMode">
          <label class="sr-only" :for="`${fieldId || name}-json`">{{ t("field.jsonOf", { name: label }) }}</label>
          <Textarea
            :id="`${fieldId || name}-json`"
            :model-value="jsonText"
            spellcheck="false"
            auto-resize
            class="sf-json"
            :disabled="locked"
            @update:model-value="onJsonInput($event)"
          />
          <span v-if="jsonError" class="sf-error">{{ jsonError }}</span>
        </template>
        <SchemaField
          v-for="(childSchema, key) in objectProps"
          v-else
          :key="key"
          :name="String(key)"
          :schema="childSchema"
          :definitions="definitions"
          :path="[...path, label]"
          :key-path="[...keyPath, String(key)]"
          :model-value="objectValue[key]"
          @update:model-value="setChild(String(key), $event)"
        />
      </div>
    </section>

    <MapField
      v-else-if="kind === 'map'"
      :name="name"
      :label="label"
      :schema="node"
      :definitions="definitions"
      :path="path"
      :key-path="keyPath"
      :model-value="modelValue"
      @update:model-value="emitValue($event)"
    />

    <ArrayField
      v-else-if="kind === 'array'"
      :name="name"
      :label="label"
      :schema="node"
      :definitions="definitions"
      :path="[...path, label]"
      :key-path="keyPath"
      :model-value="modelValue"
      @update:model-value="emitValue($event)"
    />
  </template>
</template>

<script lang="ts">
import { defineComponent, inject, type PropType } from "vue";
import { SECRET_PLACEHOLDER } from "@mcbot/schema";
import { errorMessage } from "../../utils/errorMessage";
import { isRecord } from "../../utils/isRecord";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import InputChips from "primevue/inputchips";
import ToggleSwitch from "primevue/toggleswitch";
import Textarea from "primevue/textarea";
import Button from "primevue/button";
import MapField from "./MapField.vue";
import ArrayField from "./ArrayField.vue";
import FieldRow from "../ui/FieldRow.vue";
import { CHIPS_PT } from "../ui/chipsA11y";
import {
  derefNode,
  classifyField,
  referenceKind,
  isReferenceField,
  arrayEnumOptions as arrayEnumOptionsFor,
  sectionState as computeSectionState,
  humanizeKey,
  type SectionState,
  type JsonSchemaNode,
  type Definitions,
  type FieldKind,
} from "./schemaField.js";
import { fieldText, sameValue } from "./formIndex.js";
import { isFeatureNew } from "../../composables/useSeenFeatures.js";
import { SchemaRefsKey, type RefOption } from "../../composables/useSchemaRefs.js";
import { SchemaFormKey } from "../../composables/useSchemaForm.js";
import { t } from "../../i18n.js";

const SHOWN_MAX = 80;


function shortValue(value: unknown): string {
  if (value === undefined || value === null) return t("field.unsetValue");
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > SHOWN_MAX ? `${text.slice(0, SHOWN_MAX)}…` : text;
}

export default defineComponent({
  name: "SchemaField",
  components: {
    InputText, InputNumber, Select, MultiSelect, InputChips, ToggleSwitch,
    Textarea, Button, MapField, ArrayField, FieldRow,
  },
  props: {
    name: { type: String, required: true },
    schema: { type: Object as PropType<unknown>, required: true },
    modelValue: { type: null as unknown as PropType<unknown>, required: false },
    /** The schema's `definitions`, threaded down so `$ref`s resolve at every depth. */
    definitions: {
      type: Object as PropType<Definitions>,
      required: false,
      default: undefined,
    },
    /** Ancestor section titles, for the header breadcrumb. */
    path: {
      type: Array as PropType<string[]>,
      required: false,
      default: () => [],
    },
    /** Real config keys from the document root; ties the field to the editor's filter, errors and saved values. */
    keyPath: {
      type: Array as PropType<string[]>,
      required: false,
      default: () => [],
    },
    /** Display name; defaults to the schema title, then the humanised key. */
    labelText: { type: String, default: "" },
    /** Render an object's fields without its own section header. */
    bare: { type: Boolean, default: false },
  },
  emits: ["update:model-value"],
  setup() {
    return {
      schemaRefs: inject(SchemaRefsKey, undefined),
      form: inject(SchemaFormKey, undefined),
      t,
      CHIPS_PT,
    };
  },
  data() {
    return { jsonError: "", expanded: false, jsonMode: false, revealed: false };
  },
  computed: {
    node(): JsonSchemaNode {
      return derefNode(this.schema, this.definitions);
    },
    text(): { title?: string; description: string; effect: string } {
      return fieldText(this.schema, this.definitions);
    },
    label(): string {
      return this.labelText || this.text.title || humanizeKey(this.name);
    },
    keyText(): string {
      return this.keyPath.join(".");
    },
    kind(): string {
      return classifyField(this.node, this.definitions);
    },
    isLeaf(): boolean {
      return this.kind !== "object" && this.kind !== "map" && this.kind !== "array";
    },
    visible(): boolean {
      return !this.form || this.keyPath.length === 0 || this.form.isVisible(this.keyPath);
    },
    locked(): boolean {
      return this.form?.locked() ?? false;
    },
    fieldId(): string {
      return this.form && this.keyPath.length ? this.form.idFor(this.keyPath) : "";
    },
    error(): string {
      return this.form && this.keyPath.length ? this.form.errorFor(this.keyPath) : "";
    },
    conflict(): boolean {
      return !!this.form && this.keyPath.length > 0 && this.form.conflictAt(this.keyPath);
    },
    baseline(): { known: boolean; value: unknown } {
      return this.form && this.keyPath.length
        ? this.form.baselineAt(this.keyPath)
        : { known: false, value: undefined };
    },
    dirty(): boolean {
      return this.baseline.known && !sameValue(this.modelValue, this.baseline.value);
    },
    shownBaseline(): string {
      return shortValue(this.baseline.value);
    },
    defaultText(): string {
      return this.node.default === undefined ? "" : t("field.default", { value: shortValue(this.node.default) });
    },
    secret(): boolean {
      return !!this.form && this.keyPath.length > 0 && this.form.isSecret(this.keyPath);
    },
    secretWasSet(): boolean {
      const before = this.baseline.known ? this.baseline.value : this.modelValue;
      return before === SECRET_PLACEHOLDER;
    },
    secretInput(): string {
      return typeof this.modelValue === "string" && this.modelValue !== SECRET_PLACEHOLDER ? this.modelValue : "";
    },
    help(): string {
      return this.secret ? [this.text.description, t("field.secretHelp")].filter(Boolean).join(" ") : this.text.description;
    },
    enumOptions(): { value: unknown; label: string }[] {
      return (this.node.enum ?? []).map((v) => ({ value: v, label: String(v) }));
    },
    arrayEnumOptions(): { value: unknown; label: string }[] {
      return arrayEnumOptionsFor(this.node, this.definitions);
    },
    objectProps(): Record<string, unknown> {
      return this.node.properties ?? {};
    },
    sectionInfo(): SectionState {
      return computeSectionState(this.schema, this.modelValue, this.definitions);
    },
    // New is a top-level, first-seen concept: an unset sub-object three levels
    // deep is not "new", and an unset feature the user has already seen is just
    // Unset, not New (see useSeenFeatures).
    showNew(): boolean {
      return this.path.length === 0 && this.sectionInfo.isNew && isFeatureNew(this.name);
    },
    chipLabel(): string {
      return {
        on: t("field.chipOn"),
        off: t("field.chipOff"),
        configured: t("field.chipConfigured"),
        unset: t("field.chipUnset"),
      }[this.sectionInfo.chip];
    },
    problemInside(): boolean {
      return !!this.form && this.keyPath.length > 0 && this.form.hasProblemUnder(this.keyPath);
    },
    dirtyInside(): boolean {
      return this.baseline.known && !sameValue(this.modelValue, this.baseline.value);
    },
    /** A section opens on its own while filtering, around a problem, or when the editor jumps into it. */
    open(): boolean {
      if (this.expanded) return true;
      if (!this.form || this.keyPath.length === 0) return false;
      return this.form.filtering() || this.problemInside || this.form.isRevealed(this.keyPath);
    },
    // Depth drives the header's weight: top-level features read louder than a sub-object three in.
    depthClass(): number {
      return Math.min(this.path.length, 2);
    },
    objectValue(): Record<string, unknown> {
      return isRecord(this.modelValue) ? this.modelValue : {};
    },
    // An "X or X[]" union may hold a single value (ServerScope "smp"); show it as a one-item list.
    arrayModel(): unknown[] {
      const v = this.modelValue;
      if (Array.isArray(v)) return v;
      return v === undefined || v === null ? [] : [v];
    },
    // An ID reference with named options renders a dropdown of names; without
    // options it falls back to a text box (see refFallbackNote).
    refControl(): { multi: boolean; options: RefOption[] } | null {
      const rk = isReferenceField(this.name, this.kind as FieldKind);
      if (!rk || !this.schemaRefs) return null;
      const refs = this.schemaRefs;
      const options = rk === "server" ? refs.servers : rk === "channel" ? refs.channels : refs.roles;
      if (!options || options.length === 0) return null;
      return { multi: this.kind === "chips", options };
    },
    /** Why an ID field is a text box: still loading, or the bot cannot list this guild's channels. */
    refFallbackNote(): string {
      const rk = referenceKind(this.name);
      if (!rk || rk === "server" || this.refControl || !this.isLeaf) return "";
      const kindName = t(rk === "channel" ? "field.refChannels" : "field.refRoles");
      switch (this.schemaRefs?.status) {
        case "loading":
          return t("field.refLoading", { kind: kindName });
        case "unavailable":
          return t("field.refUnavailable", { kind: kindName });
        case "ready":
          return t("field.refNone", { kind: kindName });
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
      // An empty selection unsets the key, like the scalar and object fields.
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
      this.emitValue(raw === "" ? undefined : raw);
    },
    /** An emptied secret keeps the stored one (the placeholder tells the server so). */
    onSecretInput(raw: string) {
      if (raw !== "") this.emitValue(raw);
      else this.emitValue(this.secretWasSet ? SECRET_PLACEHOLDER : undefined);
    },
    reset() {
      const value = this.baseline.value;
      this.emitValue(value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
    },
    setChild(key: string, value: unknown) {
      const next = { ...this.objectValue };
      if (value === undefined) delete next[key];
      else next[key] = value;
      this.emitValue(Object.keys(next).length > 0 ? next : undefined);
    },
    toggleJson() {
      this.jsonMode = !this.jsonMode;
      if (this.jsonMode) this.expanded = true;
    },
    onJsonInput(raw: string) {
      this.jsonError = "";
      if (raw.trim() === "") return this.emitValue(undefined);
      try {
        this.emitValue(JSON.parse(raw));
      } catch (err) {
        this.jsonError = t("field.invalidJson", { error: errorMessage(err) });
      }
    },
  },
});
</script>

<style scoped>
.sf-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: var(--text-xs);
  font-weight: 500;
  white-space: nowrap;
}
.sf-tag-secret { color: var(--st-degraded); background: var(--st-degraded-bg); }
.sf-tag-conflict { color: var(--st-degraded); background: var(--st-degraded-bg); }
.sf-secret { display: flex; gap: var(--space-2); min-width: 0; }
.sf-secret :deep(.p-inputtext) { flex: 1 1 auto; min-width: 0; }
.sf-reveal { flex: none; }
.sf-json { font-family: var(--font-mono); font-size: var(--text-sm); width: 100%; }
.sf-error { color: var(--danger); font-size: var(--text-sm); margin: 0; }
.sf-pad { padding: var(--space-2) var(--space-4) 0; }
.sf-note { color: var(--text-dim); font-size: var(--text-xs); }
.sf-was, .sf-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.sf-was s { text-decoration-thickness: 1px; font-family: var(--font-mono); }
.sf-reset {
  padding: 0;
  background: none;
  border: 0;
  color: var(--link);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.sf-reset:disabled { color: var(--text-dim); cursor: default; }
.sf-bare { display: flex; flex-direction: column; }

.section {
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  margin: var(--space-2) var(--space-3);
  background: var(--surface-nav);
  overflow: hidden;
  scroll-margin-top: 112px;
}
.section.open { border-color: var(--border-strong); }
.section.dirty { border-left: 3px solid var(--accent); }
.section.has-error { border-left: 3px solid var(--danger); }
.section-head-wrap { display: flex; align-items: stretch; }
.section-head {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--control-h);
  padding: var(--space-3) var(--space-4);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--text);
  font: inherit;
}
.section-head:hover, .json-toggle:hover { background: var(--surface-raised); }
.json-toggle {
  flex: none;
  width: var(--touch-min);
  background: none;
  border: none;
  border-left: 1px solid var(--border);
  color: var(--text-dim);
  cursor: pointer;
}
.json-toggle.on { color: var(--accent); }
.json-toggle:disabled { cursor: default; opacity: 0.6; }
.scrumb { color: var(--text-dim); font-weight: 500; font-size: var(--text-xs); overflow-wrap: anywhere; }
.section-caret { font-size: var(--text-xs); color: var(--text-dim); flex: none; }
.section-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.stitle-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); }
.stitle { font-weight: 600; overflow-wrap: anywhere; }
.depth-2 .stitle { font-weight: 550; }
.section-key { font: 400 var(--text-xs) / 1.4 var(--font-mono); color: var(--text-dim); overflow-wrap: anywhere; }
.section-desc {
  color: var(--text-dim);
  font-size: var(--text-xs);
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 64ch;
}
.badge-new {
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 0 7px;
  border-radius: var(--radius-full);
  background: var(--accent-tint);
  color: var(--accent);
  border: 1px solid var(--accent-border);
}
.chip {
  flex: none;
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 2px var(--space-2);
  border-radius: var(--radius-control);
  background: var(--surface-raised);
  color: var(--text-dim);
}
.chip-on { background: var(--st-online-bg); color: var(--st-online); }
.chip-configured { background: var(--accent-tint); color: var(--accent); }
.section-body { border-top: 1px solid var(--border); padding: var(--space-1) 0 var(--space-2); }
.section-body > .sf-json { margin: var(--space-3) var(--space-4); width: calc(100% - 2 * var(--space-4)); }
@media (max-width: 760px) {
  .section { margin: var(--space-2) 0; }
}
@media (pointer: coarse), (max-width: 760px) {
  .sf-reset { min-height: var(--touch-min); }
  .section-head { min-height: var(--touch-min); }
}
</style>

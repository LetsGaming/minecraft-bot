<template>
  <div class="map-entry">
    <div class="map-entry-top">
      <!-- A Discord snowflake is not a heading. The ID stays visible, small,
           because it is still the thing you paste into a support thread. -->
      <span class="map-key">
        <strong v-if="!valueIsObject">{{ label }}</strong>
        <code v-if="label !== entryKey" class="map-key-id">{{ entryKey }}</code>
      </span>
      <Button
        icon="pi pi-trash"
        text
        severity="secondary"
        class="tap"
        :aria-label="t('map.remove', { key: label })"
        :disabled="locked"
        v-tooltip.top="t('map.remove', { key: label })"
        @click="$emit('remove', entryKey)"
      />
    </div>
    <SchemaField
      :name="valueIsObject ? label : entryKey"
      :label-text="valueIsObject ? label : ''"
      :schema="valueSchema"
      :definitions="definitions"
      :path="valueIsObject ? path : [...path, label]"
      :key-path="keyPath"
      :model-value="modelValue"
      @update:model-value="$emit('update:model-value', $event)"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, provide, type PropType } from "vue";
import Button from "primevue/button";
import {
  MapKeyLabelKey,
  SchemaScopeKey,
  SchemaRefsKey,
} from "../../composables/useSchemaRefs.js";
import { SchemaFormKey } from "../../composables/useSchemaForm.js";
import { classifyField, type JsonSchemaNode, type Definitions } from "./schemaField.js";
import { t } from "../../i18n.js";

/**
 * One entry of a `Record<string, X>` map, as its own component.
 *
 * It exists for one structural reason: `provide()` is per component instance
 * and runs once in setup, so MapField cannot hand each iteration of its
 * `v-for` a different ref scope. With this boundary each entry asks the
 * injected resolver what its world looks like and re-provides it downward,
 * so every SchemaField beneath one guild sees that guild's channels and roles
 * and nobody else's.
 *
 * When no resolver is provided, or it has no scope for this map, nothing is
 * re-provided and the subtree inherits its parent's refs unchanged.
 *
 * The scope is resolved once in setup, which is correct only because MapField
 * keys its `v-for` by the entry key: a different key is a different instance,
 * not this one with new props. That `:key` is load-bearing.
 *
 * <SchemaField> resolves from the global registration (main.ts) to avoid an
 * import cycle.
 */
export default defineComponent({
  name: "MapEntry",
  components: { Button },
  props: {
    mapName: { type: String, required: true },
    entryKey: { type: String, required: true },
    valueSchema: { type: Object as PropType<JsonSchemaNode>, required: true },
    definitions: {
      type: Object as PropType<Definitions>,
      required: false,
      default: undefined,
    },
    modelValue: { type: null as unknown as PropType<unknown>, required: false },
    path: { type: Array as PropType<string[]>, required: false, default: () => [] },
    keyPath: { type: Array as PropType<string[]>, required: false, default: () => [] },
  },
  emits: ["update:model-value", "remove"],
  setup(props) {
    const keyLabel = inject(MapKeyLabelKey, undefined);
    const scopeFor = inject(SchemaScopeKey, undefined);
    const form = inject(SchemaFormKey, undefined);

    // Asking for the scope is what triggers the guild's fetch, so the work
    // happens when an entry actually renders rather than for every guild in
    // the config on page load.
    const scope = scopeFor?.(props.mapName, props.entryKey);
    if (scope) provide(SchemaRefsKey, scope);

    return {
      label: keyLabel?.(props.mapName, props.entryKey) ?? props.entryKey,
      form,
      t,
    };
  },
  computed: {
    // An object value renders as a collapsible section that carries its own
    // header; the entry row then shows only the id and the remove control.
    valueIsObject(): boolean {
      return classifyField(this.valueSchema, this.definitions) === "object";
    },
    locked(): boolean {
      return this.form?.locked() ?? false;
    },
  },
});
</script>

<style scoped>
.map-entry {
  border-left: 2px solid var(--border);
  padding-left: var(--space-2);
  margin: var(--space-2) 0;
  min-width: 0;
}
.map-entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-left: var(--space-2);
}
.map-key {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-1) var(--space-2);
  min-width: 0;
  overflow-wrap: anywhere;
}
.map-key-id { font: 400 var(--text-xs) / 1.4 var(--font-mono); color: var(--text-dim); }
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-width: var(--touch-min); min-height: var(--touch-min); }
}
</style>

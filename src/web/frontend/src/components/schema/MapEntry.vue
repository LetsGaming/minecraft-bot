<template>
  <div class="map-entry">
    <div class="map-entry-top">
      <!-- A Discord snowflake is not a heading. The app knows the guild's name
           everywhere else, so a section titled 1414722048210763999 was the one
           place it made the reader carry the ID themselves. The ID stays
           visible, small, because it is still the thing you paste into a
           support thread. -->
      <span class="map-key">
        <!-- An object entry (a guild) titles its own collapsible section, so
             the label is not repeated here; a scalar entry keeps it. -->
        <strong v-if="!valueIsObject">{{ label }}</strong>
        <code v-if="label !== entryKey" class="map-key-id mono small muted">{{ entryKey }}</code>
      </span>
      <Button
        icon="pi pi-trash"
        text
        severity="secondary"
        size="small"
        v-tooltip.top="'Remove'"
        @click="$emit('remove', entryKey)"
      />
    </div>
    <SchemaField
      :name="valueIsObject ? label : entryKey"
      :schema="valueSchema"
      :definitions="definitions"
      :path="valueIsObject ? path : [...path, label]"
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
import { classifyField, type JsonSchemaNode, type Definitions } from "./schemaField.js";

/**
 * One entry of a `Record<string, X>` map, as its own component.
 *
 * It exists for one structural reason: `provide()` is per component instance
 * and runs once in setup, so MapField cannot hand each iteration of its
 * `v-for` a different ref scope. Without this boundary, a page editing three
 * guilds had to share one channel list between them, which is why the config
 * form fell back to raw ID text boxes while the single-guild modal showed
 * `#minecraft` for the very same field.
 *
 * With the boundary, each entry asks the injected resolver what its world
 * looks like and re-provides it downward, so every SchemaField beneath this
 * entry sees that guild's channels and roles and nobody else's. Cross-guild
 * mixups become unrepresentable rather than merely discouraged.
 *
 * When no resolver is provided, or it has no scope for this map, nothing is
 * re-provided and the subtree inherits its parent's refs unchanged.
 *
 * The scope is resolved once in setup, which is correct only because MapField
 * keys its `v-for` by the entry key: a different key is a different instance,
 * not this one with new props. That `:key` is load-bearing.
 *
 * <SchemaField> resolves from the global registration (main.ts) to avoid a
 * SchemaField ⇄ MapField ⇄ MapEntry import cycle.
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
  },
  emits: ["update:model-value", "remove"],
  setup(props) {
    const keyLabel = inject(MapKeyLabelKey, undefined);
    const scopeFor = inject(SchemaScopeKey, undefined);

    // Asking for the scope is what triggers the guild's fetch, so the work
    // happens when an entry actually renders rather than for every guild in
    // the config on page load.
    const scope = scopeFor?.(props.mapName, props.entryKey);
    if (scope) provide(SchemaRefsKey, scope);

    return {
      label: keyLabel?.(props.mapName, props.entryKey) ?? props.entryKey,
    };
  },
  computed: {
    // An object value renders as a collapsible section that carries its own
    // header; the entry row then shows only the id and the remove control.
    valueIsObject(): boolean {
      return classifyField(this.valueSchema, this.definitions) === "object";
    },
  },
});
</script>

<style scoped>
.map-entry {
  border-left: 2px solid var(--mc-border);
  padding-left: 12px;
  margin: 10px 0;
}
.map-entry-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.map-key {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}
.map-key-id { font-weight: 400; }
</style>

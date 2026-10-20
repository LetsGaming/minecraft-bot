<template>
  <div class="cf">
    <p v-if="!forced && !hasActive" class="cf-default">{{ t("config.groupAllDefault") }}</p>
    <div v-for="key in keys" v-show="isShown(key)" :key="key" class="cf-item">
      <SchemaField
        :name="key"
        :schema="schemas[key]"
        :definitions="definitions"
        :key-path="[key]"
        :bare="isBare(key)"
        :model-value="model[key]"
        @update:model-value="$emit('update', key, $event)"
      />
    </div>
    <button
      v-if="!forced && hiddenCount > 0"
      type="button"
      class="cf-rest"
      :aria-expanded="open"
      @click="open = !open"
    >
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right']" aria-hidden="true" />
      {{ open ? t("config.restHide") : t("config.restShow", { count: hiddenCount }) }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import SchemaField from "./SchemaField.vue";
import { isKeyActive } from "./configuredFirst";
import type { Definitions } from "./schemaField";
import { t } from "../../i18n";

/**
 * The settings of one group, showing only what is configured, edited or
 * broken until the admin asks for the rest. Hidden fields stay mounted, so an
 * edit never moves a field or loses focus. A filter or "show all" overrides.
 */
const props = withDefaults(
  defineProps<{
    keys: readonly string[];
    schemas: Record<string, unknown>;
    definitions: Definitions;
    model: Record<string, unknown>;
    baseline: Record<string, unknown> | null | undefined;
    problemKeys: ReadonlySet<string>;
    showAll: boolean;
    filterActive: boolean;
    isVisible: (path: readonly string[]) => boolean;
    isBare?: (key: string) => boolean;
  }>(),
  { isBare: () => false },
);
defineEmits<{ update: [key: string, value: unknown] }>();

const open = ref(false);
const forced = computed(() => props.filterActive || props.showAll);
const active = (key: string): boolean => isKeyActive(key, props.model, props.baseline, props.problemKeys);
const hasActive = computed(() => props.keys.some(active));
const hiddenCount = computed(() => props.keys.filter((key) => !active(key)).length);

function isShown(key: string): boolean {
  if (props.filterActive) return props.isVisible([key]);
  return props.showAll || open.value || active(key);
}
</script>

<style scoped>
.cf { min-width: 0; }
.cf-default { margin: 0; padding: var(--space-3) var(--space-4); color: var(--text-dim); font-size: var(--text-sm); }
.cf-rest {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--control-h);
  padding: 0 var(--space-4);
  background: none;
  border: 0;
  border-top: 1px solid var(--border);
  color: var(--text-dim);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.cf-rest:hover { color: var(--text); background: var(--surface-raised); }
.cf-rest:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
</style>

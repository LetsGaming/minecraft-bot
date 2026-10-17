<template>
  <div class="item-picker">
    <AutoComplete
      v-model="query"
      :suggestions="suggestions"
      option-label="name"
      :input-id="inputId"
      :placeholder="placeholder || t('rewards.picker.placeholder')"
      :disabled="disabled"
      :delay="80"
      :min-length="1"
      fluid
      complete-on-focus
      :pt="{ pcInputText: { root: { 'aria-describedby': hintId } } }"
      @complete="onComplete"
      @option-select="onSelect"
      @keydown.enter.prevent="onEnter"
    >
      <template #option="{ option }">
        <span class="ip-option">
          <span class="ip-name">{{ option.name }}</span>
          <span class="ip-id mono">{{ option.id }}</span>
        </span>
      </template>
    </AutoComplete>
    <Button
      class="tap"
      icon="pi pi-plus"
      :label="buttonLabel || t('rewards.picker.add')"
      severity="secondary"
      outlined
      :disabled="disabled || !typedItem"
      @click="onEnter"
    />
    <p :id="hintId" :class="['ip-hint', { warn: !!problem }]">
      {{ problem || t("rewards.picker.hint") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import AutoComplete, { type AutoCompleteCompleteEvent, type AutoCompleteOptionSelectEvent } from "primevue/autocomplete";
import Button from "primevue/button";
import { itemProblem } from "@mcbot/schema/dailyRewards.js";
import { searchItems, type CatalogItem, type ItemCatalog } from "../../utils/minecraftItems";
import { t } from "../../i18n";

/**
 * Pick an item by its name ("Bottle o' Enchanting") or type any id, modded
 * ones included ("create:brass_ingot"). Emits the item string to add.
 */
const props = withDefaults(
  defineProps<{
    catalog: ItemCatalog | null;
    inputId: string;
    disabled?: boolean;
    placeholder?: string;
    buttonLabel?: string;
  }>(),
  { disabled: false, placeholder: "", buttonLabel: "" },
);

const emit = defineEmits<{ pick: [item: string] }>();

const query = ref<string | CatalogItem>("");
const suggestions = ref<CatalogItem[]>([]);
const hintId = computed(() => `${props.inputId}-hint`);

/** What pressing Add would add: a picked item's id, or the typed text as an id. */
const typedItem = computed(() => {
  const value = query.value;
  if (typeof value !== "string") return value.id;
  return value.trim().toLowerCase();
});

/**
 * Shown under the box. While the text still matches items by name it is a
 * search, not an id, so only text that matches nothing is checked as an id.
 */
const problem = computed(() => {
  const item = typedItem.value;
  if (!item || typeof query.value !== "string") return "";
  if (props.catalog?.byId.has(item.replace(/^minecraft:/, ""))) return "";
  if (props.catalog && searchItems(props.catalog, item, 1).length > 0) return "";
  const invalid = itemProblem(item);
  return invalid ?? t("rewards.picker.unknown", { item });
});

function onComplete(event: AutoCompleteCompleteEvent): void {
  suggestions.value = props.catalog ? searchItems(props.catalog, event.query) : [];
}

function pick(item: string): void {
  if (!item || itemProblem(item)) return;
  emit("pick", item);
  query.value = "";
}

function onSelect(event: AutoCompleteOptionSelectEvent): void {
  pick((event.value as CatalogItem).id);
}

function onEnter(): void {
  const value = query.value;
  if (typeof value !== "string") {
    pick(value.id);
    return;
  }
  // Typed a name, not an id: take the best match when it names one exactly.
  const text = value.trim();
  const exact = props.catalog
    ? searchItems(props.catalog, text, 1).find((i) => i.name.toLowerCase() === text.toLowerCase())
    : undefined;
  pick(exact ? exact.id : text.toLowerCase());
}
</script>

<style scoped>
.item-picker {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-2);
  align-items: start;
  min-width: 0;
}
.ip-option { display: flex; justify-content: space-between; gap: var(--space-3); min-width: 0; width: 100%; }
.ip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ip-id { color: var(--text-dim); font-size: var(--text-xs); flex: none; }
.ip-hint { grid-column: 1 / -1; margin: 0; font-size: var(--text-xs); color: var(--text-dim); }
.ip-hint.warn { color: var(--st-degraded); }
@media (pointer: coarse), (max-width: 760px) {
  .tap { min-height: var(--touch-min); }
}
</style>

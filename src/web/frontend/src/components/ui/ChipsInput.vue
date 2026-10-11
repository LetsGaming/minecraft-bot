<template>
  <AutoComplete
    class="chips-input"
    :model-value="shown"
    multiple
    :typeahead="false"
    fluid
    :input-id="inputId"
    :aria-labelledby="labelledby"
    :disabled="disabled"
    :invalid="invalid"
    :pt="pt"
    @update:model-value="onUpdate"
  >
    <template #chip="{ value, removeCallback }">
      <Chip class="p-autocomplete-chip" :label="String(value)" removable :pt="CHIP_PT">
        <template #removeicon>
          <button
            type="button"
            class="chips-remove"
            :aria-label="t('field.removeChip', { value: String(value) })"
            :disabled="disabled"
            @click="removeCallback($event)"
          >
            <i class="pi pi-times" aria-hidden="true" />
          </button>
        </template>
      </Chip>
    </template>
  </AutoComplete>
</template>

<script lang="ts">
import { defineComponent, nextTick, type PropType } from "vue";
import AutoComplete from "primevue/autocomplete";
import Chip from "primevue/chip";
import { t } from "../../i18n.js";
import { chipsInputPt, splitEntries } from "./chipsA11y.js";

const CHIP_PT = { root: { "aria-label": null } } as const;

/**
 * A free-text list editor: type an entry and press Enter (or the separator)
 * to add it, Backspace in the empty box or a chip's remove button to drop one.
 * Duplicates are kept, as the config may legitimately repeat an entry.
 */
export default defineComponent({
  name: "ChipsInput",
  components: { AutoComplete, Chip },
  props: {
    modelValue: { type: Array as PropType<string[]>, required: true },
    inputId: { type: String, default: undefined },
    labelledby: { type: String, default: undefined },
    describedby: { type: String, default: undefined },
    disabled: { type: Boolean, default: false },
    invalid: { type: Boolean, default: false },
    /** Typing it commits the entry; pasted text containing it becomes several entries. */
    separator: { type: String, default: undefined },
  },
  emits: ["update:model-value"],
  setup() {
    return { t, CHIP_PT };
  },
  data() {
    return { shown: [...this.modelValue] };
  },
  computed: {
    pt(): ReturnType<typeof chipsInputPt> {
      return chipsInputPt({
        describedby: this.describedby,
        onKeydown: (e: KeyboardEvent) => this.onKeydown(e),
        onPaste: (e: ClipboardEvent) => this.onPaste(e),
      });
    },
  },
  watch: {
    modelValue: {
      deep: true,
      handler(value: string[]) {
        this.shown = [...value];
      },
    },
  },
  methods: {
    emit(value: string[]) {
      this.$emit("update:model-value", value);
      // AutoComplete keeps its own copy of the chips. When the parent rejects
      // or rewrites an entry (a number list dropping "abc"), modelValue may not
      // change at all, so hand it a fresh copy to drop what it added.
      void nextTick(() => {
        this.shown = [...this.modelValue];
      });
    },
    onUpdate(value: unknown) {
      this.emit(Array.isArray(value) ? value.map(String) : []);
    },
    add(entries: string[], input: HTMLInputElement) {
      input.value = "";
      if (entries.length > 0) this.emit([...this.modelValue, ...entries]);
    },
    onKeydown(event: KeyboardEvent) {
      if (!this.separator || event.isComposing || event.key !== this.separator) return;
      event.preventDefault();
      const input = event.target as HTMLInputElement;
      this.add(splitEntries(input.value, this.separator), input);
    },
    onPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData("text") ?? "";
      if (!this.separator || !text.includes(this.separator)) return;
      event.preventDefault();
      const input = event.target as HTMLInputElement;
      this.add(splitEntries(input.value + text, this.separator), input);
    },
  },
});
</script>

<style scoped>
.chips-input { width: 100%; min-width: 0; }
.chips-remove {
  display: inline-grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  margin-inline-end: calc(-1 * var(--space-1));
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: none;
  color: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
}
.chips-remove:hover:not(:disabled) { background: var(--surface-raised); }
.chips-remove:disabled { cursor: default; opacity: 0.6; }
@media (pointer: coarse), (max-width: 760px) {
  .chips-remove { width: var(--touch-min); height: var(--touch-min); margin-block: calc(-1 * var(--space-2)); }
}
</style>

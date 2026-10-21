<template>
  <div v-if="modelValue" class="sp-wrap" :class="{ 'is-sheet': sheet }">
    <div v-if="sheet" class="sp-scrim" @click="close" />
    <aside
      ref="panel"
      class="sp"
      role="dialog"
      :aria-modal="sheet ? 'true' : 'false'"
      :aria-labelledby="titleId"
      tabindex="-1"
      @keydown="onKey"
    >
      <header class="sp-head">
        <h2 :id="titleId" class="sp-title">{{ label }}</h2>
        <button type="button" class="sp-close tap" :aria-label="closeLabel" @click="close">
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </header>
      <div class="sp-body"><slot /></div>
      <footer v-if="$slots.footer" class="sp-foot"><slot name="footer" /></footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * A panel beside the content on wide screens and a bottom sheet on narrow ones.
 * Wide: it sits where the parent places it (sticky) and does not trap focus.
 * Narrow: a modal sheet over a scrim that traps focus; Esc and the scrim close
 * it, and focus returns to what opened it.
 */
const props = defineProps<{
  modelValue: boolean;
  /** The panel's heading, also its accessible name. */
  label: string;
  closeLabel: string;
}>();
const emit = defineEmits<{ "update:modelValue": [open: boolean] }>();

const SHEET_QUERY = "(max-width: 1099px)";
const titleId = `sp-title-${Math.random().toString(36).slice(2, 8)}`;
const panel = ref<HTMLElement | null>(null);
const sheet = ref(false);
let query: MediaQueryList | null = null;
let opener: HTMLElement | null = null;

function onQuery(): void {
  sheet.value = query?.matches ?? false;
}

onMounted(() => {
  if (typeof window === "undefined" || !window.matchMedia) return;
  query = window.matchMedia(SHEET_QUERY);
  onQuery();
  query.addEventListener("change", onQuery);
});

onBeforeUnmount(() => query?.removeEventListener("change", onQuery));

function close(): void {
  emit("update:modelValue", false);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    close();
    return;
  }
  if (event.key !== "Tab" || !sheet.value || !panel.value) return;
  const nodes = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (nodes.length === 0) return;
  const first = nodes[0]!;
  const last = nodes[nodes.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === panel.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      await nextTick();
      panel.value?.focus();
    } else {
      opener?.focus();
      opener = null;
    }
  },
);
</script>

<style scoped>
.sp {
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-surface);
  outline: none;
}
.sp-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border); }
.sp-title { margin: 0; font-size: var(--text-lg); font-weight: 600; }
.sp-close { background: none; border: 0; color: var(--text-dim); border-radius: var(--radius-control); min-width: var(--control-h); min-height: var(--control-h); cursor: pointer; }
.sp-close:hover { color: var(--text); }
.sp-body { padding: var(--space-4); overflow-y: auto; min-height: 0; }
.sp-foot { padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: center; justify-content: space-between; }

@media (min-width: 1100px) {
  .sp-wrap { position: sticky; top: var(--space-4); align-self: start; max-height: calc(100dvh - var(--space-6)); display: flex; }
  .sp { flex: 1; max-height: inherit; }
}

.is-sheet .sp-scrim { position: fixed; inset: 0; background: var(--scrim); z-index: var(--z-dialog); }
.is-sheet .sp {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: calc(var(--z-dialog) + 1);
  max-height: 85dvh;
  border-radius: var(--radius-surface) var(--radius-surface) 0 0;
  box-shadow: var(--shadow-overlay);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>

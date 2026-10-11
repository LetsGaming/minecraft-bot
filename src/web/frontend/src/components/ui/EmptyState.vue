<template>
  <div :class="['empty', { titled: !!title }]">
    <i :class="icon" aria-hidden="true" />
    <component :is="`h${headingLevel}`" v-if="title" class="empty-title">{{ title }}</component>
    <p><slot /></p>
    <div v-if="$slots.action" class="empty-action">
      <slot name="action" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

// The "nothing here yet" placeholder: a muted icon, an optional heading that
// says what is missing, why and what next in the default slot, and an
// optional action (e.g. Create backup) in the `action` slot. Not for errors:
// those are InlineError, with a cause and Retry.
export default defineComponent({
  name: "EmptyState",
  props: {
    icon: { type: String, default: "pi pi-inbox" },
    title: { type: String, default: "" },
    headingLevel: { type: Number as PropType<2 | 3 | 4>, default: 3 },
  },
});
</script>

<style scoped>
.empty { text-align: center; padding: 48px 0; color: var(--mc-muted); }
.empty i { font-size: 34px; opacity: 0.5; }
.empty p { margin: 10px auto 0; max-width: 62ch; }
.empty-title { margin: var(--space-3) 0 0; font-size: var(--text-lg); font-weight: 600; color: var(--text); }
.titled p { color: var(--text-dim); }
.empty-action { margin-top: 12px; }
</style>

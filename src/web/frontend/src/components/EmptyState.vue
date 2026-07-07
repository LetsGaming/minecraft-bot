<template>
  <div class="empty">
    <i :class="icon" />
    <p><slot /></p>
    <div v-if="$slots.action" class="empty-action">
      <slot name="action" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

// The centered "nothing here / couldn't load" placeholder: a large muted
// icon, a message (default slot), and an optional action (e.g. a Retry
// button) in the `action` slot.
export default defineComponent({
  name: "EmptyState",
  props: {
    icon: { type: String, default: "pi pi-inbox" },
  },
});
</script>

<style scoped>
.empty { text-align: center; padding: 48px 0; color: var(--mc-muted); }
.empty i { font-size: 34px; opacity: 0.5; }
.empty p { margin: 10px 0 0; }
.empty-action { margin-top: 12px; }
</style>

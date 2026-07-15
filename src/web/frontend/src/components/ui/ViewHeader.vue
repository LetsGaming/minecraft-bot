<template>
  <div class="view-head">
    <div class="vh-titles">
      <h2>{{ title }}</h2>
      <p v-if="$slots.subtitle || subtitle" class="muted small">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="vh-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";

// The standard header every view opens with: a sentence-case title, an
// optional muted subtitle, and an optional right-aligned actions slot
// (e.g. a Save or Refresh button). Centralises spacing and type so the
// views don't each re-declare it.
export default defineComponent({
  name: "ViewHeader",
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
  },
});
</script>

<style scoped>
.view-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; margin-bottom: 20px;
}
.vh-titles h2 { margin: 0 0 3px; font-size: 18px; font-weight: 500; }
.vh-titles p { margin: 0; max-width: 70ch; }
.vh-actions { flex: none; }
</style>

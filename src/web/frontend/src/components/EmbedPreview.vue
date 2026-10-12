<template>
  <div class="embed-preview" :class="`ep-${mode}`" :style="cardStyle">
    <span class="ep-bar" :style="{ backgroundColor: color }" aria-hidden="true" />
    <div class="ep-body">
      <p class="ep-title">{{ icon }} {{ title }}</p>
      <p class="ep-text">{{ text }}</p>
      <p v-if="field" class="ep-field"><strong>{{ field }}</strong></p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { DISCORD_EMBED_BACKGROUND } from "@mcbot/schema/embedCategories.js";

const props = defineProps<{
  mode: "dark" | "light";
  /** CSS colour of the side bar. */
  color: string;
  icon: string;
  title: string;
  text: string;
  field?: string;
}>();

const cardStyle = computed(() => {
  const n = DISCORD_EMBED_BACKGROUND[props.mode];
  return { backgroundColor: `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255})` };
});
</script>

<style scoped>
.embed-preview {
  display: flex;
  border-radius: 6px;
  overflow: hidden;
  min-width: 0;
}
.ep-bar {
  flex: none;
  width: 4px;
}
.ep-body {
  padding: var(--space-3) var(--space-4);
  min-width: 0;
}
.ep-body p {
  margin: 0;
  overflow-wrap: anywhere;
}
.ep-title {
  font-weight: 600;
}
.ep-text,
.ep-field {
  font-size: var(--text-sm);
  margin-top: var(--space-1) !important;
}
.ep-dark {
  color: rgb(219 222 225);
}
.ep-light {
  color: rgb(46 51 56);
}
</style>

<template>
  <span :class="['modcell', { off }]">
    <ModIcon :name="name" :slug="slug" :src="iconUrl" :size="size" decorative />
    <span v-if="filename" class="modcell-text">
      <span class="name">{{ name }}</span>
      <span class="sub mono" :title="filename">{{ filename }}</span>
    </span>
    <span v-else class="name">{{ name }}</span>
  </span>
</template>

<script setup lang="ts">
import ModIcon from "../ui/ModIcon.vue";

withDefaults(
  defineProps<{
    name: string;
    slug: string;
    iconUrl: string;
    size?: number;
    /** The jar file name, shown under the name when the row has one. */
    filename?: string;
    /** A disabled mod reads dimmer. */
    off?: boolean;
  }>(),
  { size: 32, filename: "", off: false },
);
</script>

<style scoped>
.modcell { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.modcell.off { opacity: 0.7; }
.modcell-text { display: grid; min-width: 0; }
.name { font-weight: 600; overflow-wrap: anywhere; }
.sub {
  display: block;
  max-width: 34ch;
  overflow: hidden;
  color: var(--text-dim);
  font-size: var(--text-xs);
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

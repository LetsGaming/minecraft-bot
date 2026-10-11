<template>
  <img
    v-if="src && !failed"
    class="mod-icon"
    :src="src"
    :width="size"
    :height="size"
    :alt="decorative ? '' : name"
    loading="lazy"
    decoding="async"
    @error="failed = true"
  />
  <span
    v-else
    class="mod-icon mod-tile"
    :style="{ width: `${size}px`, height: `${size}px`, background: `var(--tile-${tint})`, fontSize: `${Math.round(size * 0.4)}px` }"
    :role="decorative ? undefined : 'img'"
    :aria-label="decorative ? undefined : name"
    :aria-hidden="decorative ? 'true' : undefined"
  >{{ initials }}</span>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

const TILE_COUNT = 6;

/**
 * A mod's image, or an initials tile when it has none or it fails to load.
 * The tile's tint comes from the slug, so a mod keeps its colour across views.
 */
const props = withDefaults(
  defineProps<{
    name: string;
    slug?: string;
    src?: string;
    size?: number;
    /** True when the name is printed next to the icon anyway. */
    decorative?: boolean;
  }>(),
  { slug: "", src: "", size: 32, decorative: false },
);

const failed = ref(false);
watch(() => props.src, () => (failed.value = false));

const initials = computed(() => {
  const words = props.name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
});

const tint = computed(() => {
  const key = props.slug || props.name;
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return (hash % TILE_COUNT) + 1;
});
</script>

<style scoped>
.mod-icon {
  flex: none;
  display: inline-block;
  border-radius: var(--radius-control);
  object-fit: cover;
  vertical-align: middle;
}
.mod-tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  font-weight: 600;
  line-height: 1;
  user-select: none;
}
</style>

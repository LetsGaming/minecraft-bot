<template>
  <span v-if="text" class="hint-wrap">
    <span :class="['hint', { clamped: !expanded && long }]">{{ text }}</span>
    <button v-if="long" type="button" class="hint-toggle" @click="expanded = !expanded">
      {{ expanded ? "less" : "more" }}
    </button>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

/**
 * Schema help text, collapsed until asked for.
 *
 * The generated help on this config is genuinely good — it explains what
 * `allowedServers` does in multi-guild deployments, what happens when
 * `events` is omitted — and there is six to eight lines of it under nearly
 * every field. Rendered in full and always-on, the prose outweighed the
 * controls roughly three to one, so a form of twelve inputs read as an
 * essay with twelve inputs buried in it.
 *
 * Two lines is enough to recognise whether this is the field you are looking
 * for; the rest is one click away and stays open once opened.
 */
const props = withDefaults(
  defineProps<{
    text?: string;
    /** Characters beyond which the hint is clamped. Roughly two lines. */
    clampAt?: number;
  }>(),
  { text: "", clampAt: 130 },
);

const expanded = ref(false);
const long = computed(() => props.text.length > props.clampAt);
</script>

<style scoped>
.hint-wrap { display: block; max-width: 62ch; }
.hint {
  display: block;
  color: var(--mc-muted);
  font-size: 12.5px;
  line-height: 1.45;
}
.clamped {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hint-toggle {
  background: none;
  border: none;
  padding: 1px 0 0;
  cursor: pointer;
  color: var(--mc-accent);
  font-size: 12px;
  font-family: inherit;
}
.hint-toggle:hover { text-decoration: underline; }
</style>

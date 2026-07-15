<template>
  <span :class="['dot', state]" />
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";

// The small status indicator used for servers and the bot process.
// up = online/healthy, down = offline, stale = degraded (heartbeat lost).
export default defineComponent({
  name: "StatusDot",
  props: {
    state: { type: String as PropType<"up" | "down" | "stale">, default: "down" },
  },
});
</script>

<style scoped>
.dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; flex: none; }
.dot.up { background: var(--mc-good); box-shadow: 0 0 6px rgba(74, 222, 128, 0.45); }
.dot.down { background: var(--mc-bad); }
.dot.stale { background: var(--mc-mid); }
</style>

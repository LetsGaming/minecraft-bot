<template>
  <div class="view-head">
    <div class="vh-titles">
      <div class="vh-title-row">
        <h1>{{ title }}</h1>
        <StatusChip
          v-if="server"
          class="vh-server"
          :state="serverState"
          :label="chipLabel"
        />
      </div>
      <p v-if="$slots.subtitle || subtitle" class="vh-sub">
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
    </div>
    <div v-if="$slots.actions" class="vh-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, type PropType } from "vue";
import {
  GLOSSARY,
  StatusRole,
  statusLabelKey,
  type StatusInput,
} from "@mcbot/schema";
import StatusChip from "./StatusChip.vue";

// The header every view opens with: the page's h1, an optional chip naming
// the server the page is about, a one-line purpose, and actions that wrap
// under the title when the row runs out of room.
export default defineComponent({
  name: "ViewHeader",
  components: { StatusChip },
  props: {
    title: { type: String, required: true },
    subtitle: { type: String, default: "" },
    /** Server id the view is scoped to; shows a chip next to the title. */
    server: { type: String, default: "" },
    serverState: { type: String as PropType<StatusInput>, default: StatusRole.Unknown },
    /** Chip text; defaults to the server id and its state. */
    serverLabel: { type: String, default: "" },
  },
  computed: {
    chipLabel(): string {
      if (this.serverLabel) return this.serverLabel;
      const state = GLOSSARY[statusLabelKey(this.serverState)]?.en;
      return state ? `${this.server}, ${state.toLowerCase()}` : this.server;
    },
  },
});
</script>

<style scoped>
.view-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3) var(--space-4);
  margin-bottom: var(--space-5);
}
.vh-titles { flex: 1 1 32ch; min-width: 0; }
.vh-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); }
.vh-titles h1 {
  margin: 0;
  font-size: var(--text-2xl);
  font-weight: 600;
  line-height: var(--leading-tight);
  overflow-wrap: anywhere;
}
.vh-sub { margin: var(--space-1) 0 0; max-width: 64ch; color: var(--text-dim); font-size: var(--text-sm); }
.vh-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
</style>

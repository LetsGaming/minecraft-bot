<template>
  <div>
    <ViewHeader title="Console" subtitle="Live server log, and a command line into it.">
      <template #actions>
        <span :class="['conn', connected ? 'up' : 'down']">
          <StatusDot :state="connected ? 'online' : 'unknown'" />
          {{ connected ? "Live" : statusDetail || "Disconnected" }}
        </span>
      </template>
    </ViewHeader>

    <EmptyState v-if="serverIds.length === 0" icon="pi pi-server">
      No servers you can view.
    </EmptyState>

    <template v-else>
      <!-- Server picker, only when there is a choice to make. -->
      <div v-if="serverIds.length > 1" class="picker">
        <Button
          v-for="id in serverIds"
          :key="id"
          :label="id"
          size="small"
          :severity="id === current ? 'primary' : 'secondary'"
          :outlined="id !== current"
          @click="select(id)"
        />
      </div>

      <div ref="pane" class="pane mono" @scroll="onScroll">
        <div v-if="lines.length === 0" class="muted small pane-empty">
          Waiting for output…
        </div>
        <div v-for="line in lines" :key="line.id" class="line">{{ line.text }}</div>
      </div>

      <div class="pane-foot">
        <label class="follow small muted">
          <input type="checkbox" v-model="autoScroll" />
          Follow output
        </label>
        <span class="muted small">{{ lines.length }} lines buffered</span>
      </div>

      <!-- Command input, only for those who may send. -->
      <div v-if="canSendCommands" class="composer">
        <InputText
          v-model="command"
          :maxlength="maxLength"
          placeholder="Type a command, e.g. list"
          :invalid="commandBlocked"
          class="composer-input"
          @keyup.enter="send"
        />
        <Button
          label="Send"
          icon="pi pi-send"
          size="small"
          :loading="sending"
          :disabled="!canSend"
          @click="send"
        />
      </div>
      <p v-if="commandBlocked" class="blocked small">
        That command is blocked on this dashboard.
      </p>
      <p v-else-if="canSendCommands" class="muted small hint">
        Blocked here: {{ blockedCommands.join(", ") || "nothing" }}. The leading slash is optional.
      </p>
      <Message v-if="error" severity="error" :closable="false" class="composer-error">
        {{ error }}
      </Message>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useConsole } from "../composables/useConsole";
import { useCapabilities } from "../composables/useCapabilities";
import ViewHeader from "../components/ui/ViewHeader.vue";
import StatusDot from "../components/ui/StatusDot.vue";
import EmptyState from "../components/ui/EmptyState.vue";

/** Distance from the bottom still counted as "at the bottom", in px. */
const STICK_THRESHOLD = 40;

export default defineComponent({
  name: "ConsoleView",
  components: { Button, InputText, Message, ViewHeader, StatusDot, EmptyState },
  props: {
    /** Server ids the caller may read, from the shell's status poll. */
    serverIds: { type: Array as () => string[], default: () => [] },
    activeServer: { type: String, default: "" },
  },
  setup() {
    return { ...useConsole(), ...useCapabilities() };
  },
  data() {
    return { current: "" };
  },
  computed: {
    canSendCommands(): boolean {
      return this.can("server:console", this.current);
    },
  },
  watch: {
    // Re-open when the shell switches server, and pick a default once the
    // first status poll tells us what exists.
    activeServer(id: string) {
      if (id && id !== this.current) void this.select(id);
    },
    serverIds: {
      immediate: true,
      handler(ids: string[]) {
        if (!this.current && ids.length > 0) {
          void this.select(this.activeServer && ids.includes(this.activeServer)
            ? this.activeServer
            : ids[0]!);
        }
      },
    },
    lines() {
      if (this.autoScroll) void this.$nextTick(() => this.scrollToBottom());
    },
  },
  methods: {
    async select(id: string): Promise<void> {
      this.current = id;
      await this.open(id);
      void this.$nextTick(() => this.scrollToBottom());
    },
    scrollToBottom(): void {
      const pane = this.$refs.pane as HTMLElement | undefined;
      if (pane) pane.scrollTop = pane.scrollHeight;
    },
    /**
     * Sticky follow: scrolling up disengages, returning to the bottom
     * re-engages. Never fight the reader for the scrollbar.
     */
    onScroll(): void {
      const pane = this.$refs.pane as HTMLElement | undefined;
      if (!pane) return;
      const distance = pane.scrollHeight - pane.scrollTop - pane.clientHeight;
      this.autoScroll = distance <= STICK_THRESHOLD;
    },
  },
});
</script>

<style scoped>
.conn { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.conn.up { color: var(--mc-text); }
.conn.down { color: var(--mc-muted); }

.picker { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }

.pane {
  height: 55vh;
  min-height: 260px;
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--mc-card);
  border: 1px solid var(--mc-border);
  border-radius: var(--mc-radius);
  font-size: 12px;
  line-height: 1.55;
}
.pane-empty { padding: 4px 0; }
.line { white-space: pre-wrap; word-break: break-word; }

.pane-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 2px 0;
}
.follow { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

.composer { display: flex; gap: 8px; margin-top: 10px; }
.composer-input { flex: 1; font-family: var(--mc-mono, monospace); }
.composer-error { margin-top: 8px; }
.blocked { color: var(--mc-danger, #ef4444); margin: 6px 2px 0; }
.hint { margin: 6px 2px 0; }
</style>
